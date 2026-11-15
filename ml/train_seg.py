# Dach, Wand, Fenster, Tür als Flächen: kleiner Kopf auf den EfficientSAM-Merkmalen (256 x 64 x 64).
# Eingabe: ein oder mehrere ZIP-Exporte aus label.html (images/, labels/, manifest.json).
# Aufruf:  python3 train_seg.py <modelle-ordner> <ausgabe-ordner> export1.zip [export2.zip ...]
# Die Merkmale werden beim ersten Lauf berechnet (rund 2 s je Foto auf 2 CPU-Kernen) und zwischengespeichert.
# Klassen in den Markierungen: 0 nicht markiert, 1 Dach, 2 Wand, 3 Fenster, 4 Tür.
# Nur Klassen, die im Export als "vollständig" angehakt sind, zählen überall; sonst lernt der Kopf nur an markierten Stellen.
import sys,os,io,json,zipfile,math,random,time,numpy as np,onnxruntime as ort,torch,torch.nn as nn,torch.nn.functional as F
from PIL import Image
torch.set_num_threads(int(os.environ.get('THREADS','2')));torch.manual_seed(0);random.seed(0);np.random.seed(0)
G=64;R=256;KEYS=['roof','wall','window','door'];NC=4
OK_LIC={'own','permission','CC0','CC BY','CC BY-SA'}

def load_exports(model_dir,out_dir,zips):
    enc=None;cache=out_dir+'/emb';os.makedirs(cache,exist_ok=True);items=[]
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            man=json.loads(zf.read('manifest.json'))
            for it in man['items']:
                if it.get('license') not in OK_LIC:print('übersprungen (Lizenz):',it['id']);continue
                cf=f"{cache}/{it['id']}.npz"
                if not os.path.exists(cf):
                    if enc is None:
                        so=ort.SessionOptions();so.intra_op_num_threads=int(os.environ.get('THREADS','2'))
                        enc=ort.InferenceSession(model_dir+'/efficient_sam_vitt_encoder.onnx',so,providers=['CPUExecutionProvider'])
                    im=Image.open(io.BytesIO(zf.read(f"images/{it['id']}.jpg"))).convert('RGB')
                    sc=1024/max(im.size);w,h=max(8,round(im.width*sc)),max(8,round(im.height*sc))
                    x=np.asarray(im.resize((w,h),Image.BILINEAR),dtype=np.float32).transpose(2,0,1)[None]/255
                    np.savez(cf,e=enc.run(None,{'batched_images':x})[0][0].astype(np.float16))
                lab=np.array(Image.open(io.BytesIO(zf.read(f"labels/{it['id']}.png"))).convert('L').resize((R,R),Image.NEAREST))
                comp=np.array([bool(it.get('complete',{}).get(k)) for k in KEYS])
                items.append((it['id'],cf,lab,comp))
    return items

def targets(lab,comp):
    # y: Zielwert je Klasse, m: 1 wo bewertet wird. Markierte Pixel einer Klasse sind positiv und für alle anderen
    # Klassen negativ. Unmarkierte Pixel sind nur für vollständig markierte Klassen negativ.
    y=np.zeros((NC,R,R),np.float32);m=np.zeros((NC,R,R),np.float32);marked=lab>0
    for k in range(NC):
        pos=lab==k+1;y[k]=pos
        m[k]=np.where(marked,1,1 if comp[k] else 0)
    return y,m

class SegHead(nn.Module):
    def __init__(s,ch=128):
        super().__init__()
        s.inp=nn.Sequential(nn.Conv2d(256,ch,1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True))
        s.body=nn.Sequential(nn.Conv2d(ch,ch,3,padding=1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True),
                             nn.Conv2d(ch,ch,3,padding=2,dilation=2),nn.GroupNorm(8,ch),nn.ReLU(inplace=True))
        s.up=nn.Sequential(nn.ConvTranspose2d(ch,64,4,stride=4),nn.GroupNorm(8,64),nn.ReLU(inplace=True),nn.Conv2d(64,64,3,padding=1),nn.ReLU(inplace=True))
        s.out=nn.Conv2d(64,NC,1)
    def forward(s,e):
        x=s.inp(e*30.0);x=x+s.body(x);return torch.sigmoid(s.out(s.up(x)))

def loss_fn(p,y,m):
    p=p.clamp(1e-4,1-1e-4);bce=-(y*torch.log(p)+(1-y)*torch.log(1-p))*m
    l=bce.sum()/m.sum().clamp(min=1)
    inter=(p*y*m).sum((2,3));den=((p+y)*m).sum((2,3));dice=1-(2*inter+1)/(den+1)
    return l+dice.mean()

def iou_eval(model,data):
    model.eval();I=np.zeros(NC);U=np.zeros(NC)
    with torch.no_grad():
        for _,cf,lab,comp in data:
            p=model(torch.from_numpy(np.load(cf)['e'].astype(np.float32))[None])[0].numpy()>.5
            for k in range(NC):
                if not comp[k]:continue
                g=lab==k+1;I[k]+=(p[k]&g).sum();U[k]+=(p[k]|g).sum()
    model.train();return {KEYS[k]:(round(I[k]/U[k],3) if U[k] else None) for k in range(NC)}

if __name__=='__main__':
    model_dir,out_dir,zips=sys.argv[1],sys.argv[2],sys.argv[3:];os.makedirs(out_dir,exist_ok=True)
    epochs=int(os.environ.get('EPOCHS','60'))
    data=load_exports(model_dir,out_dir,zips);random.shuffle(data)
    nv=max(1,len(data)//6);va,tr=data[:nv],data[nv:] if len(data)>1 else data
    print('Fotos',len(data),'Training',len(tr),'Prüfung',len(va),flush=True)
    T=[targets(lab,comp) for _,_,lab,comp in tr];E=[np.load(cf)['e'].astype(np.float32) for _,cf,_,_ in tr]
    model=SegHead();opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4)
    bs=4;sched=torch.optim.lr_scheduler.OneCycleLR(opt,max_lr=1e-3,total_steps=epochs*math.ceil(len(tr)/bs));t0=time.time()
    for ep in range(epochs):
        idx=list(range(len(tr)));random.shuffle(idx);tot=0
        for s in range(0,len(idx),bs):
            bi=idx[s:s+bs];e=F.dropout2d(torch.from_numpy(np.stack([E[i] for i in bi])),.1)
            y=torch.from_numpy(np.stack([T[i][0] for i in bi]));m=torch.from_numpy(np.stack([T[i][1] for i in bi]))
            loss=loss_fn(model(e),y,m);opt.zero_grad();loss.backward();opt.step();sched.step();tot+=loss.item()*len(bi)
        if ep%10==9 or ep==epochs-1:print(f'ep {ep} loss {tot/len(tr):.3f} {round(time.time()-t0)}s IoU {iou_eval(model,va)}',flush=True)
    torch.save(model.state_dict(),out_dir+'/hausprobe_flaechen.pt');model.eval()
    torch.onnx.export(model,(torch.zeros(1,256,G,G),),out_dir+'/hausprobe_flaechen.onnx',input_names=['image_embeddings'],output_names=['classes'],opset_version=17,dynamo=False)
    print('gespeichert',out_dir+'/hausprobe_flaechen.onnx')
