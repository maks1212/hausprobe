# Test: Findet der Lehrer (Grounding DINO + SAM) den Dachvorsprung (Untersicht, Stirnbrett, Rinne)?
# Aufruf: python3 test_vorsprung.py <bilderordner> <ausgabe.jpg>
import sys,os,glob,torch,numpy as np
from PIL import Image,ImageDraw
from transformers import AutoProcessor,AutoModelForZeroShotObjectDetection,SamModel,SamProcessor
torch.set_num_threads(os.cpu_count() or 2)
dp=AutoProcessor.from_pretrained('IDEA-Research/grounding-dino-base');dm=AutoModelForZeroShotObjectDetection.from_pretrained('IDEA-Research/grounding-dino-base').eval()
sp=SamProcessor.from_pretrained('facebook/sam-vit-large');sm=SamModel.from_pretrained('facebook/sam-vit-large').eval()
PROMPTS=['roof. eaves. soffit. fascia. gutter.','roof overhang. roof edge. rain gutter.']
COL={'roof':(220,60,40),'eaves':(255,0,255),'soffit':(0,255,255),'fascia':(255,140,0),'gutter':(120,255,0),'overhang':(255,0,255),'edge':(255,140,0)}
def col(t):
  for k in ['overhang','eaves','soffit','fascia','gutter','edge','roof']:
    if k in t:return COL[k]
  return (255,255,255)
@torch.no_grad()
def run(im,P):
  W,H=im.size;inp=dp(images=im,text=P,return_tensors='pt');out=dm(**inp)
  r=dp.post_process_grounded_object_detection(out,inp.input_ids,threshold=.2,text_threshold=.2,target_sizes=[(H,W)])[0]
  B=[[max(0,b[0]),max(0,b[1]),min(W,b[2]),min(H,b[3])] for b in r['boxes'].tolist()];T=[str(t) for t in r.get('text_labels',r['labels'])];S=r['scores'].tolist()
  a=np.asarray(im).astype(np.float32).copy();d=[]
  if B:
    si=sp(im,return_tensors='pt');emb=sm.get_image_embeddings(si['pixel_values'])
    bi=sp(im,input_boxes=[B],return_tensors='pt');bi.pop('pixel_values',None)
    o=sm(image_embeddings=emb,input_boxes=bi['input_boxes'],multimask_output=False)
    M=sp.image_processor.post_process_masks(o.pred_masks,bi['original_sizes'],bi['reshaped_input_sizes'])[0][:,0].numpy()
    order=sorted(range(len(B)),key=lambda i:0 if 'roof'==T[i].strip() else 1)
    for i in order:
      a[M[i]]=a[M[i]]*.45+np.array(col(T[i]))*.55
  o=Image.fromarray(a.astype(np.uint8));dr=ImageDraw.Draw(o)
  for b,t,s in zip(B,T,S):
    dr.rectangle(b,outline=col(t),width=2);dr.text((b[0]+2,b[1]+2),f'{t} {s:.2f}',fill=col(t))
  return o
fs=sorted(glob.glob(sys.argv[1]+'/*.jpg'))
rows=[]
for f in fs:
  im=Image.open(f).convert('RGB');sc=900/max(im.size)
  if sc<1:im=im.resize((round(im.width*sc),round(im.height*sc)))
  row=[im]+[run(im,P) for P in PROMPTS];w=420
  rows.append([x.resize((w,round(w*im.height/im.width))) for x in row]);print(f,flush=True)
W=420*3+20;H=sum(r[0].height+6 for r in rows)+24
out=Image.new('RGB',(W,H),'white');d=ImageDraw.Draw(out)
for i,t in enumerate(['Foto']+PROMPTS):d.text((i*430+4,6),t,fill='black')
y=24
for r in rows:
  for i,t in enumerate(r):out.paste(t,(i*430,y))
  y+=r[0].height+6
out.save(sys.argv[2],quality=85)
