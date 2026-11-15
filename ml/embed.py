# Bildmerkmale des EfficientSAM-Encoders vorberechnen, genau wie die App: längste Seite 1024, Seitenverhältnis bleibt, RGB/255.
import sys,os,glob,time,numpy as np,onnxruntime as ort
from PIL import Image
M,src,dst=sys.argv[1],sys.argv[2],sys.argv[3]
os.makedirs(dst,exist_ok=True)
so=ort.SessionOptions();so.intra_op_num_threads=int(os.environ.get('THREADS','2'))
enc=ort.InferenceSession(M+'/efficient_sam_vitt_encoder.onnx',so,providers=['CPUExecutionProvider'])
fs=sorted(glob.glob(src+'/*.jpg'))+sorted(glob.glob(src+'/*.png'))
t0=time.time()
for k,f in enumerate(fs):
    out=dst+'/'+os.path.splitext(os.path.basename(f))[0]+'.npz'
    if os.path.exists(out):continue
    im=Image.open(f).convert('RGB');sc=1024/max(im.size);w,h=max(8,round(im.width*sc)),max(8,round(im.height*sc))
    x=np.asarray(im.resize((w,h),Image.BILINEAR),dtype=np.float32).transpose(2,0,1)[None]/255
    e=enc.run(None,{'batched_images':x})[0][0].astype(np.float16)
    np.savez(out,e=e,w=w,h=h,W=im.width,H=im.height)
    if k%20==0:print(k,len(fs),e.shape,round(time.time()-t0),'s',flush=True)
print('done',len(fs),round(time.time()-t0),'s')
