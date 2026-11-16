# COCO-Stuff für Hausprobe aufbereiten: Fotos mit Dach oder Haus und kommerziell nutzbarer Lizenz auswählen,
# laden und je Foto eine Markierung mit den Klassen 0 sonstiges, 1 Dach, 2 Wand, 3 Fenster, 4 Tür schreiben.
#
# Quellen (siehe github.com/nightrome/cocostuff):
#   stuffthingmaps_trainval2017.zip  Labelkarten je Foto, Pixelwert = Label-ID aus labels.txt minus 1, 255 = unmarkiert
#   annotations_trainval2017.zip     daraus nur captions_*.json: Liste der Fotos mit Lizenz und Download-Adresse
# Lizenzen: Markierungen CC BY 4.0. Fotos von Flickr mit eigener Lizenz; behalten werden nur
#   4 CC BY, 5 CC BY-SA, 7 "No known copyright restrictions", 8 "United States Government Work".
#
# Aufruf: python3 coco_prep.py <arbeitsordner> [max_fotos]
import sys,os,io,json,zipfile,time,random,shutil,subprocess,urllib.request,concurrent.futures as cf,numpy as np
from PIL import Image
W=sys.argv[1];MAX=int(sys.argv[2]) if len(sys.argv)>2 else 4000
os.makedirs(W+'/dl',exist_ok=True);os.makedirs(W+'/images',exist_ok=True);os.makedirs(W+'/labels',exist_ok=True)
URLS={'stuffthingmaps_trainval2017.zip':'http://calvin.inf.ed.ac.uk/wp-content/uploads/data/cocostuffdataset/stuffthingmaps_trainval2017.zip',
      'annotations_trainval2017.zip':'http://images.cocodataset.org/annotations/annotations_trainval2017.zip'}
OK_LIC={4:'CC BY 2.0',5:'CC BY-SA 2.0',7:'No known copyright restrictions',8:'United States Government Work'}
# Pixelwerte (Label-ID minus 1) -> Hausprobe-Klasse. Reihenfolge beim Eintragen: Wand, Dach, Fenster, Tür.
ROOF=[150];WALL=[127,95,170,171,172,173,174,176];WIN=[179,180];DOOR=[111]
LUT=np.zeros(256,np.uint8)
for v in WALL:LUT[v]=2
for v in ROOF:LUT[v]=1
for v in WIN:LUT[v]=3
for v in DOOR:LUT[v]=4

UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
def fetch(url,dst,tries=4):
    # Manche Server lehnen das Python-Standardprogramm ab (HTTP 406). Darum mit Browser-Kennung,
    # und wenn das nicht reicht, mit curl oder wget.
    tmp=dst+'.part'
    for t in range(tries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
            with urllib.request.urlopen(req,timeout=120) as r,open(tmp,'wb') as f:
                while True:
                    b=r.read(1<<20)
                    if not b:break
                    f.write(b)
            os.replace(tmp,dst);return True
        except Exception as e:
            print('  Download fehlgeschlagen',url,e,flush=True)
            for cmd in (['curl','-fsSL','-A',UA,'-o',tmp,url],['wget','-q','-U',UA,'-O',tmp,url]):
                if shutil.which(cmd[0]) and subprocess.call(cmd)==0:
                    os.replace(tmp,dst);return True
            time.sleep(5*(t+1))
    return False

for name,url in URLS.items():
    p=f'{W}/dl/{name}'
    if not os.path.exists(p):
        print('lade',name,flush=True)
        if not fetch(url,p):sys.exit(f'FEHLER: {url} ist nicht erreichbar.')

# Fotoliste mit Lizenz aus den Caption-Dateien (klein, im Gegensatz zu den instances-Dateien).
imgs={}
with zipfile.ZipFile(f'{W}/dl/annotations_trainval2017.zip') as z:
    for split in ('train2017','val2017'):
        for im in json.loads(z.read(f'annotations/captions_{split}.json'))['images']:
            if im['license'] in OK_LIC:imgs[os.path.splitext(im['file_name'])[0]]=dict(im,split=split)
print('Fotos mit passender Lizenz:',len(imgs),flush=True)

# Labelkarten dieser Fotos prüfen: Dach oder Haus muss sichtbar sein.
cands=[]
with zipfile.ZipFile(f'{W}/dl/stuffthingmaps_trainval2017.zip') as z:
    names={os.path.splitext(os.path.basename(n))[0]:n for n in z.namelist() if n.endswith('.png')}
    for k,(stem,im) in enumerate(imgs.items()):
        n=names.get(stem)
        if not n:continue
        a=np.array(Image.open(io.BytesIO(z.read(n))))
        lab=LUT[a];tot=a.size;roof=float((lab==1).sum())/tot;wall=float((lab==2).sum())/tot;house=float((a==127).sum())/tot
        if roof>=.02 or (house>=.05 and wall>=.08):
            cands.append((stem,roof,wall,n))
        if k%5000==0:print('  geprüft',k,'von',len(imgs),'Treffer',len(cands),flush=True)
    print('Fotos mit Dach oder Haus:',len(cands),flush=True)
    if len(cands)<150:sys.exit('FEHLER: zu wenige passende Fotos gefunden. Das Format der Labelkarten stimmt nicht mit der Erwartung überein.')
    random.seed(0);random.shuffle(cands)
    cands.sort(key=lambda c:0 if c[1]>=.02 else 1)  # Fotos mit Dach zuerst
    cands=cands[:MAX]
    for stem,_,_,n in cands:
        a=np.array(Image.open(io.BytesIO(z.read(n))));Image.fromarray(LUT[a]).save(f'{W}/labels/{stem}.png')

def get(c):
    stem=c[0];p=f'{W}/images/{stem}.jpg'
    if os.path.exists(p):return True
    return fetch(imgs[stem]['coco_url'],p,tries=3)
with cf.ThreadPoolExecutor(8) as ex:
    ok=list(ex.map(get,cands))
keep=[c for c,o in zip(cands,ok) if o]
man={'source':'COCO-Stuff 2017 (Caesar, Uijlings, Ferrari), annotations CC BY 4.0, github.com/nightrome/cocostuff',
     'classes':['sonstiges','Dach','Wand','Fenster','Tür'],
     'items':[{'id':c[0],'license':OK_LIC[imgs[c[0]]['license']],'url':imgs[c[0]].get('flickr_url'),'split':imgs[c[0]]['split']} for c in keep]}
json.dump(man,open(f'{W}/manifest.json','w'),indent=1)
print('fertig:',len(keep),'Fotos, davon mit Dach',sum(1 for c in keep if c[1]>=.02),flush=True)
