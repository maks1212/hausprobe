(function(){
"use strict";
var DATA=window.HausData,SEG=window.HausSeg,REF=window.HausRefine;
var KIND={dach:"Dach",fassade:"Fassade",cut:"Aussparung"};
var $=function(id){return document.getElementById(id);};
var cv=$("cv"),ctx=cv.getContext("2d");
var W=1200,H=800,src=null,after=document.createElement("canvas");
var surfaces=[],sel=null,mode="view",split=.5,drawing=null,drag=null,dragSplit=false,nextId=1,pending=false,error="",isSample=true,saveT=0;
var MASKS={},SHADES={},layer=document.createElement("canvas"),grain=null;

function mk(w,h){var c=document.createElement("canvas");c.width=w;c.height=h;return c;}
function px(s){return s.pts.map(function(p){return [p.x*W,p.y*H];});}
function trace(c,P){c.beginPath();P.forEach(function(p,i){i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);});c.closePath();}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function bbox(P){var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;P.forEach(function(p){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);});return [x0,y0,x1,y1];}

function setImage(c){
  src=c;W=c.width;H=c.height;cv.width=W;cv.height=H;after.width=W;after.height=H;
  MASKS={};SHADES={};
}

/* Unit square to quad. Straight lines stay straight, so patterns are drawn as vector lines in perspective. */
function homography(q){
  var x0=q[0][0],y0=q[0][1],x1=q[1][0],y1=q[1][1],x2=q[2][0],y2=q[2][1],x3=q[3][0],y3=q[3][1];
  var dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,sx=x0-x1+x2-x3,sy=y0-y1+y2-y3,g=0,h=0,den=dx1*dy2-dx2*dy1;
  if(Math.abs(den)>1e-9&&(Math.abs(sx)>1e-9||Math.abs(sy)>1e-9)){g=(sx*dy2-dx2*sy)/den;h=(dx1*sy-sx*dy1)/den;}
  var a=x1-x0+g*x1,b=x3-x0+h*x3,d=y1-y0+g*y1,e=y3-y0+h*y3;
  return function(u,v){var w=g*u+h*v+1;return [(a*u+b*v+x0)/w,(d*u+e*v+y0)/w];};
}
/* Corner order: clockwise on screen, lowest edge last, so seams run from ridge to eave. */
function quadFor(s,P){
  var q;
  if(P.length===4){
    q=P.slice();var ar=0;for(var i=0;i<4;i++){var n=q[(i+1)%4];ar+=q[i][0]*n[1]-n[0]*q[i][1];}
    if(ar<0)q.reverse();
    var best=0,bs=-1e9;for(var k=0;k<4;k++){var sc=q[(2+k)%4][1]+q[(3+k)%4][1];if(sc>bs){bs=sc;best=k;}}
    q=[0,1,2,3].map(function(i){return q[(i+best)%4];});
  }else{var b=bbox(P);q=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];}
  var r=s.rot||0;return [0,1,2,3].map(function(i){return q[(i+r)%4];});
}
function prod(s){return DATA.byId[s.mat]||DATA.products[0];}
function hex(code){var c=DATA.colors[code];return c?c.hex:"#888888";}
/* Startwert für die Musterdichte: angenommene Flächenbreite geteilt durchs Rastermaß des Produkts. */
function defScale(pr,kind){
  var ref=pr.pat==="hline"?5500:(kind==="dach"?11000:9000);
  return Math.max(3,Math.min(60,Math.round(ref/pr.cell)));
}
function patternLines(pr,n,ratio){
  var L=[],i,j,m,c,u,v;
  if(pr.pat==="seam"){for(i=1;i<n;i++)L.push([i/n,0,i/n,1]);}
  else if(pr.pat==="hline"){
    var mix=pr.mix||[1],sum=0;mix.forEach(function(x){sum+=x;});var unit=mix.length/(sum*n);v=0;
    for(j=0;j<400;j++){v+=mix[j%mix.length]*unit;if(v>=.999)break;L.push([0,v,1,v]);}
  }else if(pr.pat==="offset"){
    m=Math.max(1,Math.round(n*ratio*pr.w/pr.h));
    for(j=0;j<m;j++){
      if(j)L.push([0,j/m,1,j/m]);
      var sh=(j*(pr.shift||.5))%1;
      for(i=0;i<=n;i++){u=(i+sh)/n;if(u>0&&u<1)L.push([u,j/m,u,(j+1)/m]);}
    }
  }else if(pr.pat==="raute"){
    m=Math.max(1,Math.round(n*ratio));
    for(c=1;c<n+m;c++)L.push([(c-Math.min(c,m))/n,Math.min(c,m)/m,Math.min(c,n)/n,(c-Math.min(c,n))/m]);
    for(c=-(m-1);c<n;c++){var a=Math.max(c,0),b=Math.min(n,m+c);L.push([a/n,(a-c)/m,b/n,(b-c)/m]);}
  }
  return L;
}
/* Erkannte Flächen haben eine Maske: das Material wird vollflächig gemalt und dann auf die Maske beschnitten.
   Die vier Ecken bestimmen bei ihnen nur die Perspektive des Musters. */
function paint(c,s){
  var m=MASKS[s.id];
  if(!m){paintInner(c,s,false);return;}
  if(layer.width!==W||layer.height!==H){layer.width=W;layer.height=H;}
  var lc=layer.getContext("2d");lc.globalCompositeOperation="source-over";lc.globalAlpha=1;lc.clearRect(0,0,W,H);
  paintInner(lc,s,true);
  lc.globalCompositeOperation="destination-in";lc.imageSmoothingEnabled=true;lc.drawImage(m,0,0,W,H);lc.globalCompositeOperation="source-over";
  c.drawImage(layer,0,0);
}
/* Geprägte Kornstruktur als kachelbare Textur: geglättetes Rauschen, schräg beleuchtet. */
function stucco(){
  if(grain)return grain;
  var n=192,a=new Float32Array(n*n),b=new Float32Array(n*n),i,x,y;
  for(i=0;i<n*n;i++)a[i]=Math.random();
  function at(arr,x,y){return arr[((y+n)%n)*n+(x+n)%n];}
  for(y=0;y<n;y++)for(x=0;x<n;x++)b[y*n+x]=(at(a,x,y)*2+at(a,x-1,y)+at(a,x+1,y)+at(a,x,y-1)+at(a,x,y+1))/6;
  grain=mk(n,n);var g=grain.getContext("2d"),im=g.createImageData(n,n),d=im.data;
  for(y=0;y<n;y++)for(x=0;x<n;x++){
    var e=at(b,x+1,y+1)-at(b,x-1,y-1),v=e>0?255:0,al=Math.min(1,Math.abs(e)*3.2)*36;
    i=(y*n+x)*4;d[i]=d[i+1]=d[i+2]=v;d[i+3]=al;
  }
  g.putImageData(im,0,0);return grain;
}
/* Plastische Wirkung der einzelnen Elemente: jede Bahn, Platte oder Raute bekommt oben Licht, unten Schatten
   und einen leicht eigenen Farbton, wie bei echtem Blech mit Überdeckung. */
function relief(c,pr,n,ratio,map){
  function poly(pts){c.beginPath();pts.forEach(function(p,i){var X=map(p[0],p[1]);i?c.lineTo(X[0],X[1]):c.moveTo(X[0],X[1]);});c.closePath();}
  function rnd(i,j){var h=Math.sin(i*127.1+j*311.7)*43758.5453;return h-Math.floor(h);}
  function grad(p0,p1,stops){var A=map(p0[0],p0[1]),B=map(p1[0],p1[1]),g=c.createLinearGradient(A[0],A[1],B[0],B[1]);stops.forEach(function(s){g.addColorStop(s[0],s[1]);});return g;}
  var LAP=[[0,"rgba(255,255,255,.09)"],[.3,"rgba(255,255,255,0)"],[.6,"rgba(0,0,0,0)"],[1,"rgba(0,0,0,.2)"]];
  function tone(t,k){return t<.5?"rgba(0,0,0,"+((.5-t)*k)+")":"rgba(255,255,255,"+((t-.5)*k)+")";}
  var i,j,m,u0,u1,v0,v1,t;
  if(pr.pat==="hline"){
    var mix=pr.mix||[1],sum=0;mix.forEach(function(x){sum+=x;});var unit=mix.length/(sum*n);v0=0;
    for(j=0;j<400&&v0<1;j++){
      v1=Math.min(1,v0+mix[j%mix.length]*unit);
      poly([[0,v0],[1,v0],[1,v1],[0,v1]]);c.fillStyle=grad([.5,v0],[.5,v1],LAP);c.fill();
      c.fillStyle=tone(rnd(j,7),.07);c.fill();v0=v1;
    }
  }else if(pr.pat==="offset"){
    m=Math.max(1,Math.round(n*ratio*pr.w/pr.h));
    for(j=0;j<m;j++){
      v0=j/m;v1=(j+1)/m;
      poly([[0,v0],[1,v0],[1,v1],[0,v1]]);c.fillStyle=grad([.5,v0],[.5,v1],LAP);c.fill();
      if(n*m>5000)continue;
      var sh=(j*(pr.shift||.5))%1;
      for(i=-1;i<n;i++){
        u0=Math.max(0,(i+sh)/n);u1=Math.min(1,(i+1+sh)/n);if(u1<=u0)continue;
        poly([[u0,v0],[u1,v0],[u1,v1],[u0,v1]]);c.fillStyle=tone(rnd(i,j),.11);c.fill();
      }
    }
  }else if(pr.pat==="raute"){
    m=Math.max(1,Math.round(n*ratio));
    if((n+m)*(n+m)>7000)return;
    var a,b2,cx,cy;
    for(a=0;a<n+m;a++)for(b2=-m;b2<n;b2++){
      cx=(a+b2+1)/2;cy=(a-b2)/2;
      if(cx<-.5||cx>n+.5||cy<-.5||cy>m+.5)continue;
      poly([[(cx-.5)/n,cy/m],[cx/n,(cy-.5)/m],[(cx+.5)/n,cy/m],[cx/n,(cy+.5)/m]]);
      c.fillStyle=grad([cx/n,(cy-.5)/m],[cx/n,(cy+.5)/m],LAP);c.fill();
      c.fillStyle=tone(rnd(a,b2),.11);c.fill();
    }
  }else if(pr.pat==="seam"){
    for(i=0;i<n;i++){
      u0=i/n;u1=(i+1)/n;poly([[u0,0],[u1,0],[u1,1],[u0,1]]);
      c.fillStyle=grad([u0,.5],[u1,.5],[[0,"rgba(0,0,0,.2)"],[.1,"rgba(0,0,0,0)"],[.88,"rgba(255,255,255,0)"],[1,"rgba(255,255,255,.1)"]]);c.fill();
      c.fillStyle=tone(rnd(i,3),.05);c.fill();
    }
  }
}
function shadeFor(s){
  if(!REF)return null;
  var m=MASKS[s.id],key=m?"m":JSON.stringify(s.pts),hit=SHADES[s.id];
  if(hit&&hit.key===key)return hit.canvas;
  var canvas=REF.shade(src,function(g,w,h){
    if(m){g.drawImage(m,0,0,w,h);return;}
    g.beginPath();s.pts.forEach(function(p,i){i?g.lineTo(p.x*w,p.y*h):g.moveTo(p.x*w,p.y*h);});g.closePath();g.fill();
  });
  SHADES[s.id]={key:key,canvas:canvas};return canvas;
}
function paintInner(c,s,masked){
  var P=px(s),q=quadFor(s,P),map=homography(q),b=bbox(P);
  if(masked)b=s.mb?[s.mb[0]*W,s.mb[1]*H,s.mb[2]*W,s.mb[3]*H]:[0,0,W,H];
  c.save();if(!masked){trace(c,P);c.clip();}
  c.fillStyle=hex(s.color);c.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);
  var wq=(dist(q[0],q[1])+dist(q[3],q[2]))/2,hq=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
  var pr=prod(s),ratio=hq/Math.max(1,wq);
  relief(c,pr,s.scale,ratio,map);
  var lines=patternLines(pr,s.scale,ratio);
  if(lines.length){
    var path=new Path2D();
    lines.forEach(function(l){var A=map(l[0],l[1]),B=map(l[2],l[3]);path.moveTo(A[0],A[1]);path.lineTo(B[0],B[1]);});
    /* Fuge mit weichem Schattenwurf darunter und schmalem Lichtsaum darüber, damit die Bahnen plastisch wirken. */
    var lw=Math.max(1,W/900);
    c.save();c.translate(lw*.6,lw*1.6);c.lineWidth=lw*4.5;c.strokeStyle="rgba(0,0,0,.07)";c.stroke(path);
    c.lineWidth=lw*2.4;c.strokeStyle="rgba(0,0,0,.10)";c.stroke(path);c.restore();
    c.save();c.translate(-lw*.5,-lw*1.1);c.lineWidth=lw;c.strokeStyle="rgba(255,255,255,.16)";c.stroke(path);c.restore();
    c.lineWidth=lw;c.strokeStyle="rgba(0,0,0,.5)";c.stroke(path);
  }
  /* Oberflächenstruktur (Stucco-Prägung); glatte Produkte bekommen nur einen Hauch davon. */
  c.globalAlpha=pr.smooth?.3:1;c.fillStyle=c.createPattern(stucco(),"repeat");c.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);c.globalAlpha=1;
  /* Licht und Schatten des Fotos auf das neue Material legen. */
  var sh=s.shade>0?shadeFor(s):null;
  if(sh){
    c.imageSmoothingEnabled=true;c.globalCompositeOperation="hard-light";c.globalAlpha=Math.min(1,s.shade);
    c.drawImage(sh,0,0,W,H);c.globalCompositeOperation="source-over";c.globalAlpha=1;
  }
  c.restore();
  if(!masked){trace(c,P);c.lineWidth=Math.max(1,W/900);c.strokeStyle="rgba(0,0,0,.35)";c.stroke();}
}
function renderAfter(){
  var a=after.getContext("2d");a.globalCompositeOperation="source-over";a.globalAlpha=1;a.drawImage(src,0,0);
  surfaces.forEach(function(s){if(s.kind!=="cut")paint(a,s);});
  surfaces.forEach(function(s){if(s.kind==="cut"){a.save();trace(a,px(s));a.clip();a.drawImage(src,0,0);a.restore();}});
}
function draw(){
  var k=W/Math.max(1,cv.getBoundingClientRect().width);
  ctx.drawImage(after,0,0);
  if(mode==="view"){
    var x=split*W;
    ctx.save();ctx.beginPath();ctx.rect(0,0,x,H);ctx.clip();ctx.drawImage(src,0,0);ctx.restore();
    ctx.fillStyle="rgba(0,0,0,.45)";ctx.fillRect(x-1.5*k,0,3*k,H);
    ctx.fillStyle="#fff";ctx.fillRect(x-.75*k,0,1.5*k,H);
    ctx.beginPath();ctx.arc(x,H/2,14*k,0,7);ctx.fillStyle="#fff";ctx.fill();ctx.lineWidth=1.5*k;ctx.strokeStyle="rgba(0,0,0,.5)";ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-4*k,H/2-5*k);ctx.lineTo(x-9*k,H/2);ctx.lineTo(x-4*k,H/2+5*k);
    ctx.moveTo(x+4*k,H/2-5*k);ctx.lineTo(x+9*k,H/2);ctx.lineTo(x+4*k,H/2+5*k);ctx.strokeStyle="#1b2327";ctx.lineWidth=2*k;ctx.stroke();
    return;
  }
  surfaces.forEach(function(s){
    var P=px(s),on=s.id===sel;trace(ctx,P);
    ctx.lineWidth=(on?4:3)*k;ctx.strokeStyle="rgba(0,0,0,.6)";ctx.setLineDash([]);ctx.stroke();
    ctx.lineWidth=(on?2.5:1.5)*k;ctx.strokeStyle=on?"#5ff0d6":"#fff";ctx.setLineDash(on?[]:[6*k,5*k]);ctx.stroke();ctx.setLineDash([]);
    if(on)P.forEach(function(p){dotAt(p,k,"#5ff0d6");});
  });
  if(drawing&&drawing.auto){
    var cand=drawing.cands[drawing.pick];
    if(cand){ctx.globalAlpha=.5;ctx.drawImage(cand.canvas,0,0,W,H);ctx.globalAlpha=1;}
    drawing.taps.forEach(function(t){
      ctx.beginPath();ctx.arc(t.x*W,t.y*H,7*k,0,7);ctx.fillStyle=t.add?"#fff":"#e5533d";ctx.fill();ctx.lineWidth=2*k;ctx.strokeStyle="#10181a";ctx.stroke();
    });
  }else if(drawing){
    var D=drawing.pts.map(function(p){return [p.x*W,p.y*H];});
    if(D.length>1){ctx.beginPath();D.forEach(function(p,i){i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);});
      ctx.lineWidth=4*k;ctx.strokeStyle="rgba(0,0,0,.6)";ctx.stroke();ctx.lineWidth=2.5*k;ctx.strokeStyle="#ffd84d";ctx.stroke();}
    D.forEach(function(p){dotAt(p,k,"#ffd84d");});
  }
}
function dotAt(p,k,col){ctx.beginPath();ctx.arc(p[0],p[1],8*k,0,7);ctx.fillStyle=col;ctx.fill();ctx.lineWidth=2*k;ctx.strokeStyle="#10181a";ctx.stroke();}
function refresh(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;renderAfter();draw();save();});}

function current(){return surfaces.filter(function(s){return s.id===sel;})[0]||null;}
function addSurface(kind,pts,o){
  var n=surfaces.filter(function(s){return s.kind===kind;}).length+1;
  var s={id:nextId++,kind:kind,name:KIND[kind]+" "+n,pts:pts,rot:0,shade:.9,
    mat:kind==="dach"?"prefalz":"siding",color:"02",scale:0};
  if(kind!=="cut")s.scale=defScale(prod(s),kind);
  if(o)for(var key in o)s[key]=o[key];
  surfaces.push(s);return s;
}
function startDraw(kind){
  mode="edit";sel=null;error="";
  drawing={kind:kind,pts:[],auto:kind!=="cut"&&!!SEG&&!SEG.blocked(),taps:[],sub:false,cands:[],pick:0,picked:false,busy:false,miss:false,ticket:0};
  if(drawing.auto)SEG.prepare(src);
  ui();draw();
}
function setMethod(auto){
  if(!drawing)return;
  drawing.auto=auto&&!!SEG;drawing.pts=[];drawing.taps=[];drawing.cands=[];drawing.miss=false;drawing.busy=false;drawing.picked=false;drawing.ticket++;
  if(drawing.auto){SEG.reset();SEG.prepare(src);}
  ui();draw();
}
function autoFailed(d){
  if(drawing!==d)return;
  d.auto=false;d.busy=false;d.taps=[];d.cands=[];d.pts=[];
  error="Die automatische Erkennung läuft auf diesem Gerät gerade nicht. Setze die Ecken selbst oder tippe noch einmal auf „Automatisch“.";
  ui();error="";draw();
}
function runDetect(){
  var d=drawing;if(!d||!d.auto)return;
  var ticket=++d.ticket;
  if(!d.taps.length){d.cands=[];d.busy=false;d.miss=false;d.picked=false;ui();draw();return;}
  d.busy=true;ui();draw();
  SEG.masks(d.taps.slice()).then(function(c){
    if(drawing!==d||d.ticket!==ticket)return;
    d.busy=false;d.cands=c;d.miss=!c.length;
    if(!d.picked||d.pick>=c.length){
      /* Standard: die kleinste Fläche, die kein Detail ist (also das Bauteil, nicht das ganze Haus). */
      d.pick=0;for(var i=0;i<c.length;i++)if(c[i].share>=.015){d.pick=i;break;}
    }
    ui();draw();
  }).catch(function(){autoFailed(d);});
}
function finishDraw(){
  var d=drawing;if(!d)return;
  if(d.auto){
    var c=d.cands[d.pick];if(!c||d.busy)return;
    var s=addSurface(d.kind,c.quad,{mb:c.mb});
    var fine=c.canvas;try{if(REF)fine=REF.refine(c.canvas,src);}catch(e){}
    MASKS[s.id]=fine;try{s.maskUrl=fine.toDataURL("image/png");}catch(e){}
    sel=s.id;
  }else{
    if(d.pts.length<3)return;
    sel=addSurface(d.kind,d.pts).id;
  }
  drawing=null;ui();refresh();
}
function drawHint(){
  var d=drawing,what=d.kind==="dach"?"Dachfläche":"Wandfläche",st=SEG?SEG.state:{};
  if(d.kind==="cut")return "Tippe die Ecken von Fenster oder Tür an. Dort bleibt das Originalfoto sichtbar.";
  if(!d.auto)return d.kind==="dach"?"Tippe die Ecken der Dachfläche der Reihe nach an: zuerst entlang der Traufe, dann am First. Vier Ecken ergeben die beste Perspektive."
    :"Tippe die Ecken der Wandfläche der Reihe nach an. Fenster und Türen sparst du danach aus.";
  var wait=st.phase==="laden"?"Die Erkennung wird geladen (einmalig rund 41 MB): "+st.progress+" %. "
    :st.phase==="analyse"?"Das Foto wird analysiert, das dauert einmal pro Foto einige Sekunden. ":"";
  if(!d.taps.length)return wait+"Tippe mitten auf die "+what+".";
  if(wait)return wait+"Dein Tipp wird danach ausgewertet.";
  if(d.busy)return "Die Fläche wird gesucht.";
  if(d.miss)return "Hier wurde keine Fläche gefunden. Tippe auf eine andere Stelle.";
  return "Passt die gelbe Fläche? Fehlt ein Teil, etwa im Schatten, tippe darauf. Mit „Wegnehmen“ entfernst du Teile, „Kleiner“ und „Größer“ wechseln zwischen Bauteil und ganzem Haus.";
}
function summary(){return surfaces.filter(function(s){return s.kind!=="cut";}).map(function(s){return s.name+": "+matName(s)+", "+colName(s.color);}).join("\n");}
function exportBlob(cb){renderAfter();after.toBlob(cb,"image/jpeg",.92);}

function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
function matName(s){return prod(s).name;}
function colName(code){var c=DATA.colors[code];return c?code+" "+c.name:"";}
function ui(){
  $("mode-view").setAttribute("aria-pressed",mode==="view");$("mode-edit").setAttribute("aria-pressed",mode==="edit");
  cv.className=mode==="edit"?"edit":"";
  $("l-before").hidden=$("l-after").hidden=$("split").hidden=mode!=="view";
  $("drawbar").hidden=!drawing;var D=drawing,A=D&&D.auto;
  $("d-done").disabled=!D||(A?!D.cands[D.pick]||D.busy:D.pts.length<3);
  $("d-undo").disabled=!D||!(A?D.taps.length:D.pts.length);
  $("methods").hidden=!D||D.kind==="cut";$("autobar").hidden=!(A&&D.taps.length);$("actions").hidden=mode!=="view";
  if(D){
    $("m-auto").setAttribute("aria-pressed",!!A);$("m-manual").setAttribute("aria-pressed",!A);
    $("pt-add").setAttribute("aria-pressed",!D.sub);$("pt-sub").setAttribute("aria-pressed",!!D.sub);
    $("sz-less").disabled=D.busy||D.pick<=0;$("sz-more").disabled=D.busy||D.pick>=D.cands.length-1;
  }
  save();
  var h;
  if(error)h=error;
  else if(drawing)h=drawHint();
  else if(!surfaces.length)h="Noch keine Fläche markiert. Starte mit + Dach oder + Fassade.";
  else if(mode==="view")h="Zieh die Trennlinie über das Bild: links das Original, rechts der neue Look.";
  else h="Tippe eine Fläche an, um sie auszuwählen. Die Eckpunkte kannst du verschieben; bei erkannten Flächen richten sie das Muster aus.";
  $("hint").textContent=h;

  var chips=$("chips");chips.textContent="";
  surfaces.forEach(function(s){
    var b=el("button","btn");b.type="button";b.setAttribute("aria-pressed",s.id===sel);
    if(s.kind!=="cut"){var d=el("span","dot");d.style.background=hex(s.color);b.appendChild(d);}
    b.appendChild(document.createTextNode(s.kind==="cut"?s.name:s.name+" · "+matName(s)+", "+colName(s.color)));
    b.onclick=function(){if(drawing)return;sel=s.id;ui();draw();};chips.appendChild(b);
  });
  var s=current();$("editor").hidden=!s||!!drawing;if(!s)return;
  $("ed-title").textContent=s.name;$("ed-style").hidden=$("rot").hidden=s.kind==="cut";
  if(s.kind==="cut")return;
  var mats=$("mats");mats.textContent="";
  var pr=prod(s),pal=DATA.palettes[pr.pal];
  DATA.products.filter(function(m){return m.kind===s.kind;}).forEach(function(m){
    var b=el("button","btn",m.name);b.type="button";b.setAttribute("aria-pressed",m.id===s.mat);
    b.onclick=function(){s.mat=m.id;s.scale=defScale(m,s.kind);if(DATA.palettes[m.pal].indexOf(s.color)<0)s.color=DATA.palettes[m.pal][0];ui();refresh();};
    mats.appendChild(b);
  });
  $("mat-info").textContent=pr.info;
  var cols=$("colors");cols.textContent="";
  pal.forEach(function(code){
    var c=DATA.colors[code],b=el("button","sw");b.type="button";b.style.background=c.hex;b.title=code+" "+c.name;
    b.setAttribute("aria-label",code+" "+c.name);b.setAttribute("aria-pressed",code===s.color);
    b.onclick=function(){s.color=code;ui();refresh();};cols.appendChild(b);
  });
  var cur=DATA.colors[s.color];
  $("color-name").textContent=colName(s.color)+(cur?" · ähnlich RAL "+cur.ral:"");
  $("scale").value=63-s.scale;$("shade").value=Math.round(s.shade*100);
}

function pos(e){var r=cv.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height)),r:r};}
function inPoly(p,pts){var c=false;for(var i=0,j=pts.length-1;i<pts.length;j=i++){var a=pts[i],b=pts[j];
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c;}return c;}
function near(p,q,r,lim){return Math.hypot((p.x-q.x)*r.width,(p.y-q.y)*r.height)<lim;}
cv.addEventListener("pointerdown",function(e){
  var p=pos(e);
  if(mode==="view"){dragSplit=true;split=p.x;$("split").value=Math.round(split*100);cv.setPointerCapture(e.pointerId);draw();return;}
  e.preventDefault();
  if(drawing){
    if(drawing.auto){drawing.taps.push({x:p.x,y:p.y,add:!drawing.sub});runDetect();return;}
    if(drawing.pts.length>=3&&near(p,drawing.pts[0],p.r,20)){finishDraw();return;}
    drawing.pts.push({x:p.x,y:p.y});ui();draw();return;
  }
  var s=current();
  if(s)for(var i=0;i<s.pts.length;i++)if(near(p,s.pts[i],p.r,24)){drag={s:s,i:i};cv.setPointerCapture(e.pointerId);return;}
  var order=surfaces.filter(function(x){return x.kind==="cut";}).concat(surfaces.filter(function(x){return x.kind!=="cut";}).reverse());
  var hit=order.filter(function(x){return inPoly(p,x.pts);})[0];
  if(hit){sel=hit.id;ui();draw();}
});
cv.addEventListener("pointermove",function(e){
  if(dragSplit){split=pos(e).x;$("split").value=Math.round(split*100);draw();}
  else if(drag){var p=pos(e);drag.s.pts[drag.i]={x:p.x,y:p.y};refresh();}
});
function endDrag(){dragSplit=false;drag=null;}
cv.addEventListener("pointerup",endDrag);cv.addEventListener("pointercancel",endDrag);

$("split").oninput=function(){split=this.value/100;draw();};
$("mode-view").onclick=function(){if(drawing)drawing=null;mode="view";ui();draw();};
$("mode-edit").onclick=function(){mode="edit";ui();draw();};
$("add-dach").onclick=function(){startDraw("dach");};
$("add-fassade").onclick=function(){startDraw("fassade");};
$("add-cut").onclick=function(){startDraw("cut");};
$("d-done").onclick=finishDraw;
$("d-undo").onclick=function(){
  if(!drawing)return;
  if(drawing.auto){drawing.taps.pop();runDetect();}else{drawing.pts.pop();ui();draw();}
};
$("pt-add").onclick=function(){if(drawing){drawing.sub=false;ui();}};
$("pt-sub").onclick=function(){if(drawing){drawing.sub=true;ui();}};
function step(n){var d=drawing;if(!d||!d.cands.length)return;d.pick=Math.max(0,Math.min(d.cands.length-1,d.pick+n));d.picked=true;ui();draw();}
$("sz-less").onclick=function(){step(-1);};
$("sz-more").onclick=function(){step(1);};
if(SEG)SEG.onChange(function(st){
  var d=drawing;if(!d||!d.auto)return;
  if(st.phase==="fehler"){autoFailed(d);return;}
  ui();
});
$("d-cancel").onclick=function(){drawing=null;ui();draw();};
$("m-auto").onclick=function(){setMethod(true);};
$("m-manual").onclick=function(){setMethod(false);};
$("save").onclick=function(){exportBlob(function(b){
  if(!b)return;var a=document.createElement("a"),u=URL.createObjectURL(b);a.href=u;a.download="hausprobe.jpg";
  document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},10000);
});};
var canShare=false;
try{canShare=!!navigator.canShare&&navigator.canShare({files:[new File([new Blob(["x"],{type:"image/jpeg"})],"t.jpg",{type:"image/jpeg"})]});}catch(e){}
$("share").hidden=!canShare;
$("share").onclick=function(){exportBlob(function(b){
  if(!b)return;var f=new File([b],"hausprobe.jpg",{type:"image/jpeg"});
  navigator.share({files:[f],title:"Hausprobe",text:summary()}).catch(function(){});
});};
$("scale").oninput=function(){var s=current();if(s){s.scale=63-(+this.value);refresh();}};
$("shade").oninput=function(){var s=current();if(s){s.shade=this.value/100;refresh();}};
$("rot").onclick=function(){var s=current();if(s){s.rot=((s.rot||0)+1)%4;refresh();}};
$("del").onclick=function(){delete MASKS[sel];delete SHADES[sel];surfaces=surfaces.filter(function(s){return s.id!==sel;});sel=null;ui();refresh();};
$("btn-sample").onclick=function(){try{localStorage.removeItem("hausprobe.photo");}catch(e){}loadSample();};
$("file").onchange=function(){
  var f=this.files&&this.files[0];if(!f)return;this.value="";
  var url=URL.createObjectURL(f),img=new Image();
  img.onload=function(){
    var sc=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    var c=mk(Math.max(1,Math.round(img.naturalWidth*sc)),Math.max(1,Math.round(img.naturalHeight*sc)));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
    setImage(c);isSample=false;storePhoto(c);surfaces=[];nextId=1;sel=null;$("badge").hidden=true;renderAfter();startDraw("dach");
  };
  img.onerror=function(){URL.revokeObjectURL(url);error="Dieses Bild lässt sich nicht öffnen. Wähle ein JPG oder PNG.";ui();error="";};
  img.src=url;
};

function sampleHouse(){
  var c=mk(1200,800),g=c.getContext("2d"),gr,i;
  gr=g.createLinearGradient(0,0,0,640);gr.addColorStop(0,"#a9cbe3");gr.addColorStop(1,"#e6f0f3");g.fillStyle=gr;g.fillRect(0,0,1200,800);
  g.fillStyle="#6f9459";g.fillRect(0,640,1200,160);
  g.fillStyle="#86a86c";g.beginPath();g.ellipse(600,640,700,40,0,Math.PI,0);g.fill();
  g.fillStyle="#c9c2b4";g.beginPath();g.moveTo(560,650);g.lineTo(640,650);g.lineTo(720,800);g.lineTo(480,800);g.fill();
  g.fillStyle="#5a4636";g.fillRect(150,470,22,180);g.fillStyle="#4e7f4a";g.beginPath();g.arc(161,420,90,0,7);g.fill();
  g.fillStyle="#5f9057";g.beginPath();g.arc(190,390,55,0,7);g.fill();
  g.fillStyle="#9a8f85";g.fillRect(700,170,44,80);g.fillStyle="#7d736a";g.fillRect(694,164,56,12);
  g.fillStyle="#e3d2a2";g.fillRect(330,400,540,250);
  gr=g.createLinearGradient(0,400,0,450);gr.addColorStop(0,"rgba(60,45,20,.38)");gr.addColorStop(1,"rgba(60,45,20,0)");g.fillStyle=gr;g.fillRect(330,400,540,50);
  gr=g.createLinearGradient(330,0,870,0);gr.addColorStop(0,"rgba(255,255,255,.12)");gr.addColorStop(1,"rgba(0,0,0,.10)");g.fillStyle=gr;g.fillRect(330,400,540,250);
  g.fillStyle="#b6a988";g.fillRect(330,628,540,22);
  [[400,460],[700,460]].forEach(function(w){
    g.fillStyle="#f5f3ee";g.fillRect(w[0]-6,w[1]-6,112,112);g.fillStyle="#6f93ad";g.fillRect(w[0],w[1],100,100);
    g.fillStyle="rgba(255,255,255,.25)";g.beginPath();g.moveTo(w[0],w[1]+60);g.lineTo(w[0]+60,w[1]);g.lineTo(w[0]+90,w[1]);g.lineTo(w[0],w[1]+90);g.fill();
    g.fillStyle="#f5f3ee";g.fillRect(w[0]+47,w[1],6,100);g.fillRect(w[0],w[1]+47,100,6);
  });
  g.fillStyle="#f5f3ee";g.fillRect(554,494,92,156);g.fillStyle="#6b4a33";g.fillRect(560,500,80,150);
  g.fillStyle="#57391f";g.fillRect(572,514,56,50);g.fillStyle="#d9c48a";g.beginPath();g.arc(628,582,5,0,7);g.fill();
  g.save();g.beginPath();g.moveTo(300,410);g.lineTo(900,410);g.lineTo(840,230);g.lineTo(360,230);g.closePath();g.fillStyle="#a8563f";g.fill();g.clip();
  gr=g.createLinearGradient(300,0,900,0);gr.addColorStop(0,"rgba(255,220,190,.22)");gr.addColorStop(.6,"rgba(0,0,0,0)");gr.addColorStop(1,"rgba(0,0,0,.25)");g.fillStyle=gr;g.fillRect(300,230,600,180);
  g.strokeStyle="rgba(70,25,15,.45)";g.lineWidth=2;for(i=244;i<410;i+=14){g.beginPath();g.moveTo(300,i);g.lineTo(900,i);g.stroke();}
  g.fillStyle="rgba(0,0,0,.16)";g.beginPath();g.moveTo(744,250);g.lineTo(800,250);g.lineTo(830,330);g.lineTo(770,330);g.fill();
  g.restore();
  g.fillStyle="#8e949a";g.fillRect(296,406,608,9);
  return c;
}
function loadSample(){
  setImage(sampleHouse());isSample=true;surfaces=[];nextId=1;drawing=null;mode="view";split=.5;$("split").value=50;$("badge").hidden=false;
  function n(a){return a.map(function(p){return {x:p[0]/1200,y:p[1]/800};});}
  function r(x0,y0,x1,y1){return n([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);}
  var roof=addSurface("dach",n([[300,410],[900,410],[840,230],[360,230]]));
  addSurface("fassade",r(330,412,870,650),{color:"10"});
  addSurface("cut",r(394,454,506,566));addSurface("cut",r(694,454,806,566));addSurface("cut",r(554,494,646,650));
  sel=roof.id;renderAfter();ui();draw();
}
function save(){
  clearTimeout(saveT);saveT=setTimeout(function(){
    try{localStorage.setItem("hausprobe.state",JSON.stringify({v:4,sample:isSample,surfaces:surfaces,nextId:nextId}));}catch(e){}
  },300);
}
function storePhoto(c){
  try{localStorage.setItem("hausprobe.photo",c.toDataURL("image/jpeg",.85));}
  catch(e){try{localStorage.removeItem("hausprobe.photo");}catch(e2){}}
}
function applyState(st){
  surfaces=st.surfaces;nextId=st.nextId||surfaces.length+1;sel=surfaces.length?surfaces[0].id:null;
  drawing=null;mode="view";renderAfter();ui();draw();
  surfaces.forEach(function(s){
    if(!s.maskUrl)return;
    var img=new Image();
    img.onload=function(){var c=mk(img.naturalWidth,img.naturalHeight);c.getContext("2d").drawImage(img,0,0);MASKS[s.id]=c;delete SHADES[s.id];refresh();};
    img.src=s.maskUrl;
  });
}
function restore(){
  var st=null,ph=null;
  try{st=JSON.parse(localStorage.getItem("hausprobe.state")||"null");ph=localStorage.getItem("hausprobe.photo");}catch(e){}
  loadSample();
  if(!st||st.v!==4||!Array.isArray(st.surfaces))return;
  if(st.sample){applyState(st);return;}
  if(!ph)return;
  var img=new Image();
  img.onload=function(){var c=mk(img.naturalWidth,img.naturalHeight);c.getContext("2d").drawImage(img,0,0);setImage(c);isSample=false;$("badge").hidden=true;applyState(st);};
  img.src=ph;
}
restore();
window.addEventListener("resize",draw);
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(function(){});
})();
