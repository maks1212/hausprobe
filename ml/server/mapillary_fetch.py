# Mapillary-Fotos für Hausprobe sammeln und vormarkieren.
# 1) sucht in den angegebenen Gegenden Straßenfotos (keine Panoramen), höchstens wenige je Aufnahmefahrt
# 2) lädt sie in 1024 px, berechnet die Bildmerkmale und lässt das Flächenmodell Dach, Wand, Fenster, Tür markieren
# 3) behält nur Fotos, auf denen eine Hauswand gut zu sehen ist, und schreibt Pakete zu je 50 Fotos im Format
#    der Seite "Trainingsdaten" (images/, labels/, manifest.json), dort werden sie geprüft und korrigiert.
# Lizenz der Fotos: CC BY-SA 4.0, Urheber ist der jeweilige Mapillary-Nutzer (steht im manifest.json).
#
# Aufruf: python3 mapillary_fetch.py <modelle-ordner> <arbeitsordner> <anzahl> [regionen.json]
# Der Zugangsschlüssel steht in ~/.mapillary_token. Zum Testen ohne Netz: LOCAL_DIR=<ordner mit jpg>.
import sys,os,io,json,time,random,zipfile,urllib.request,urllib.parse,numpy as np,onnxruntime as ort
from PIL import Image
M,W,WANT=sys.argv[1],sys.argv[2],int(sys.argv[3]);os.makedirs(W+'/raw',exist_ok=True);os.makedirs(W+'/pakete',exist_ok=True)
REG=json.load(open(sys.argv[4])) if len(sys.argv)>4 else {
  # Wohngebiete mit vielen Einfamilienhäusern (Länge links, Breite unten, Länge rechts, Breite oben)
  'Linz Umland':[14.20,48.22,14.36,48.31],'Wels':[13.97,48.13,14.08,48.18],'Steyr':[14.38,48.02,14.46,48.06],
  'Salzburg Umland':[12.95,47.74,13.12,47.85],'Graz Umland':[15.36,47.01,15.52,47.11],'Innsbruck Umland':[11.28,47.24,11.47,47.29],
  'Wien Rand':[16.40,48.24,16.52,48.31],'St. Pölten':[15.58,48.17,15.67,48.22],'Klagenfurt':[14.25,46.60,14.36,46.65],
  'Rosenheim':[12.05,47.83,12.16,47.88],'Passau':[13.40,48.55,13.49,48.59],'Augsburg Umland':[10.82,48.31,10.95,48.40],
  'Freiburg Umland':[7.78,47.96,7.90,48.02],'Winterthur':[8.68,47.48,8.79,47.53],'St. Gallen':[9.33,47.40,9.43,47.44],
  'Luzern Umland':[8.25,47.02,8.36,47.08]}
TH=int(os.environ.get('THREADS',str(os.cpu_count() or 2)));random.seed(int(os.environ.get('SEED','1')))
UA='Hausprobe-Trainingsdaten/1.0'

def api(params):
    tok=open(os.path.expanduser('~/.mapillary_token')).read().strip()
    url='https://graph.mapillary.com/images?'+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={'Authorization':'OAuth '+tok,'User-Agent':UA})
    for t in range(4):
        try:
            with urllib.request.urlopen(req,timeout=60) as r:return json.load(r).get('data',[])
        except Exception as e:
            print('  Suche fehlgeschlagen:',e,flush=True);time.sleep(3*(t+1))
    return []

def candidates():
    # Zufällige Zellen von 0,009 × 0,009 Grad (unter der Grenze von 0,01 Quadratgrad) in den Gegenden absuchen.
    seen_seq={};out=[];names=list(REG)
    for rnd in range(4000):
        if len(out)>=WANT*6:break
        name=names[rnd%len(names)];x0,y0,x1,y1=REG[name]
        cx=random.uniform(x0,x1-.009);cy=random.uniform(y0,y1-.009)
        data=api({'bbox':f'{cx:.5f},{cy:.5f},{cx+.009:.5f},{cy+.009:.5f}','is_pano':'false','limit':200,
                  'fields':'id,thumb_1024_url,creator,captured_at,sequence'})
        random.shuffle(data)
        for d in data:
            s=d.get('sequence','');
            if not d.get('thumb_1024_url') or seen_seq.get(s,0)>=2:continue
            seen_seq[s]=seen_seq.get(s,0)+1;d['region']=name;out.append(d)
        if rnd%20==0:print(f'  Suche {rnd}: {len(out)} Kandidaten',flush=True)
    random.shuffle(out);return out

def download(d):
    p=f"{W}/raw/{d['id']}.jpg"
    if not os.path.exists(p):
        req=urllib.request.Request(d['thumb_1024_url'],headers={'User-Agent':UA})
        with urllib.request.urlopen(req,timeout=60) as r,open(p,'wb') as f:f.write(r.read())
    return p

so=ort.SessionOptions();so.intra_op_num_threads=TH
enc=ort.InferenceSession(M+'/efficient_sam_vitt_encoder.onnx',so,providers=['CPUExecutionProvider'])
seg=ort.InferenceSession(M+'/hausprobe_flaechen.onnx',so,providers=['CPUExecutionProvider'])

def label(im):
    sc=1024/max(im.size);x=np.asarray(im.resize((max(8,round(im.width*sc)),max(8,round(im.height*sc))),Image.BILINEAR),dtype=np.float32).transpose(2,0,1)[None]/255
    e=enc.run(None,{'batched_images':x})[0];p=seg.run(None,{'image_embeddings':e})[0][0]   # 5 × 128 × 128
    # Wahrscheinlichkeiten weich auf Fotogröße bringen, dann die wahrscheinlichste Klasse je Bildpunkt
    up=np.stack([np.asarray(Image.fromarray(p[k].astype(np.float32),mode='F').resize(im.size,Image.BILINEAR)) for k in range(p.shape[0])])
    return up.argmax(0).astype(np.uint8),p.argmax(0)

def write_zip(no,items):
    path=f'{W}/pakete/paket-{no:03d}.zip';man={'format':'hausprobe-label-1','classes':['Hintergrund','Dach','Wand','Fenster','Tür'],'items':[]}
    with zipfile.ZipFile(path,'w',zipfile.ZIP_STORED) as z:
        for d,im,full,stat in items:
            iid='mly'+str(d['id']);b=io.BytesIO();im.save(b,'JPEG',quality=90);z.writestr(f'images/{iid}.jpg',b.getvalue())
            b=io.BytesIO();Image.fromarray(full).save(b,'PNG');z.writestr(f'labels/{iid}.png',b.getvalue())
            man['items'].append({'id':iid,'name':f"Mapillary {d['id']} ({d.get('region','')})",'license':'CC BY-SA',
              'author':(d.get('creator') or {}).get('username',''),'url':f"https://www.mapillary.com/app/?pKey={d['id']}",
              'prelabel':'hausprobe_flaechen','anteile':stat})
        z.writestr('manifest.json',json.dumps(man,ensure_ascii=False,indent=1))
    return path
if os.environ.get('LOCAL_DIR'):
    L=os.environ['LOCAL_DIR'];cands=[{'id':os.path.splitext(f)[0],'local':f'{L}/{f}','creator':{'username':'test'},'region':'lokal'} for f in sorted(os.listdir(L)) if f.endswith('.jpg')]
else:
    print('Suche Fotos in',len(REG),'Gegenden',flush=True);cands=candidates()
print('Kandidaten:',len(cands),flush=True)
# Schon verpackte Fotos überspringen (nach einem Abbruch geht es dort weiter, wo es aufgehört hat).
done=set();npk=0
for f in sorted(os.listdir(W+'/pakete')):
    if f.endswith('.zip'):
        npk+=1
        try:done|={it['id'] for it in json.loads(zipfile.ZipFile(W+'/pakete/'+f).read('manifest.json'))['items']}
        except Exception:pass
total=len(done);print('Bereits verpackt:',total,'Fotos in',npk,'Paketen',flush=True)
kept=[];t0=time.time()
for k,d in enumerate(cands):
    if total>=WANT:break
    if 'mly'+str(d['id']) in done:continue
    try:
        p=d.get('local') or download(d);im=Image.open(p).convert('RGB')
        if max(im.size)>1024:im.thumbnail((1024,1024))
        full,small=label(im)
    except Exception as e:
        print('  übersprungen',d['id'],e,flush=True);continue
    wall=(small==2).mean();win=(small==3).mean();roof=(small==1).mean()
    # Behalten: eine Hauswand füllt einen guten Teil des Bildes, und es sind Fenster zu sehen.
    if wall>=.10 and win>=.004:
        kept.append((d,im,full,{'wall':round(float(wall),3),'window':round(float(win),3),'roof':round(float(roof),3)}));total+=1
        done.add('mly'+str(d['id']))
        if len(kept)==50:npk+=1;print('Paket',write_zip(npk,kept),flush=True);kept=[]
    if k%20==0:
        el=time.time()-t0;print(f'  geprüft {k+1}, behalten {total}  ({el/(k+1):.1f} s je Foto)',flush=True)
if kept:npk+=1;print('Paket',write_zip(npk,kept),flush=True)
print(f'FERTIG: {total} Fotos in {npk} Paketen',flush=True)
