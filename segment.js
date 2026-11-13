/* Flächenerkennung mit einem Segmentierungsmodell (EfficientSAM ViT-Tiny), das komplett im Browser läuft.
   Ablauf: das Foto wird einmal analysiert (Encoder, einige Sekunden), danach liefert jeder Tipp sofort Masken (Decoder).
   Das Foto verlässt das Gerät nicht. */
(function(root){
"use strict";
var ENC="models/efficient_sam_vitt_encoder.onnx",DEC="models/efficient_sam_vitt_decoder.onnx";
var SIZES={};SIZES[ENC]=24799761;SIZES[DEC]=16565728;
var GUARD="hausprobe.seg";
var sessions=null,job=null,listeners=[];
var state={phase:"idle",progress:0};

/* Die Marke steht nur während einer Analyse. Ist sie beim Start der Seite noch da, ist der Tab beim letzten Mal
   mittendrin abgestürzt. Geprüft wird das einmal beim Start, nicht während einer laufenden Analyse. */
var crashedBefore=false;try{crashedBefore=localStorage.getItem(GUARD)==="busy";}catch(e){}
function crashed(){return crashedBefore;}
function guard(on){try{on?localStorage.setItem(GUARD,"busy"):localStorage.removeItem(GUARD);}catch(e){}}
function set(phase,progress){
  progress=Math.round(progress||0);
  if(state.phase===phase&&state.progress===progress)return;
  state.phase=phase;state.progress=progress;listeners.forEach(function(f){f(state);});
}
async function fetchBuf(url,onBytes){
  var res=await fetch(url);if(!res.ok)throw new Error("HTTP "+res.status+" "+url);
  if(!res.body||!res.body.getReader){var all=new Uint8Array(await res.arrayBuffer());onBytes(all.length);return all;}
  var reader=res.body.getReader(),chunks=[],n=0;
  for(;;){var r=await reader.read();if(r.done)break;chunks.push(r.value);n+=r.value.length;onBytes(r.value.length);}
  var out=new Uint8Array(n),o=0;chunks.forEach(function(c){out.set(c,o);o+=c.length;});return out;
}
function load(){
  if(sessions)return sessions;
  sessions=(async function(){
    var ort=root.ort;if(!ort)throw new Error("Laufzeit fehlt");
    ort.env.wasm.wasmPaths=new URL("vendor/ort/",document.baseURI).href;
    ort.env.wasm.proxy=true;
    ort.env.wasm.numThreads=root.crossOriginIsolated?Math.max(1,Math.min(4,navigator.hardwareConcurrency||1)):1;
    var total=SIZES[ENC]+SIZES[DEC],got=0;
    function onBytes(n){got+=n;if(state.phase==="laden")set("laden",Math.min(99,got/total*100));}
    var bufs=await Promise.all([fetchBuf(ENC,onBytes),fetchBuf(DEC,onBytes)]);
    var opt={executionProviders:["wasm"],graphOptimizationLevel:"all"};
    var enc=await ort.InferenceSession.create(bufs[0],opt);
    var dec=await ort.InferenceSession.create(bufs[1],opt);
    return {enc:enc,dec:dec};
  })();
  sessions.catch(function(){sessions=null;});
  return sessions;
}

/* Foto einmal analysieren. Gibt ein Job-Objekt zurück; job.promise wird fertig, wenn Tipps ausgewertet werden können. */
function prepare(canvas){
  if(job&&job.canvas===canvas&&!job.failed)return job;
  var j={canvas:canvas,emb:null,failed:false,promise:null};job=j;
  j.promise=(async function(){
    if(crashed())throw new Error("crashed");
    set("laden",0);
    var s=await load();
    if(job!==j)throw new Error("stale");
    set("analyse",0);
    var sc=1024/Math.max(canvas.width,canvas.height),w=Math.max(8,Math.round(canvas.width*sc)),h=Math.max(8,Math.round(canvas.height*sc));
    var c=document.createElement("canvas");c.width=w;c.height=h;var g=c.getContext("2d");g.drawImage(canvas,0,0,w,h);
    var d=g.getImageData(0,0,w,h).data,n=w*h,x=new Float32Array(3*n),i;
    for(i=0;i<n;i++){x[i]=d[i*4]/255;x[n+i]=d[i*4+1]/255;x[2*n+i]=d[i*4+2]/255;}
    guard(true);
    var out;
    try{out=await s.enc.run({batched_images:new root.ort.Tensor("float32",x,[1,3,h,w])});}
    finally{guard(false);}
    var t=out.image_embeddings;j.emb={data:new Float32Array(t.data),dims:t.dims.slice()};
    if(job===j)set("bereit",100);
    return j;
  })();
  j.promise.catch(function(e){j.failed=true;if(job===j)set("fehler",0);});
  return j;
}

function cross(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
function convexHull(pts){
  pts=pts.slice().sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
  if(pts.length<3)return pts;
  var lo=[],up=[],i;
  for(i=0;i<pts.length;i++){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],pts[i])<=0)lo.pop();lo.push(pts[i]);}
  for(i=pts.length-1;i>=0;i--){while(up.length>=2&&cross(up[up.length-2],up[up.length-1],pts[i])<=0)up.pop();up.push(pts[i]);}
  lo.pop();up.pop();return lo.concat(up);
}
/* Konvexe Hülle auf ein umschließendes Viereck reduzieren: immer die Kante entfernen,
   deren Nachbarkanten sich mit dem kleinsten Flächenzuwachs verlängern lassen. */
function toQuad(hull){
  var v=hull.slice(),n,i,best,bi,bx;
  while(v.length>4){
    n=v.length;best=Infinity;bi=-1;bx=null;
    for(i=0;i<n;i++){
      var p0=v[(i+n-1)%n],p1=v[i],p2=v[(i+1)%n],p3=v[(i+2)%n];
      var d1=[p1[0]-p0[0],p1[1]-p0[1]],d2=[p2[0]-p3[0],p2[1]-p3[1]],den=d1[0]*d2[1]-d1[1]*d2[0];
      if(Math.abs(den)<1e-9)continue;
      var t=((p2[0]-p1[0])*d2[1]-(p2[1]-p1[1])*d2[0])/den,u=((p2[0]-p1[0])*d1[1]-(p2[1]-p1[1])*d1[0])/den;
      if(t<0||u<0)continue;
      var X=[p1[0]+t*d1[0],p1[1]+t*d1[1]],area=Math.abs(cross(p1,p2,X))/2;
      if(area<best){best=area;bi=i;bx=X;}
    }
    if(bi<0)return null;
    v[bi]=bx;v.splice((bi+1)%v.length,1);
  }
  return v;
}

/* points: [{x,y,add}] in 0..1. Liefert bis zu drei Kandidaten, nach Größe aufsteigend:
   {canvas (gelbe Maske mit Alpha), share (Flächenanteil), quad (Ecken für die Perspektive), mb (Maskengrenzen)}. */
/* Der Decoder verträgt nur einen Lauf zur selben Zeit: alle Aufrufe laufen nacheinander. */
var chain=Promise.resolve();
function decode(s,feeds){var p=chain.then(function(){return s.dec.run(feeds);});chain=p.catch(function(){});return p;}

/* Fenster suchen: viele Probe-Tipps auf Stellen im Wandbereich, die nicht Wand sind. Behalten werden nur
   rechteckige Flächen in Fenstergröße, die an Wand grenzen und nicht nach Bewuchs aussehen.
   wall: Maske der Wand (Alpha). Liefert Rechtecke {x0,y0,x1,y1} in 0..1. */
/* solid: die Wand ist von Hand als Vieleck markiert und enthält die Fenster noch; dann wird die ganze Fläche abgesucht. */
async function scan(wall,onStep,dbg,solid){
  var j=job;if(!j)throw new Error("kein Foto");
  await j.promise;var s=await load(),ort=root.ort;
  var sc=320/Math.max(j.canvas.width,j.canvas.height),W=Math.max(8,Math.round(j.canvas.width*sc)),H=Math.max(8,Math.round(j.canvas.height*sc)),N=W*H,i,x,y;
  var c=document.createElement("canvas");c.width=W;c.height=H;var cg=c.getContext("2d");
  cg.drawImage(wall,0,0,W,H);var wd=cg.getImageData(0,0,W,H).data,wallM=new Uint8Array(N);
  var x0=W,y0=H,x1=-1,y1=-1,rowLo=new Int32Array(H).fill(W),rowHi=new Int32Array(H).fill(-1),colLo=new Int32Array(W).fill(H),colHi=new Int32Array(W).fill(-1);
  for(y=0;y<H;y++)for(x=0;x<W;x++){
    if(wd[(y*W+x)*4+3]<=127)continue;
    wallM[y*W+x]=1;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
    if(x<rowLo[y])rowLo[y]=x;if(x>rowHi[y])rowHi[y]=x;if(y<colLo[x])colLo[x]=y;if(y>colHi[x])colHi[x]=y;
  }
  if(x1<0)return [];
  if(dbg)dbg.push({wall:[x0,y0,x1,y1],W:W,H:H});
  cg.globalCompositeOperation="copy";cg.drawImage(j.canvas,0,0,W,H);var pd=cg.getImageData(0,0,W,H).data;
  var bw0=x1-x0,bh0=y1-y0,mx=.1*bw0,my=.25*bh0,gx=14,gy=11,pts=[],gi,gj;
  function near(px,py){
    var ry=Math.min(y1,Math.max(y0,Math.round(py))),rx=Math.min(x1,Math.max(x0,Math.round(px)));
    return rowHi[ry]>=0&&colHi[rx]>=0&&px>=rowLo[ry]-mx&&px<=rowHi[ry]+mx&&py>=colLo[rx]-my&&py<=colHi[rx]+my;
  }
  for(gj=0;gj<gy+3;gj++)for(gi=0;gi<gx;gi++){
    x=x0+(gi+.5)*bw0/gx;y=y0+(gj+.5)*bh0/gy;
    if(y<H-1&&(solid?wallM[(y|0)*W+(x|0)]:!wallM[(y|0)*W+(x|0)]&&near(x,y)))pts.push([x,y]);
  }
  var cands=[],sure=[],p;
  for(p=0;p<pts.length;p++){
    if(job!==j)return [];
    if(onStep)onStep(p,pts.length);
    var P=pts[p];
    if(sure.some(function(b){return P[0]>=b[0]&&P[0]<=b[2]&&P[1]>=b[1]&&P[1]<=b[3];}))continue;
    var out=await decode(s,{
      image_embeddings:new ort.Tensor("float32",new Float32Array(j.emb.data),j.emb.dims),
      batched_point_coords:new ort.Tensor("float32",new Float32Array([P[0],P[1]]),[1,1,1,2]),
      batched_point_labels:new ort.Tensor("float32",new Float32Array([1]),[1,1,1]),
      orig_im_size:new ort.Tensor("int64",BigInt64Array.from([BigInt(H),BigInt(W)]),[2])
    });
    var m=out.output_masks,K=m.dims[2],data=m.data,iou=out.iou_predictions.data,k;
    for(k=0;k<K;k++){
      var off=k*N,n=0,ov=0,ex=0,gf=0,ls=0,lq=0,l,bx0=W,by0=H,bx1=-1,by1=-1,e;
      for(y=0;y<H;y++)for(x=0;x<W;x++){
        i=y*W+x;if(data[off+i]<=0)continue;
        n++;ov+=wallM[i];e=2*pd[i*4+1]-pd[i*4]-pd[i*4+2];ex+=e;if(e>35)gf++;
        l=.299*pd[i*4]+.587*pd[i*4+1]+.114*pd[i*4+2];ls+=l;lq+=l*l;
        if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;
      }
      if(n<12)continue;
      bx1++;by1++;
      var bw=bx1-bx0,bh=by1-by0,fill=n/(bw*bh),ar=bw/bh,q=iou[k],sd=Math.sqrt(Math.max(0,lq/n-(ls/n)*(ls/n)));
      if(dbg)dbg.push({p:[Math.round(P[0]),Math.round(P[1])],b:[bx0,by0,bx1,by1],fill:+fill.toFixed(2),q:+q.toFixed(2),ov:+(ov/n).toFixed(2),ex:+(ex/n).toFixed(1),gf:+(gf/n).toFixed(2),sd:+sd.toFixed(1),rw:+(bw/bw0).toFixed(2),rh:+(bh/bh0).toFixed(2)});
      /* Die Sicherheit des Modells (q) schwankt stark mit der Lage des Tipps und zählt deshalb kaum. Entscheidend sind
         Form, Farbe (kein Bewuchs) und Kontrast: ein Fenster hat Rahmen und Glas, ein Schattenfleck ist gleichmäßig. */
      if(ar<.35||ar>2.6||fill<.58||q<.1||(!solid&&ov/n>=.35)||ex/n>=28||gf/n>=.4||sd<12)continue;
      if(bw/bw0<.05||bw/bw0>.35||bh/bh0<.05||bh/bh0>.5)continue;
      /* Rundherum muss zumindest teilweise Wand sein. */
      var d=Math.max(2,Math.round(.25*Math.min(bw,bh))),rx0=Math.max(0,bx0-d),ry0=Math.max(0,by0-d),rx1=Math.min(W,bx1+d),ry1=Math.min(H,by1+d),ring=0;
      for(y=ry0;y<ry1;y++)for(x=rx0;x<rx1;x++)if((x<bx0||x>=bx1||y<by0||y>=by1)&&wallM[y*W+x])ring++;
      if(!solid&&ring/Math.max(1,(rx1-rx0)*(ry1-ry0)-bw*bh)<.15)continue;
      var b=[bx0,by0,bx1,by1,n];cands.push(b);
      if(q>=.6&&fill>=.75&&bw/bw0>=.08)sure.push(b);
    }
  }
  /* Größte zuerst; was sich mit einem behaltenen Fenster deutlich überschneidet (z. B. eine einzelne Scheibe), fällt weg. */
  cands.sort(function(a,b){return b[4]-a[4];});
  var keep=[];
  cands.forEach(function(b){
    var dup=keep.some(function(k){
      var ix=Math.max(0,Math.min(b[2],k[2])-Math.max(b[0],k[0])),iy=Math.max(0,Math.min(b[3],k[3])-Math.max(b[1],k[1]));
      return ix*iy>.3*Math.min((b[2]-b[0])*(b[3]-b[1]),(k[2]-k[0])*(k[3]-k[1]));
    });
    if(!dup)keep.push(b);
  });
  return keep.map(function(b){return {x0:b[0]/W,y0:b[1]/H,x1:b[2]/W,y1:b[3]/H};});
}

async function masks(points){
  var j=job;if(!j)throw new Error("kein Foto");
  await j.promise;var s=await load(),ort=root.ort;
  var sc=Math.min(1,1024/Math.max(j.canvas.width,j.canvas.height)),mw=Math.max(8,Math.round(j.canvas.width*sc)),mh=Math.max(8,Math.round(j.canvas.height*sc));
  var n=points.length,pc=new Float32Array(n*2),pl=new Float32Array(n),i;
  for(i=0;i<n;i++){pc[i*2]=points[i].x*mw;pc[i*2+1]=points[i].y*mh;pl[i]=points[i].add?1:0;}
  var out=await decode(s,{
    image_embeddings:new ort.Tensor("float32",new Float32Array(j.emb.data),j.emb.dims),
    batched_point_coords:new ort.Tensor("float32",pc,[1,1,n,2]),
    batched_point_labels:new ort.Tensor("float32",pl,[1,1,n]),
    orig_im_size:new ort.Tensor("int64",BigInt64Array.from([BigInt(mh),BigInt(mw)]),[2])
  });
  var m=out.output_masks,K=m.dims[2],H=m.dims[3],W=m.dims[4],data=m.data,res=[],k,x,y;
  for(k=0;k<K;k++){
    var off=k*H*W,cnt=0,edge=[],x0=W,y0=H,x1=-1,y1=-1;
    var c=document.createElement("canvas");c.width=W;c.height=H;var g=c.getContext("2d"),im=g.createImageData(W,H),d=im.data;
    for(y=0;y<H;y++)for(x=0;x<W;x++){
      i=y*W+x;if(data[off+i]<=0)continue;
      cnt++;d[i*4]=255;d[i*4+1]=216;d[i*4+2]=77;d[i*4+3]=255;
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      if(x===0||x===W-1||y===0||y===H-1||data[off+i-1]<=0||data[off+i+1]<=0||data[off+i-W]<=0||data[off+i+W]<=0)edge.push([x+.5,y+.5]);
    }
    if(cnt<240)continue;
    g.putImageData(im,0,0);
    var hull=convexHull(edge),q=hull.length>=4?toQuad(hull):null;
    /* Nur wenn die Fläche ihr Viereck gut ausfüllt, ist es eine echte Vierecksfläche (z. B. eine Dachseite).
       Sonst (Giebel, verdeckte Wand) ist das gerade Rechteck die bessere Ausgangslage für das Muster. */
    if(q){var qa=0,t;for(t=0;t<4;t++){var nx=q[(t+1)%4];qa+=q[t][0]*nx[1]-nx[0]*q[t][1];}if(cnt/(Math.abs(qa)/2)<.8)q=null;}
    if(!q)q=[[x0,y0],[x1+1,y0],[x1+1,y1+1],[x0,y1+1]];
    res.push({canvas:c,share:cnt/(W*H),
      quad:q.map(function(p){return {x:p[0]/W,y:p[1]/H};}),
      mb:[x0/W,y0/H,(x1+1)/W,(y1+1)/H]});
  }
  res.sort(function(a,b){return a.share-b.share;});
  /* Fast gleich große Kandidaten zusammenlegen. */
  return res.filter(function(r,idx){return idx===0||r.share>res[idx-1].share*1.06;});
}

var api={
  prepare:prepare,masks:masks,scan:scan,state:state,
  onChange:function(f){listeners.push(f);},
  blocked:crashed,
  reset:function(){crashedBefore=false;guard(false);if(job&&job.failed)job=null;}
};
root.HausSeg=api;
})(typeof window!=="undefined"?window:this);
