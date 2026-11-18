# Lehrer-Markierung: zwei große, frei lizenzierte Modelle markieren Hausfotos automatisch.
#   Grounding DINO (IDEA-Research, Apache 2.0) findet Kästen zu Wörtern wie "roof", "window", "door".
#   SAM (Meta, Apache 2.0) schneidet in jedem Kasten die genaue Fläche aus.
# Ergebnis: Pakete im Label-Format (hausprobe-label-1), die die Label-Seite öffnen kann und mit denen das
# kleine App-Modell trainiert wird. Läuft auf GitHub-Rechnern (zu groß für den IONOS-Server).
#
# Aufruf: python3 lehrer.py <auftrag.json> <eingangsordner mit paket-*.zip> <ausgabeordner>
import sys,os,io,json,time,zipfile,numpy as np,torch
from PIL import Image,ImageDraw
torch.set_num_threads(os.cpu_count() or 2)
A=json.load(open(sys.argv[1]));IN=sys.argv[2];OUT=sys.argv[3];os.makedirs(OUT,exist_ok=True)
DINO=A.get('dino','IDEA-Research/grounding-dino-base');SAM=A.get('sam','facebook/sam-vit-large')
MAXN=int(A.get('max',100000));MAXS=int(A.get('max_sekunden',5*3600))
PROMPT='house. building. facade. roof. window. door. garage door.'
TH={1:.30,2:.30,3:.25,4:.30}

from transformers import AutoProcessor,AutoModelForZeroShotObjectDetection,SamModel,SamProcessor
t0=time.time()
dp=AutoProcessor.from_pretrained(DINO);dm=AutoModelForZeroShotObjectDetection.from_pretrained(DINO).eval()
sp=SamProcessor.from_pretrained(SAM);sm=SamModel.from_pretrained(SAM).eval()
print(f'Modelle geladen in {time.time()-t0:.0f} s',flush=True)

def cls_of(t):
    t=t.lower()
    if 'window' in t:return 3
    if 'door' in t:return 4
    if 'roof' in t:return 1
    if 'house' in t or 'building' in t or 'facade' in t:return 2
    return 0

@torch.no_grad()
def label(im):
    W,H=im.size
    inp=dp(images=im,text=PROMPT,return_tensors='pt');out=dm(**inp)
    try:r=dp.post_process_grounded_object_detection(out,inp.input_ids,threshold=.22,text_threshold=.2,target_sizes=[(H,W)])[0]
    except TypeError:r=dp.post_process_grounded_object_detection(out,inp.input_ids,box_threshold=.22,text_threshold=.2,target_sizes=[(H,W)])[0]
    names=r.get('text_labels',r['labels'])
    boxes=[];cl=[];sc=[]
    for b,s,t in zip(r['boxes'].tolist(),r['scores'].tolist(),names):
        c=cls_of(str(t))
        if c==0 or s<TH[c]:continue
        x0,y0,x1,y1=[max(0,v) for v in b];x1=min(x1,W);y1=min(y1,H);a=(x1-x0)*(y1-y0)/(W*H)
        if a<=0:continue
        if c in(3,4) and a>.15:continue            # ganze Fassade als "Fenster" erkannt
        if c==4 and a<.002:continue
        boxes.append([x0,y0,x1,y1]);cl.append(c);sc.append(s)
    # Ein "Fenster"- oder "Tür"-Kasten, der drei oder mehr andere Fenster enthält, ist eine ganze Fassade.
    def inside(a,b):return a[0]>=b[0]-2 and a[1]>=b[1]-2 and a[2]<=b[2]+2 and a[3]<=b[3]+2
    keep=[not(c in(3,4) and sum(1 for b2,c2 in zip(boxes,cl) if c2==3 and b2 is not b and inside(b2,b))>=3) for b,c in zip(boxes,cl)]
    boxes=[b for b,k in zip(boxes,keep) if k];cl=[c for c,k in zip(cl,keep) if k];sc=[x for x,k in zip(sc,keep) if k]
    if not any(c==2 for c in cl):return None,{}
    si=sp(im,return_tensors='pt');emb=sm.get_image_embeddings(si['pixel_values'])
    masks=[]
    for k in range(0,len(boxes),32):
        bi=sp(im,input_boxes=[boxes[k:k+32]],return_tensors='pt');bi.pop('pixel_values',None)
        o=sm(image_embeddings=emb,input_boxes=bi['input_boxes'],multimask_output=False)
        m=sp.image_processor.post_process_masks(o.pred_masks,bi['original_sizes'],bi['reshaped_input_sizes'])[0][:,0].numpy()
        masks.extend(list(m))
    lab=np.zeros((H,W),np.uint8)
    # Reihenfolge: Wand (Haus), dann Dach, dann Fenster und Türen darüber.
    for want in(2,1,3,4):
        for b,c,m in zip(boxes,cl,masks):
            if c!=want:continue
            x0,y0,x1,y1=[int(round(v)) for v in b];mm=np.zeros_like(m);mm[y0:y1,x0:x1]=m[y0:y1,x0:x1]
            if c in(3,4) and mm.sum()<.4*(x1-x0)*(y1-y0):mm[y0:y1,x0:x1]=True   # SAM hat nur einen Teil erwischt: ganzer Kasten
            lab[mm]=c
    f=np.bincount(lab.ravel(),minlength=5)/lab.size
    return lab,{'roof':round(float(f[1]),3),'wall':round(float(f[2]),3),'window':round(float(f[3]),3),'door':round(float(f[4]),3)}

COL=np.array([[0,0,0],[220,60,40],[240,200,60],[60,140,240],[60,200,90]],np.uint8)
def over(im,lab,w=320):
    h=int(im.height*w/im.width);a=im.resize((w,h));m=Image.fromarray(COL[lab]).resize((w,h),Image.NEAREST)
    return Image.blend(a,m,.5)

pk=sorted(f for f in os.listdir(IN) if f.endswith('.zip'))
if A.get('pakete'):pk=[f for f in pk if f in A['pakete']]
# Mehrere GitHub-Rechner teilen sich die Pakete: TEIL von TEILE.
TE=int(os.environ.get('TEILE','1'));TI=int(os.environ.get('TEIL','0'));pk=pk[TI::TE];print('Pakete:',pk,flush=True)
n=0;prev=[];summary=[]
for f in pk:
    z=zipfile.ZipFile(f'{IN}/{f}');man=json.loads(z.read('manifest.json'))
    items=[];outp=f'{OUT}/lehrer-{f}'
    with zipfile.ZipFile(outp,'w',zipfile.ZIP_STORED) as oz:
        for it in man['items']:
            if n>=MAXN or time.time()-t0>MAXS:break
            iid=it['id'];jb=z.read(f'images/{iid}.jpg');im=Image.open(io.BytesIO(jb)).convert('RGB')
            t1=time.time();lab,st=label(im);n+=1
            print(f'{n} {iid} {time.time()-t1:.1f} s',st if lab is not None else 'kein Haus',flush=True)
            if lab is None:continue
            oz.writestr(f'images/{iid}.jpg',jb);b=io.BytesIO();Image.fromarray(lab).save(b,'PNG');oz.writestr(f'labels/{iid}.png',b.getvalue())
            it=dict(it,prelabel='Lehrer: Grounding DINO + SAM (Apache 2.0)',anteile=st);items.append(it)
            if len(prev)<16:
                old=np.array(Image.open(io.BytesIO(z.read(f'labels/{iid}.png'))).resize(im.size,Image.NEAREST)) if f'labels/{iid}.png' in z.namelist() else np.zeros_like(lab)
                prev.append((im,old,lab))
        oz.writestr('manifest.json',json.dumps(dict(man,items=items),ensure_ascii=False,indent=1))
    summary.append({'paket':f,'fotos':len(items)})
    if not items:os.remove(outp)
if prev:
    rows=[]
    for im,old,lab in prev:
        a,b,c=im.resize((320,int(im.height*320/im.width))),over(im,old),over(im,lab);r=Image.new('RGB',(980,a.height),'white')
        for k,x in enumerate((a,b,c)):r.paste(x,(k*330,0))
        rows.append(r)
    G=Image.new('RGB',(980,sum(r.height+8 for r in rows)+26),'white');ImageDraw.Draw(G).text((4,6),'Foto | bisher (App-Modell) | Lehrer (Grounding DINO + SAM)   rot Dach, gelb Wand, blau Fenster, gruen Tuer',fill='black');y=26
    for r in rows:G.paste(r,(0,y));y+=r.height+8
    G.save(f'{OUT}/vorschau.jpg',quality=85)
json.dump({'fotos':n,'pakete':summary,'minuten':round((time.time()-t0)/60,1),'dino':DINO,'sam':SAM},open(f'{OUT}/zusammenfassung.json','w'),indent=1)
print('FERTIG',n,'Fotos in',round((time.time()-t0)/60,1),'min',flush=True)
