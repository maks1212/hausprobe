# Fenster- und Türerkennung als kleiner Kopf auf den EfficientSAM-Merkmalen (256 x 64 x 64).
# Mittelpunkt-Ansatz (CenterNet): je Klasse eine Wärmekarte der Objektmitten plus Breite/Höhe und Versatz je Zelle.
# Das Gitter deckt das ganze Bild ab (der Encoder streckt jedes Bild auf 1024 x 1024).
import sys,os,glob,math,time,json,random,numpy as np,torch,torch.nn as nn,torch.nn.functional as F
torch.set_num_threads(int(os.environ.get('THREADS','2')));torch.manual_seed(0);random.seed(0);np.random.seed(0)
G=64;NC=2  # Klassen: 0 Fenster, 1 Tür
YOLO_MAP={0:0,4:0,5:1}  # window, win_ad -> Fenster; door -> Tür; Rest (Schild, Kragdach, Torbogen) ist Hintergrund

def load_split(emb_dir,lab_dir):
    out=[]
    for f in sorted(glob.glob(emb_dir+'/*.npz')):
        n=os.path.splitext(os.path.basename(f))[0];lf=f'{lab_dir}/{n}.txt'
        boxes=[]
        if os.path.exists(lf):
            for l in open(lf):
                p=l.split()
                if len(p)<5:continue
                c=int(p[0])
                if c in YOLO_MAP:boxes.append((YOLO_MAP[c],*map(float,p[1:5])))
        e=np.load(f)['e'].astype(np.float32)
        out.append((n,e,boxes))
    return out

def gaussian_radius(w,h,min_overlap=.7):
    a1=1;b1=h+w;c1=w*h*(1-min_overlap)/(1+min_overlap);r1=(b1+math.sqrt(b1*b1-4*a1*c1))/2
    a2=4;b2=2*(h+w);c2=(1-min_overlap)*w*h;r2=(b2+math.sqrt(b2*b2-4*a2*c2))/2
    a3=4*min_overlap;b3=-2*min_overlap*(h+w);c3=(min_overlap-1)*w*h;r3=(b3+math.sqrt(b3*b3-4*a3*c3))/2
    return max(0.,min(r1,r2,r3))

def targets(boxes,flip=False):
    hm=np.zeros((NC,G,G),np.float32);wh=np.zeros((2,G,G),np.float32);off=np.zeros((2,G,G),np.float32);m=np.zeros((G,G),np.float32)
    ys,xs=np.mgrid[0:G,0:G]
    for c,x,y,w,h in boxes:
        if flip:x=1-x
        cx,cy,bw,bh=x*G,y*G,w*G,h*G
        if bw<.3 or bh<.3:continue
        ix,iy=min(G-1,int(cx)),min(G-1,int(cy))
        r=max(.5,gaussian_radius(bw,bh))/3*1.0+.3
        g=np.exp(-((xs-ix)**2+(ys-iy)**2)/(2*r*r));hm[c]=np.maximum(hm[c],g)
        wh[:,iy,ix]=(math.log(bw),math.log(bh));off[:,iy,ix]=(cx-ix,cy-iy);m[iy,ix]=1
    return hm,wh,off,m

class Head(nn.Module):
    def __init__(s,ch=128):
        super().__init__()
        s.inp=nn.Sequential(nn.Conv2d(256,ch,1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True))
        s.body=nn.Sequential(nn.Conv2d(ch,ch,3,padding=1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True),
                             nn.Conv2d(ch,ch,3,padding=2,dilation=2),nn.GroupNorm(8,ch),nn.ReLU(inplace=True),
                             nn.Conv2d(ch,ch,3,padding=1),nn.GroupNorm(8,ch),nn.ReLU(inplace=True))
        s.hm=nn.Conv2d(ch,NC,1);s.wh=nn.Conv2d(ch,2,1);s.off=nn.Conv2d(ch,2,1)
        nn.init.constant_(s.hm.bias,-2.19)
    def forward(s,e):
        x=s.inp(e*30.0);x=x+s.body(x)
        return torch.sigmoid(s.hm(x)),s.wh(x),torch.sigmoid(s.off(x))

def focal(p,t):
    p=p.clamp(1e-4,1-1e-4);pos=t.eq(1).float();neg=1-pos
    pl=torch.log(p)*(1-p)**2*pos;nl=torch.log(1-p)*p**2*(1-t)**4*neg
    n=pos.sum()
    return -(pl.sum()+nl.sum())/max(1.,n.item())

def decode(hm,wh,off,thr=.3,k=100):
    # hm: (NC,G,G) numpy. Lokale Maxima über einer Schwelle werden zu Kästen (0..1).
    t=torch.from_numpy(hm)[None];mx=F.max_pool2d(t,3,1,1)[0].numpy();out=[]
    for c in range(NC):
        ys,xs=np.where((hm[c]==mx[c])&(hm[c]>=thr))
        for y,x in zip(ys,xs):
            bw,bh=math.exp(wh[0,y,x]),math.exp(wh[1,y,x]);cx,cy=x+off[0,y,x],y+off[1,y,x]
            out.append((c,float(hm[c,y,x]),(cx-bw/2)/G,(cy-bh/2)/G,(cx+bw/2)/G,(cy+bh/2)/G))
    out.sort(key=lambda b:-b[1]);return out[:k]

def iou(a,b):
    ix=max(0,min(a[2],b[2])-max(a[0],b[0]));iy=max(0,min(a[3],b[3])-max(a[1],b[1]));i=ix*iy
    u=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i;return i/u if u>0 else 0

def evaluate(model,data,thr=.3):
    model.eval();tp=[0]*NC;fp=[0]*NC;fn=[0]*NC
    with torch.no_grad():
        for n,e,boxes in data:
            hm,wh,off=model(torch.from_numpy(e)[None]);dets=decode(hm[0].numpy(),wh[0].numpy(),off[0].numpy(),thr)
            gts=[(c,(x-w/2,y-h/2,x+w/2,y+h/2)) for c,x,y,w,h in boxes]
            for c in range(NC):
                g=[b for cc,b in gts if cc==c];d=[b[2:] for b in dets if b[0]==c];used=set()
                for db in d:
                    best=-1;bi=-1
                    for j,gb in enumerate(g):
                        if j in used:continue
                        v=iou(db,gb)
                        if v>best:best,bi=v,j
                    if best>=.5:tp[c]+=1;used.add(bi)
                    else:fp[c]+=1
                fn[c]+=len(g)-len(used)
    model.train()
    return [dict(P=round(tp[c]/max(1,tp[c]+fp[c]),3),R=round(tp[c]/max(1,tp[c]+fn[c]),3)) for c in range(NC)]

if __name__=='__main__':
    S=sys.argv[1];D=sys.argv[2];out=sys.argv[3];epochs=int(os.environ.get('EPOCHS','12'))  # länger trainiert passt es sich zu sehr an die Stadtfassaden an
    tr=load_split(S+'/emb/train',D+'/labels/train');va=load_split(S+'/emb/test',D+'/labels/test')
    print('train',len(tr),'val',len(va),flush=True)
    model=Head();opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4)
    sched=torch.optim.lr_scheduler.OneCycleLR(opt,max_lr=1e-3,total_steps=epochs*math.ceil(len(tr)/8))
    T=[targets(b) for _,_,b in tr];t0=time.time();best=-1
    for ep in range(epochs):
        idx=list(range(len(tr)));random.shuffle(idx);tot=0
        for s in range(0,len(idx),8):
            bi=idx[s:s+8]
            e=torch.from_numpy(np.stack([tr[i][1] for i in bi]))
            e=F.dropout2d(e,.1)  # einzelne Merkmalskanäle weglassen: weniger Auswendiglernen
            hm=torch.from_numpy(np.stack([T[i][0] for i in bi]));wh=torch.from_numpy(np.stack([T[i][1] for i in bi]))
            off=torch.from_numpy(np.stack([T[i][2] for i in bi]));m=torch.from_numpy(np.stack([T[i][3] for i in bi]))[:,None]
            ph,pw,po=model(e)
            loss=focal(ph,hm)+.1*(F.l1_loss(pw*m,wh*m,reduction='sum')/m.sum().clamp(min=1))+(F.l1_loss(po*m,off*m,reduction='sum')/m.sum().clamp(min=1))
            opt.zero_grad();loss.backward();opt.step();sched.step();tot+=loss.item()*len(bi)
        msg=f'ep {ep} loss {tot/len(tr):.3f} {round(time.time()-t0)}s'
        if ep%5==4 or ep==epochs-1:
            r=evaluate(model,va);msg+=f' val Fenster {r[0]} Tür {r[1]}'
            f1=2*r[0]['P']*r[0]['R']/max(1e-6,r[0]['P']+r[0]['R'])
            if f1>best:best=f1;torch.save(model.state_dict(),out+'.pt')
        print(msg,flush=True)
    model.load_state_dict(torch.load(out+'.pt'));model.eval()
    for thr in (.2,.3,.4,.5):print('thr',thr,evaluate(model,va,thr))
    e=torch.zeros(1,256,G,G)
    torch.onnx.export(model,(e,),out+'.onnx',input_names=['image_embeddings'],output_names=['heat','size','offset'],opset_version=17,dynamo=False)
    print('saved',out+'.onnx',os.path.getsize(out+'.onnx'))
