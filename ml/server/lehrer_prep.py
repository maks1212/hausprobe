# Vom großen Modell markierte Mapillary-Fotos (Branch "lehrer-ergebnis") für das Training aufbereiten.
# Fotos, die du auf der Label-Seite korrigiert hast (Branch "daten", Ordner korrigiert/), haben Vorrang.
# Aufruf: python3 lehrer_prep.py <arbeitsordner> <repo>
import sys,os,io,json,zipfile,subprocess,numpy as np
from PIL import Image
W,REPO=sys.argv[1],sys.argv[2]
for d in('images','labels'):os.makedirs(f'{W}/{d}',exist_ok=True)
def git(*a):return subprocess.run(['git','-C',REPO,*a],capture_output=True,check=False)
man=json.load(open(W+'/manifest.json')) if os.path.exists(W+'/manifest.json') else {'source':'','classes':['sonstiges','Dach','Wand','Fenster','Tür'],'items':[]}
man['items']=[it for it in man['items'] if not it['id'].startswith('mly')]
got={}
for br,split in(('lehrer-ergebnis','lehrer'),('daten','korrigiert')):
    if git('fetch','-q','origin',f'+refs/heads/{br}:refs/remotes/origin/{br}').returncode:print('kein Branch',br,flush=True);continue
    files=[f for f in git('ls-tree','-r','--name-only',f'refs/remotes/origin/{br}').stdout.decode().split() if f.endswith('.zip') and (split=='lehrer' or f.startswith('korrigiert/'))]
    for f in sorted(files):
        z=zipfile.ZipFile(io.BytesIO(git('show',f'refs/remotes/origin/{br}:{f}').stdout))
        for it in json.loads(z.read('manifest.json'))['items']:
            i=it['id'];lp=f'labels/{i}.png'
            if lp not in z.namelist():continue
            open(f'{W}/images/{i}.jpg','wb').write(z.read(f'images/{i}.jpg'))
            lab=np.array(Image.open(io.BytesIO(z.read(lp))));lab[lab>4]=0
            Image.fromarray(lab.astype(np.uint8)).save(f'{W}/labels/{i}.png')
            got[i]={'id':i,'license':it.get('license','CC BY-SA'),'author':it.get('author',''),'url':it.get('url',''),'split':split}
man['items']+=list(got.values())
src='Mapillary (CC BY-SA), markiert mit Grounding DINO + SAM (Apache 2.0)'
if src not in man['source']:man['source']=(man['source']+' | ' if man['source'] else '')+src
json.dump(man,open(W+'/manifest.json','w'),indent=1)
print('fertig:',len(got),'Mapillary-Fotos, davon korrigiert',sum(1 for v in got.values() if v['split']=='korrigiert'),flush=True)
