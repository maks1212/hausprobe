# CMP Facade Database (Tyleček, Šára; CC BY-SA, cmp.felk.cvut.cz/~tylecr1/facade/) für Hausprobe aufbereiten.
# 606 entzerrte Fassadenfotos mit pixelgenauen Markierungen. Übersetzung in die Hausprobe-Klassen:
#   Fassade, Gesims, Sims, Fensterbank, Deko, Pfeiler, Balkon -> 2 Wand
#   Fenster, Fensterladen (blind)                             -> 3 Fenster
#   Tür                                                        -> 4 Tür
#   Hintergrund, Geschäft (shop)                               -> 0 sonstiges
# Die Fotos kommen mit der Vorsilbe "cmp_" in denselben Arbeitsordner wie COCO und werden ans manifest.json angehängt.
#
# Aufruf: python3 cmp_prep.py <arbeitsordner>
import sys,os,io,re,json,zipfile,shutil,subprocess,time,urllib.request,numpy as np
from PIL import Image
W=sys.argv[1];os.makedirs(W+'/dl',exist_ok=True);os.makedirs(W+'/images',exist_ok=True);os.makedirs(W+'/labels',exist_ok=True)
BASE='https://cmp.felk.cvut.cz/~tylecr1/facade/'
ZIPS=['CMP_facade_DB_base.zip','CMP_facade_DB_extended.zip']
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
TO={'facade':2,'molding':2,'cornice':2,'pillar':2,'sill':2,'deco':2,'balcony':2,'window':3,'blind':3,'door':4,'shop':0,'background':0}
# Falls label_names.txt fehlt: Reihenfolge laut Datenbank-Bericht
DEFAULT={1:'background',2:'facade',3:'window',4:'door',5:'cornice',6:'sill',7:'balcony',8:'blind',9:'deco',10:'molding',11:'pillar',12:'shop'}

def fetch(url,dst):
    tmp=dst+'.part'
    for t in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA})
            with urllib.request.urlopen(req,timeout=300) as r,open(tmp,'wb') as f:shutil.copyfileobj(r,f,1<<20)
            os.replace(tmp,dst);return True
        except Exception as e:
            print('  Download fehlgeschlagen',url,e,flush=True)
            if shutil.which('curl') and subprocess.call(['curl','-fsSL','-A',UA,'-o',tmp,url])==0:os.replace(tmp,dst);return True
            time.sleep(5*(t+1))
    return False

man=json.load(open(W+'/manifest.json')) if os.path.exists(W+'/manifest.json') else {'source':'','classes':['sonstiges','Dach','Wand','Fenster','Tür'],'items':[]}
man['items']=[it for it in man['items'] if not it['id'].startswith('cmp_')]
n=0;hist=np.zeros(5)
for zn in ZIPS:
    p=f'{W}/dl/{zn}'
    if not os.path.exists(p):
        print('lade',zn,flush=True)
        if not fetch(BASE+zn,p):sys.exit(f'FEHLER: {BASE+zn} ist nicht erreichbar.')
    with zipfile.ZipFile(p) as z:
        names=z.namelist()
        ln=[x for x in names if x.endswith('label_names.txt')]
        lab=dict(DEFAULT)
        if ln:
            lab={}
            for line in z.read(ln[0]).decode('utf-8','replace').splitlines():
                m=re.match(r'\s*(\d+)\s+(\w+)',line)
                if m:lab[int(m.group(1))]=m.group(2).lower()
        print(zn,'Klassen:',lab,flush=True)
        LUT=np.zeros(256,np.uint8)
        for k,v in lab.items():LUT[k]=TO.get(v,0)
        for jp in [x for x in names if x.lower().endswith('.jpg')]:
            stem=os.path.splitext(os.path.basename(jp))[0];png=jp[:-4]+'.png'
            if png not in names:continue
            a=np.array(Image.open(io.BytesIO(z.read(png))))
            if a.ndim==3:sys.exit('FEHLER: Markierungen sind Farbbilder statt Palettenbilder, Format unbekannt.')
            out=LUT[a];iid='cmp_'+stem
            Image.open(io.BytesIO(z.read(jp))).convert('RGB').save(f'{W}/images/{iid}.jpg',quality=92)
            Image.fromarray(out).save(f'{W}/labels/{iid}.png')
            hist+=np.bincount(out.ravel(),minlength=5)[:5];n+=1
            man['items'].append({'id':iid,'license':'CC BY-SA','url':BASE,'split':'cmp'})
if n<300:sys.exit(f'FEHLER: nur {n} Fotos gefunden.')
src='CMP Facade Database (R. Tyleček, R. Šára), CC BY-SA, '+BASE
if src not in man['source']:man['source']=(man['source']+' | ' if man['source'] else '')+src
json.dump(man,open(W+'/manifest.json','w'),indent=1)
print('fertig:',n,'CMP-Fotos, Anteile',{c:round(float(h/hist.sum()),3) for c,h in zip(man['classes'],hist)},flush=True)
