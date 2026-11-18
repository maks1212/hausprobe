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
function decode(s,feeds){return runOn(s.dec,feeds);}
function runOn(sess,feeds){var p=chain.then(function(){return sess.run(feeds);});chain=p.catch(function(){});return p;}

/* Eigener Erkennungskopf für Fenster und Türen: arbeitet auf denselben Bildmerkmalen wie die Flächenerkennung
   und liefert in einem Durchgang alle Fenster als Rechtecke (Mittelpunkt-Wärmekarte, Größe, Versatz je Zelle). */
var HEAD="models/hausprobe_fenster.onnx",headSess=null;
function loadHead(){
  if(headSess)return headSess;
  headSess=(async function(){
    await load();var res=await fetch(HEAD);if(!res.ok)throw new Error("kein Fenstermodell");
    return root.ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()),{executionProviders:["wasm"]});
  })();
  headSess.catch(function(){headSess=null;});
  return headSess;
}
async function windows(thr){
  var j=job;if(!j)throw new Error("kein Foto");
  await j.promise;var h=await loadHead(),ort=root.ort;
  var out=await runOn(h,{image_embeddings:new ort.Tensor("float32",new Float32Array(j.emb.data),j.emb.dims)});
  var hm=out.heat,wh=out.size.data,off=out.offset.data,NC=hm.dims[1],G=hm.dims[2],GW=hm.dims[3],d=hm.data,res=[],c,y,x,i,k;
  thr=thr||.3;
  for(c=0;c<NC;c++)for(y=0;y<G;y++)for(x=0;x<GW;x++){
    i=c*G*GW+y*GW+x;var v=d[i];if(v<thr)continue;
    var peak=true;
    for(var dy=-1;dy<=1&&peak;dy++)for(var dx=-1;dx<=1;dx++){
      var yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=G||xx>=GW||(!dx&&!dy))continue;
      if(d[c*G*GW+yy*GW+xx]>v){peak=false;break;}
    }
    if(!peak)continue;
    k=y*GW+x;var bw=Math.exp(wh[k]),bh=Math.exp(wh[G*GW+k]),cx=x+off[k],cy=y+off[G*GW+k];
    res.push({cls:c,score:v,x0:Math.max(0,(cx-bw/2)/GW),y0:Math.max(0,(cy-bh/2)/G),x1:Math.min(1,(cx+bw/2)/GW),y1:Math.min(1,(cy+bh/2)/G)});
  }
  res.sort(function(a,b){return b.score-a.score;});
  return res;
}

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
    if(y<H-1&&!wallM[(y|0)*W+(x|0)]&&near(x,y))pts.push([x,y]);
  }
  /* Fenster, die die Erkennung zur Wand gezählt hat: Stellen in der Wand, deren Farbe deutlich von der Wandfarbe
     abweicht. Je zusammenhängendem Fleck kommt ein Probe-Tipp in dessen Mitte dazu. */
  var inner=pts.length,hr=new Uint32Array(256),hg=new Uint32Array(256),hb=new Uint32Array(256),wn=0;
  for(i=0;i<N;i++)if(wallM[i]){hr[pd[i*4]]++;hg[pd[i*4+1]]++;hb[pd[i*4+2]]++;wn++;}
  function hmed(hh){var acc=0,v;for(v=0;v<256;v++){acc+=hh[v];if(acc>=wn/2)return v;}return 128;}
  var mr=hmed(hr),mg=hmed(hg),mb=hmed(hb),odd=new Uint8Array(N),lab=new Uint8Array(N),stack=new Int32Array(N),blobs=[];
  for(i=0;i<N;i++){
    if(!wallM[i])continue;
    var dr=pd[i*4]-mr,dg=pd[i*4+1]-mg,db=pd[i*4+2]-mb,dl=(dr+dg+db)/3;
    if(.5*dl*dl+(dr-dl)*(dr-dl)+(dg-dl)*(dg-dl)+(db-dl)*(db-dl)>1500)odd[i]=1;
  }
  for(i=0;i<N;i++){
    if(!odd[i]||lab[i])continue;
    var top=0,cnt=0,sx=0,sy=0,q2;stack[top++]=i;lab[i]=1;
    while(top){
      q2=stack[--top];cnt++;x=q2%W;y=(q2-x)/W;sx+=x;sy+=y;
      if(x>0&&odd[q2-1]&&!lab[q2-1]){lab[q2-1]=1;stack[top++]=q2-1;}
      if(x<W-1&&odd[q2+1]&&!lab[q2+1]){lab[q2+1]=1;stack[top++]=q2+1;}
      if(y>0&&odd[q2-W]&&!lab[q2-W]){lab[q2-W]=1;stack[top++]=q2-W;}
      if(y<H-1&&odd[q2+W]&&!lab[q2+W]){lab[q2+W]=1;stack[top++]=q2+W;}
    }
    if(cnt>=Math.max(10,wn*.0015))blobs.push([cnt,sx/cnt,sy/cnt]);
  }
  blobs.sort(function(a,b){return b[0]-a[0];});
    /* Fenster, die die Erkennung zur Wand gezählt hat (Rahmen in Wandfarbe), findet nur ein Tipp im Inneren.
     Dafür gelten unten strenge Regeln: Fenstergröße, Kontrast, nicht überwiegend Wandfarbe. */
  if(solid)pts=[];
  inner=pts.length;
  blobs.slice(0,24).forEach(function(b){pts.push([b[1],b[2]]);});
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
      var off=k*N,n=0,ov=0,ex=0,gf=0,ls=0,lq=0,l,wc=0,bx0=W,by0=H,bx1=-1,by1=-1,e;
      for(y=0;y<H;y++)for(x=0;x<W;x++){
        i=y*W+x;if(data[off+i]<=0)continue;
        n++;ov+=wallM[i];e=2*pd[i*4+1]-pd[i*4]-pd[i*4+2];ex+=e;if(e>35)gf++;
        var er=pd[i*4]-mr,eg=pd[i*4+1]-mg,eb=pd[i*4+2]-mb,el=(er+eg+eb)/3;
        if(.5*el*el+(er-el)*(er-el)+(eg-el)*(eg-el)+(eb-el)*(eb-el)<=1500)wc++;
        l=.299*pd[i*4]+.587*pd[i*4+1]+.114*pd[i*4+2];ls+=l;lq+=l*l;
        if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;
      }
      if(n<12)continue;
      bx1++;by1++;
      var bw=bx1-bx0,bh=by1-by0,fill=n/(bw*bh),ar=bw/bh,q=iou[k],sd=Math.sqrt(Math.max(0,lq/n-(ls/n)*(ls/n)));
      if(dbg)dbg.push({p:[Math.round(P[0]),Math.round(P[1])],b:[bx0,by0,bx1,by1],fill:+fill.toFixed(2),q:+q.toFixed(2),ov:+(ov/n).toFixed(2),ex:+(ex/n).toFixed(1),gf:+(gf/n).toFixed(2),sd:+sd.toFixed(1),wc:+(wc/n).toFixed(2),inner:p>=inner,ar:+ar.toFixed(2),rw:+(bw/bw0).toFixed(2),rh:+(bh/bh0).toFixed(2)});
      /* Die Sicherheit des Modells (q) schwankt stark mit der Lage des Tipps und zählt deshalb kaum. Entscheidend sind
         Form, Farbe (kein Bewuchs) und Kontrast: ein Fenster hat Rahmen und Glas, ein Schattenfleck ist gleichmäßig. */
      /* wc: Anteil in Wandfarbe. Ein Rechteck, das überwiegend wie die Wand aussieht (Garagentor, Wandfeld), ist kein Fenster.
         Ein falsches Fenster richtet mehr Schaden an als ein übersehenes, deshalb sind die Schwellen streng. */
      if(ar<.35||ar>2.6||fill<.58||q<.1||ex/n>=28||gf/n>=.4||sd<12)continue;
      /* Überwiegend Wandfarbe: nur ein kleines, klar gegliedertes Rechteck (Fenster mit hellem Rahmen) zählt,
         nicht ein großes gleichfarbiges Feld wie ein Garagentor. */
      if(wc/n>.45&&!(sd>=25&&q>=.6&&fill>=.75&&bw/bw0<=.15&&bh/bh0<=.3))continue;
      if(bw/bw0<.04||bw/bw0>.3||bh/bh0<.05||bh/bh0>.5)continue;
      /* Rundherum muss zumindest teilweise Wand sein. */
      var d=Math.max(2,Math.round(.25*Math.min(bw,bh))),rx0=Math.max(0,bx0-d),ry0=Math.max(0,by0-d),rx1=Math.min(W,bx1+d),ry1=Math.min(H,by1+d),ring=0;
      for(y=ry0;y<ry1;y++)for(x=rx0;x<rx1;x++)if((x<bx0||x>=bx1||y<by0||y>=by1)&&wallM[y*W+x])ring++;
      if(p<inner&&ring/Math.max(1,(rx1-rx0)*(ry1-ry0)-bw*bh)<.4)continue;
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

/* points: [{x,y,add}] in 0..1. Liefert bis zu drei Kandidaten, nach Größe aufsteigend:
   {canvas (gelbe Maske mit Alpha), share (Flächenanteil), sim (Farbtreue), quad (Ecken für die Perspektive), mb (Maskengrenzen)}.
   Das Modell liefert meist "Teilstück / Gebäudeteil samt Fenstern / ganzes Haus". Deshalb wird jeder Kandidat auf die
   Farbe der angetippten Stellen eingeschränkt: übrig bleibt das Material (Wand oder Dach) ohne Fenster, Türen und
   anders gefärbte Bauteile. opt.raw schaltet das ab (für das Markieren von Fenstern). */
/* Aus einer Binärmaske (W×H) eine Fläche bauen: gelbe Maske, Anteil, Ecken für die Perspektive, Grenzen. */
function candidate(F,W,H,minCnt){
  var cnt=0,edge=[],x0=W,y0=H,x1=-1,y1=-1,i,x,y;
  var c=document.createElement("canvas");c.width=W;c.height=H;var g=c.getContext("2d"),im=g.createImageData(W,H),d=im.data;
  for(y=0;y<H;y++)for(x=0;x<W;x++){
    i=y*W+x;if(!F[i])continue;
    cnt++;d[i*4]=255;d[i*4+1]=216;d[i*4+2]=77;d[i*4+3]=255;
    if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
    if(x===0||x===W-1||y===0||y===H-1||!F[i-1]||!F[i+1]||!F[i-W]||!F[i+W])edge.push([x+.5,y+.5]);
  }
  if(cnt<minCnt)return null;
  g.putImageData(im,0,0);
  var hull=convexHull(edge),q=hull.length>=4?toQuad(hull):null;
  /* Nur wenn die Fläche ihr Viereck gut ausfüllt, ist es eine echte Vierecksfläche (z. B. eine Dachseite).
     Sonst (Giebel, verdeckte Wand) ist das gerade Rechteck die bessere Ausgangslage für das Muster. */
  if(q){var qa=0,t2;for(t2=0;t2<4;t2++){var nx=q[(t2+1)%4];qa+=q[t2][0]*nx[1]-nx[0]*q[t2][1];}if(cnt/(Math.abs(qa)/2)<.8)q=null;}
  if(!q)q=[[x0,y0],[x1+1,y0],[x1+1,y1+1],[x0,y1+1]];
  return {canvas:c,share:cnt/(W*H),sim:1,whole:cnt/(W*H),
    quad:q.map(function(p){return {x:p[0]/W,y:p[1]/H};}),
    mb:[x0/W,y0/H,(x1+1)/W,(y1+1)/H]};
}

/* Eigenes Flächenmodell: ordnet jedem Bildpunkt Dach, Wand, Fenster, Tür oder Sonstiges zu (128 × 128, auf das
   Bild gestreckt). Trainiert auf COCO-Stuff, läuft auf denselben Bildmerkmalen wie die übrige Erkennung. */
var SURF="models/hausprobe_flaechen.onnx?v=3",surfSess=null;
function loadSurf(){
  if(surfSess)return surfSess;
  surfSess=(async function(){
    await load();var res=await fetch(SURF);if(!res.ok)throw new Error("kein Flächenmodell");
    return root.ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()),{executionProviders:["wasm"]});
  })();
  surfSess.catch(function(){surfSess=null;});
  return surfSess;
}
async function classMap(){
  var j=job;if(!j)throw new Error("kein Foto");
  await j.promise;
  if(j.cls)return j.cls;
  var s=await loadSurf(),ort=root.ort;
  var out=await runOn(s,{image_embeddings:new ort.Tensor("float32",new Float32Array(j.emb.data),j.emb.dims)});
  var t=out.classes,NC=t.dims[1],H=t.dims[2],W=t.dims[3],p=t.data,N=W*H,lab=new Uint8Array(N),i,k;
  for(i=0;i<N;i++){var best=0,bv=p[i];for(k=1;k<NC;k++)if(p[k*N+i]>bv){bv=p[k*N+i];best=k;}lab[i]=best;}
  j.cls={w:W,h:H,lab:lab,prob:p,nc:NC};
  return j.cls;
}
/* Fläche einer Klasse (1 Dach, 2 Wand): mit Tipp die zusammenhängende Fläche dort, sonst die größte.
   Kleine Lücken (Regenrinne, Schatten) werden geschlossen; Fenster und Türen bleiben ausgespart. */
async function surface(kind,at){
  var m=await classMap(),W=m.w,H=m.h,N=W*H,lab=m.lab,prob=m.prob,i,x,y,j=job;
  /* Nur sichere Bildpunkte: die Klasse muss klar vorne liegen. Dazu Himmel und Bewuchs über die Farbe ausschließen,
     wenn die Fläche selbst nicht blau oder grün ist; daran scheitert das Modell an Rändern am häufigsten. */
  if(!j.small||j.small.w!==W){var sc=document.createElement("canvas");sc.width=W;sc.height=H;var sg=sc.getContext("2d");sg.drawImage(j.canvas,0,0,W,H);j.small={w:W,d:sg.getImageData(0,0,W,H).data};}
  var px=j.small.d,B=new Uint8Array(N),R=[],Gc=[],Bc=[],n0=0;
  for(i=0;i<N;i++){if(lab[i]===kind&&prob[kind*N+i]>=.5){B[i]=1;R.push(px[i*4]);Gc.push(px[i*4+1]);Bc.push(px[i*4+2]);n0++;}}
  function med(a){a.sort(function(u,v){return u-v;});return a[a.length>>1];}
  if(n0){
    /* Typische Farbe der Fläche über den Median: Himmel oder Bäume am Rand verfälschen ihn nicht. */
    var sr=med(R),sg2=med(Gc),sb=med(Bc);
    /* Himmel: himmelfarbene Bildpunkte, die zusammenhängend vom oberen Bildrand her erreichbar sind. So fällt der
       Himmel über dem Dach weg, eine hellblaue Wand unter dem Dach bleibt. Bewuchs: grün und deutlich anders als die Fläche. */
    var sl=(sr+sg2+sb)/3,skyL=new Uint8Array(N),skyR=new Uint8Array(N),st=new Int32Array(N),top=0;
    for(i=0;i<N;i++){var r0=px[i*4],g0=px[i*4+1],b0=px[i*4+2],l0=(r0+g0+b0)/3;
      skyL[i]=(b0>=r0+10&&b0>=g0-5&&l0>120)||(l0>205&&Math.abs(r0-b0)<35)?1:0;}
    for(x=0;x<W;x++)if(skyL[x]){skyR[x]=1;st[top++]=x;}
    while(top){var q=st[--top],qx=q%W;
      if(qx>0&&skyL[q-1]&&!skyR[q-1]){skyR[q-1]=1;st[top++]=q-1;}
      if(qx<W-1&&skyL[q+1]&&!skyR[q+1]){skyR[q+1]=1;st[top++]=q+1;}
      if(q>=W&&skyL[q-W]&&!skyR[q-W]){skyR[q-W]=1;st[top++]=q-W;}
      if(q<N-W&&skyL[q+W]&&!skyR[q+W]){skyR[q+W]=1;st[top++]=q+W;}}
    /* Würde der Himmelsfilter einen großen Teil der Fläche entfernen, ist die Fläche selbst hell oder blau
       (weiße Wand, Blechdach) und der Filter bleibt aus. */
    var sk=0;for(i=0;i<N;i++)if(B[i]&&skyR[i])sk++;
    var useSky=sk<=.3*n0;
    /* Ein Dach, das großteils mit dem Himmel zusammenhängt, ist unsicher: dann lieber kein automatisches Dach,
       der Nutzer markiert es mit einem Tipp. */
    if(kind===1&&!useSky&&!at)return null;
    for(i=0;i<N;i++){
      if(!B[i])continue;var r=px[i*4],gq=px[i*4+1],b=px[i*4+2],l=(r+gq+b)/3;
      var cd=Math.abs((r-l)-(sr-sl))+Math.abs((gq-l)-(sg2-sl))+Math.abs((b-l)-(sb-sl));
      if((useSky&&skyR[i])||(gq>r+15&&gq>b+10&&cd>30))B[i]=0;
    }
  }
  /* Schließen 3×3: erst wachsen, dann schrumpfen, nur innerhalb von Wand, Dach, Fenster, Tür */
  function grow(A,keepOut){var O=new Uint8Array(N);for(y=0;y<H;y++)for(x=0;x<W;x++){i=y*W+x;
    var v=A[i]||(x>0&&A[i-1])||(x<W-1&&A[i+1])||(y>0&&A[i-W])||(y<H-1&&A[i+W]);O[i]=v&&(!keepOut||lab[i]!==0)?1:0;}return O;}
  function shrink(A){var O=new Uint8Array(N);for(y=0;y<H;y++)for(x=0;x<W;x++){i=y*W+x;
    O[i]=A[i]&&(x===0||A[i-1])&&(x===W-1||A[i+1])&&(y===0||A[i-W])&&(y===H-1||A[i+W])?1:0;}return O;}
  var C=shrink(grow(B,true));for(i=0;i<N;i++){if(B[i])C[i]=1;if(lab[i]===3||lab[i]===4)C[i]=0;}
  var comp=new Int32Array(N),stack=new Int32Array(N),sizes=[0],id=0;
  for(i=0;i<N;i++){
    if(!C[i]||comp[i])continue;id++;var top=0,sz=0,q;stack[top++]=i;comp[i]=id;
    while(top){q=stack[--top];sz++;var qx=q%W;
      if(qx>0&&C[q-1]&&!comp[q-1]){comp[q-1]=id;stack[top++]=q-1;}
      if(qx<W-1&&C[q+1]&&!comp[q+1]){comp[q+1]=id;stack[top++]=q+1;}
      if(q>=W&&C[q-W]&&!comp[q-W]){comp[q-W]=id;stack[top++]=q-W;}
      if(q<N-W&&C[q+W]&&!comp[q+W]){comp[q+W]=id;stack[top++]=q+W;}}
    sizes.push(sz);
  }
  if(id===0)return null;
  var pick=0;
  if(at){
    var px=Math.min(W-1,Math.max(0,Math.round(at.x*W))),py=Math.min(H-1,Math.max(0,Math.round(at.y*H))),bd=1e9,dx,dy;
    for(dy=-4;dy<=4;dy++)for(dx=-4;dx<=4;dx++){var xx=px+dx,yy=py+dy;if(xx<0||yy<0||xx>=W||yy>=H)continue;
      var c2=comp[yy*W+xx];if(c2&&dx*dx+dy*dy<bd){bd=dx*dx+dy*dy;pick=c2;}}
    if(!pick)return null;
  }else{var bs=0;for(i=1;i<sizes.length;i++)if(sizes[i]>bs){bs=sizes[i];pick=i;}}
  /* Alle Teile derselben Klasse, die groß genug sind, gehören meist zum selben Haus (Wand links und rechts der Garage). */
  var keep={};keep[pick]=1;
  if(!at)for(i=1;i<sizes.length;i++)if(sizes[i]>=Math.max(40,sizes[pick]*.25))keep[i]=1;
  var F=new Uint8Array(N);for(i=0;i<N;i++)if(keep[comp[i]])F[i]=1;
  var r=candidate(F,W,H,Math.max(20,N*.004));if(r)r.model=true;
  return r;
}

async function masks(points,opt){
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
  var m=out.output_masks,K=m.dims[2],H=m.dims[3],W=m.dims[4],N=W*H,data=m.data,res=[],k,x,y;
  if(!j.pix||j.pix.w!==W||j.pix.h!==H){
    var pcv=document.createElement("canvas");pcv.width=W;pcv.height=H;var pg=pcv.getContext("2d");pg.drawImage(j.canvas,0,0,W,H);
    j.pix={w:W,h:H,d:pg.getImageData(0,0,W,H).data};
  }
  var pix=j.pix.d,refs=[];
  points.forEach(function(p){
    if(!p.add)return;
    var cx=Math.min(W-1,Math.max(0,Math.round(p.x*W))),cy=Math.min(H-1,Math.max(0,Math.round(p.y*H))),r=[],gg=[],b=[],xx,yy,o;
    for(yy=Math.max(0,cy-4);yy<=Math.min(H-1,cy+4);yy++)for(xx=Math.max(0,cx-4);xx<=Math.min(W-1,cx+4);xx++){o=(yy*W+xx)*4;r.push(pix[o]);gg.push(pix[o+1]);b.push(pix[o+2]);}
    function med(a){a.sort(function(u,v){return u-v;});return a[a.length>>1];}
    refs.push([med(r),med(gg),med(b)]);
  });
  /* Verglichen wird vor allem der Farbton (Anteile von Rot, Grün, Blau), wenig die Helligkeit:
     so gilt dieselbe Wand in Sonne und Schatten als gleich, Wand und Dach aber als verschieden. */
  var A=new Uint8Array(N);
  for(i=0;i<N;i++){
    var o=i*4,r0=pix[o],g0=pix[o+1],b0=pix[o+2],s0=r0+g0+b0+1,l0=s0/3,t;
    for(t=0;t<refs.length;t++){
      var R=refs[t],S2=R[0]+R[1]+R[2]+1,dl=l0-S2/3,a=r0/s0-R[0]/S2,c2=g0/s0-R[1]/S2,e=b0/s0-R[2]/S2;
      /* f: wie farbig die angetippte Stelle ist. Bei Weiß und Grau trennt nur die Helligkeit (weiße Wand, graues Dach),
         sie zählt dort mehr. Kräftige Farben schwanken stärker im Ton und bekommen mehr Spielraum. */
      var f=Math.min(1,Math.max(Math.abs(R[0]/S2-1/3),Math.abs(R[1]/S2-1/3),Math.abs(R[2]/S2-1/3))/.05);
      if((.12-.07*f)*dl*dl+30000*(a*a+c2*c2+e*e)<500+900*f){A[i]=1;break;}
    }
  }
  var raws=[];
  for(k=0;k<K;k++){
    var off=k*N,B=new Uint8Array(N),cnt=0,same=0;
    for(i=0;i<N;i++)if(data[off+i]>0){B[i]=1;cnt++;same+=A[i];}
    if(cnt>=240)raws.push({B:B,cnt:cnt,sim:same/cnt});
  }
  raws.sort(function(u,v){return u.cnt-v.cnt;});
  /* Passt kein Kandidat farblich zur angetippten Stelle, ist das Material gemustert
     (z. B. Ziegel): dann taugt die Farbe nicht zum Trennen und die Flächen bleiben, wie das Modell sie liefert. */
  var useColor=!(opt&&opt.raw)&&refs.length>0&&raws.some(function(r){return r.sim>=.5;});
  function clean(B){
    /* Farbfilter, dann Mehrheit im 5×5-Fenster (entfernt Sprenkel, schließt Poren), dann kleine Inseln weg. */
    var F=new Uint8Array(N),tmp=new Uint8Array(N),r=2,q;
    for(q=0;q<N;q++)F[q]=B[q]&A[q];
    for(y=0;y<H;y++){var run=0,oy=y*W;for(x=-r;x<W;x++){if(x+r<W)run+=F[oy+x+r];if(x-r-1>=0)run-=F[oy+x-r-1];if(x>=0)tmp[oy+x]=run;}}
    var O=new Uint8Array(N),col=new Uint16Array(H);
    for(x=0;x<W;x++){
      var run2=0;
      for(y=-r;y<H;y++){if(y+r<H)run2+=tmp[(y+r)*W+x];if(y-r-1>=0)run2-=tmp[(y-r-1)*W+x];if(y>=0)col[y]=run2;}
      for(y=0;y<H;y++)O[y*W+x]=col[y]>=13&&B[y*W+x]?1:0;
    }
    var lab=new Int32Array(N),stack=new Int32Array(N),sizes=[0],total=0,id=0;
    for(q=0;q<N;q++){
      if(!O[q]||lab[q])continue;
      id++;var top=0,sz=0,p2;stack[top++]=q;lab[q]=id;
      while(top){
        p2=stack[--top];sz++;var px=p2%W;
        if(px>0&&O[p2-1]&&!lab[p2-1]){lab[p2-1]=id;stack[top++]=p2-1;}
        if(px<W-1&&O[p2+1]&&!lab[p2+1]){lab[p2+1]=id;stack[top++]=p2+1;}
        if(p2>=W&&O[p2-W]&&!lab[p2-W]){lab[p2-W]=id;stack[top++]=p2-W;}
        if(p2<N-W&&O[p2+W]&&!lab[p2+W]){lab[p2+W]=id;stack[top++]=p2+W;}
      }
      sizes.push(sz);total+=sz;
    }
    var min=Math.max(60,total*.02);
    for(q=0;q<N;q++)if(O[q]&&sizes[lab[q]]<min)O[q]=0;
    return O;
  }
  raws.forEach(function(rw){
    var r=candidate(useColor?clean(rw.B):rw.B,W,H,240);
    if(r){r.sim=rw.sim;r.whole=rw.cnt/N;res.push(r);}
  });
  res.sort(function(a,b){return a.share-b.share;});
  /* Fast gleich große Kandidaten zusammenlegen. */
  return res.filter(function(r,idx){return idx===0||r.share>res[idx-1].share*1.06;});
}

var api={
  prepare:prepare,masks:masks,scan:scan,windows:windows,surface:surface,classMap:classMap,state:state,
  onChange:function(f){listeners.push(f);},
  blocked:crashed,
  reset:function(){crashedBefore=false;guard(false);if(job&&job.failed)job=null;}
};
root.HausSeg=api;
})(typeof window!=="undefined"?window:this);
