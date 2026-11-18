# Flächenmodell für Hausprobe: Dach, Wand, Fenster, Tür als Kopf auf den EfficientSAM-Bildmerkmalen.
# Schritt 1 berechnet die Merkmale (einmal je Foto, wird zwischengespeichert), Schritt 2 trainiert, Schritt 3 exportiert ONNX.
# Aufruf: python3 train_flaechen.py <modelle-ordner> <arbeitsordner>
# Ergebnis: <arbeitsordner>/out/hausprobe_flaechen.onnx, bericht.txt und Vorschaubilder.
import sys,os,json,math,time,random,numpy as np,onnxruntime as ort,torch,torch.nn as nn,torch.nn.functional as F
from PIL import Image
TH=int(os.environ.get('THREADS',str(os.cpu_count() or 2)));torch.set_num_threads(TH);torch.manual_seed(0);random.seed(0);np.random.seed(0)
M,W=sys.argv[1],sys.argv[2];OUT=W+'/out';FEAT=W+'/feat';os.makedirs(OUT,exist_ok=True);os.makedirs(FEAT,exist_ok=True)
EPOCHS=int(os.environ.get('EPOCHS','30'));R=128;G=64;NC=5;NAMES=['sonstiges','Dach','Wand','Fenster','Tür']
man=json.load(open(W+'/manifest.json'));ids=[it['id'] for it in man['items'] if os.path.exists(f"{W}/images/{it['id']}.jpg")]

# 1) Merkmale wie in der App: längste Seite 1024, RGB/255.
so=ort.SessionOptions();so.intra_op_num_threads=TH
enc=None;t0=time.time();todo=[i for i in ids if not os.path.exists(f'{FEAT}/{i}.npy')]
for k,i in enumerate(todo):
    if enc is None:enc=ort.InferenceSession(M+'/efficient_sam_vitt_encoder.onnx',so,providers=['CPUExecutionProvider'])
    try:im=Image.open(f'{W}/images/{i}.jpg').convert('RGB')
    except Exception:continue
    sc=1024/max(im.size);x=np.asarray(im.resize((max(8,round(im.width*sc)),max(8,round(im.height*sc))),Image.BILINEAR),dtype=np.float32).transpose(2,0,1)[None]/255
    np.save(f'{FEAT}/{i}.npy',enc.run(None,{'batched_images':x})[0][0].astype(np.float16))
    if k%100==0:
        el=time.time()-t0;print(f'Merkmale {k}/{len(todo)}  noch etwa {round(el/max(1,k)*(len(todo)-k)/60)} min',flush=True)
enc=None
ids=[i for i in ids if os.path.exists(f'{FEAT}/{i}.npy')]
def quelle(i):return 'CMP' if i.startswith('cmp_') else 'Mapillary' if i.startswith('mly') else 'COCO'
random.shuffle(ids)
# Prüfung: 10 % COCO/CMP, aber 20 % der Mapillary-Fotos (die zählen am meisten). Korrigierte Fotos kommen immer zuerst in die Prüfung.
SPLIT={it['id']:it.get('split','') for it in man['items']}
mly=sorted([i for i in ids if quelle(i)=='Mapillary'],key=lambda i:SPLIT.get(i)!='korrigiert');rest=[i for i in ids if quelle(i)!='Mapillary']
nm=max(10,len(mly)//5) if mly else 0;nv=max(20,len(rest)//10)
va=mly[:nm]+rest[:nv];tr=rest[nv:]+mly[nm:]*int(os.environ.get('MLY_X','3'))   # Mapillary im Training mehrfach, weil es genau unsere Fotos sind
print('Training',len(tr),'Prüfung',len(va),flush=True)
def label(i):  # gestreckt auf das Gitter, wie der Encoder das Bild sieht
    return np.array(Image.open(f'{W}/labels/{i}.png').resize((R,R),Image.NEAREST),dtype=np.uint8)
LAB={i:label(i) for i in ids}
cnt=np.zeros(NC)
for i in tr:cnt+=np.bincount(LAB[i].ravel(),minlength=NC)[:NC]
wt=torch.tensor((cnt.sum()/(NC*np.maximum(cnt,1)))**.5,dtype=torch.float32);wt=wt/wt.mean()
print('Anteile',{NAMES[k]:round(float(cnt[k]/cnt.sum()),3) for k in range(NC)},'Gewichte',[round(float(v),2) for v in wt],flush=True)

class Head(nn.Module):
    def __init__(s,ch=96):
        super().__init__()
        s.inp=nn.Sequential(nn.Conv2d(256,ch,1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True))
        s.body=nn.Sequential(nn.Conv2d(ch,ch,3,padding=1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True),
                             nn.Conv2d(ch,ch,3,padding=2,dilation=2),nn.GroupNorm(8,ch),nn.ReLU(inplace=True),
                             nn.Conv2d(ch,ch,3,padding=4,dilation=4),nn.GroupNorm(8,ch),nn.ReLU(inplace=True))
        s.up=nn.Sequential(nn.ConvTranspose2d(ch,48,2,stride=2),nn.GroupNorm(8,48),nn.ReLU(inplace=True),nn.Conv2d(48,48,3,padding=1),nn.ReLU(inplace=True))
        s.out=nn.Conv2d(48,NC,1)
    def forward(s,e):
        x=s.inp(e*30.0);x=x+s.body(x);return s.out(s.up(x))
class Export(nn.Module):  # liefert Wahrscheinlichkeiten je Klasse
    def __init__(s,h):super().__init__();s.h=h
    def forward(s,e):return torch.softmax(s.h(e),1)

def feat(i):return torch.from_numpy(np.load(f'{FEAT}/{i}.npy').astype(np.float32))
def iou(model,data):
    model.eval();I=np.zeros(NC);U=np.zeros(NC)
    with torch.no_grad():
        for s in range(0,len(data),8):
            b=data[s:s+8];p=model(torch.stack([feat(i) for i in b])).argmax(1).numpy()
            for j,i in enumerate(b):
                g=LAB[i]
                for k in range(1,NC):I[k]+=((p[j]==k)&(g==k)).sum();U[k]+=((p[j]==k)|(g==k)).sum()
    model.train();return {NAMES[k]:round(float(I[k]/max(1,U[k])),3) for k in range(1,NC)}

model=Head();opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4);bs=8
sched=torch.optim.lr_scheduler.OneCycleLR(opt,max_lr=1e-3,total_steps=EPOCHS*math.ceil(len(tr)/bs));best=-1;t0=time.time();log=[]
for ep in range(EPOCHS):
    random.shuffle(tr);tot=0
    for s in range(0,len(tr),bs):
        b=tr[s:s+bs];e=F.dropout2d(torch.stack([feat(i) for i in b]),.1);y=torch.from_numpy(np.stack([LAB[i] for i in b]).astype(np.int64))
        o=model(e);p=torch.softmax(o,1);oh=F.one_hot(y,NC).permute(0,3,1,2).float()
        dice=1-(2*(p*oh).sum((2,3))+1)/((p+oh).sum((2,3))+1)
        loss=F.cross_entropy(o,y,weight=wt)+dice[:,1:].mean()
        opt.zero_grad();loss.backward();opt.step();sched.step();tot+=loss.item()*len(b)
    msg=f'Durchgang {ep+1}/{EPOCHS} Verlust {tot/len(tr):.3f} {round((time.time()-t0)/60)} min'
    if ep%3==2 or ep==EPOCHS-1:
        r=iou(model,va);msg+=f' IoU {r}';score=r['Dach']+r['Wand']+.5*(r['Fenster']+r['Tür'])
        if score>best:best=score;torch.save(model.state_dict(),OUT+'/hausprobe_flaechen.pt');msg+=' (bester Stand)'
    print(msg,flush=True);log.append(msg)

model.load_state_dict(torch.load(OUT+'/hausprobe_flaechen.pt'));model.eval();final=iou(model,va)
# Getrennt nach Quelle, damit sichtbar ist, ob ganze Häuser (COCO) unter den Fassadenausschnitten (CMP) leiden.
for name in ('COCO','CMP','Mapillary'):
    sel=[i for i in va if quelle(i)==name]
    if sel:r=iou(model,sel);log.append(f'IoU nur {name} ({len(sel)} Fotos): {r}');print(log[-1],flush=True)
# Zum Vergleich das bisherige App-Modell auf denselben Prüffotos.
if os.path.exists(M+'/hausprobe_flaechen_alt.onnx'):
    alt=ort.InferenceSession(M+'/hausprobe_flaechen_alt.onnx',providers=['CPUExecutionProvider'])
    class Alt:
        def eval(s):pass
        def train(s):pass
        def __call__(s,e):return torch.cat([torch.from_numpy(alt.run(None,{'image_embeddings':e[k:k+1].numpy()})[0]) for k in range(len(e))])
    for name in ('COCO','Mapillary'):
        sel=[i for i in va if quelle(i)==name]
        if sel:r=iou(Alt(),sel);log.append(f'IoU bisheriges Modell, nur {name} ({len(sel)} Fotos): {r}');print(log[-1],flush=True)
torch.onnx.export(Export(model),(torch.zeros(1,256,G,G),),OUT+'/hausprobe_flaechen.onnx',input_names=['image_embeddings'],output_names=['classes'],opset_version=17,dynamo=False)
# Vorschau: 12 Prüffotos mit eingefärbten Klassen
COL=np.array([[0,0,0],[224,72,58],[60,127,214],[242,194,48],[54,179,126]],np.uint8);tiles=[]
with torch.no_grad():
    for i in ([i for i in va if quelle(i)=='Mapillary'][:8]+[i for i in va if quelle(i)=='COCO'][:4] or va[:12])[:12]:
        im=Image.open(f'{W}/images/{i}.jpg').convert('RGB').resize((320,240));p=model(feat(i)[None]).argmax(1)[0].numpy().astype(np.uint8)
        m=Image.fromarray(COL[p]).resize((320,240),Image.NEAREST);a=Image.fromarray(np.where(np.array(Image.fromarray(p).resize((320,240),Image.NEAREST))[...,None]>0,(np.array(im)*.45+np.array(m)*.55).astype(np.uint8),np.array(im)))
        tiles.append(a)
g=Image.new('RGB',(320*4,240*3),'white')
for k,t in enumerate(tiles):g.paste(t,((k%4)*320,(k//4)*240))
g.save(OUT+'/vorschau.jpg',quality=85)
open(OUT+'/bericht.txt','w').write('\n'.join(log+[f'Endstand IoU {final}',f'Fotos Training {len(tr)} Prüfung {len(va)}',man['source']])+'\n')
print('FERTIG',OUT+'/hausprobe_flaechen.onnx',final,flush=True)
