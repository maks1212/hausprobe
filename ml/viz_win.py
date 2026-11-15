# Fenstermodell (ONNX) auf vorberechneten Merkmalen ausführen und Kästen einzeichnen.
import sys,glob,os,math,numpy as np,onnxruntime as ort
from PIL import Image,ImageDraw
model,emb_dir,img_dir,out=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4];thr=float(sys.argv[5]) if len(sys.argv)>5 else .3
names=sys.argv[6].split(',') if len(sys.argv)>6 else None
s=ort.InferenceSession(model,providers=['CPUExecutionProvider'])
def peaks(hm,wh,off,thr):
    NC,G,GW=hm.shape;res=[]
    for c in range(NC):
        for y in range(G):
            for x in range(GW):
                v=hm[c,y,x]
                if v<thr:continue
                if v<hm[c,max(0,y-1):y+2,max(0,x-1):x+2].max():continue
                bw,bh=math.exp(wh[0,y,x]),math.exp(wh[1,y,x]);cx,cy=x+off[0,y,x],y+off[1,y,x]
                res.append((c,v,(cx-bw/2)/GW,(cy-bh/2)/G,(cx+bw/2)/GW,(cy+bh/2)/G))
    return res
fs=sorted(glob.glob(emb_dir+'/*.npz'))
if names:fs=[f for f in fs if os.path.splitext(os.path.basename(f))[0] in names]
tiles=[]
for f in fs:
    n=os.path.splitext(os.path.basename(f))[0];e=np.load(f)['e'].astype(np.float32)[None]
    hm,wh,off=s.run(None,{'image_embeddings':e})
    im=Image.open(glob.glob(f'{img_dir}/{n}.*')[0]).convert('RGB');im.thumbnail((640,640));d=ImageDraw.Draw(im);W,H=im.size
    for c,v,x0,y0,x1,y1 in peaks(hm[0],wh[0],off[0],thr):
        d.rectangle([x0*W,y0*H,x1*W,y1*H],outline='yellow' if c==0 else 'lime',width=3);d.text((x0*W+2,y0*H+1),f'{v:.2f}',fill='white')
    d.text((4,4),n,fill='red');tiles.append(im)
cw,ch=480,360;cols=4;rows=(len(tiles)+cols-1)//cols;g=Image.new('RGB',(cw*cols,ch*rows),'white')
for i,im in enumerate(tiles):im.thumbnail((cw,ch));g.paste(im,((i%cols)*cw,(i//cols)*ch))
g.save(out,quality=85);print('saved',out,len(tiles))
