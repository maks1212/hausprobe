(function(){
"use strict";
var DATA=window.HausData,SEG=window.HausSeg,REF=window.HausRefine;
var KIND={dach:"Dach",fassade:"Fassade",cut:"Aussparung",fenster:"Fenster"};
var $=function(id){return document.getElementById(id);};
var cv=$("cv"),ctx=cv.getContext("2d");
var W=1200,H=800,src=null,after=document.createElement("canvas");
var surfaces=[],sel=null,split=.5,adjust=false,drawing=null,drag=null,nextId=1,pending=false,error="",isSample=true,saveT=0;
var Z={z:1,tx:0,ty:0},ptrs={},gest=null,lastTap=null,view=$("view");
var MASKS={},SHADES={},EDGES={},layer=document.createElement("canvas"),grain=null;

function mk(w,h){var c=document.createElement("canvas");c.width=w;c.height=h;return c;}
function px(s){return s.pts.map(function(p){return [p.x*W,p.y*H];});}
function trace(c,P){c.beginPath();P.forEach(function(p,i){i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);});c.closePath();}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function bbox(P){var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;P.forEach(function(p){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);});return [x0,y0,x1,y1];}

function setImage(c){
  src=c;W=c.width;H=c.height;cv.width=W;cv.height=H;after.width=W;after.height=H;
  MASKS={};SHADES={};EDGES={};
  Z.z=1;Z.tx=0;Z.ty=0;cv.style.transform="";view.classList.remove("zoomed");
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
/* Echte Maße der Fläche in Metern, in Richtung des Musters (Breite quer, Höhe von oben nach unten).
   Die Breite gibt der Nutzer an oder sie ist geschätzt; fehlt die Höhe, folgt sie aus dem Seitenverhältnis im Foto. */
function realSize(s){
  var P=px(s),q=quadFor({rot:0},P),w0=(dist(q[0],q[1])+dist(q[3],q[2]))/2,h0=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
  var Wm=s.wm||9,Hm=s.hm||Wm*h0/Math.max(1,w0);
  return (s.rot||0)%2?{W:Hm,H:Wm}:{W:Wm,H:Hm};
}
/* Anzahl der Elemente in Breite (n) und Höhe (m) aus den echten Maßen und dem Format des Produkts. */
function counts(pr,Wmm,Hmm){
  var cw=pr.pat==="raute"?pr.w*Math.SQRT2:pr.w,ch=pr.pat==="raute"?cw:(pr.h||pr.w);
  return {n:Math.min(400,Math.max(.5,Wmm/cw)),m:Math.min(400,Math.max(.5,Hmm/ch))};
}
function patternLines(pr,Wmm,Hmm){
  var L=[],k=counts(pr,Wmm,Hmm),n=k.n,m=k.m,i,j,c,u,v0,v1;
  if(pr.pat==="seam"){for(i=1;i<n;i++)L.push([i/n,0,i/n,1]);}
  else if(pr.pat==="offset"){
    for(j=0;j<m;j++){
      v0=j/m;v1=Math.min(1,(j+1)/m);if(j)L.push([0,v0,1,v0]);
      var sh=(j*(pr.shift||.5))%1;
      for(i=0;i<=n;i++){u=(i+sh)/n;if(u>0&&u<1)L.push([u,v0,u,v1]);}
    }
  }else if(pr.pat==="raute"){
    for(c=1;c<n+m;c++)L.push([Math.max(0,c-m)/n,Math.min(c,m)/m,Math.min(c,n)/n,Math.max(0,c-n)/m]);
    for(c=-Math.ceil(m)+1;c<n;c++){if(c<=-m)continue;L.push([Math.max(c,0)/n,Math.max(-c,0)/m,Math.min(n,m+c)/n,Math.min(m,n-c)/m]);}
  }
  return L;
}
function paint(c,s){
  var m=MASKS[s.id];
  if(!m){paintInner(c,s,false);return;}
  if(layer.width!==W||layer.height!==H){layer.width=W;layer.height=H;}
  var lc=layer.getContext("2d");lc.globalCompositeOperation="source-over";lc.globalAlpha=1;lc.clearRect(0,0,W,H);
  paintInner(lc,s,true);
  lc.globalCompositeOperation="destination-in";lc.imageSmoothingEnabled=true;lc.drawImage(m,0,0,W,H);
  /* Leichter Schattensaum am Rand der Fläche: dort, wo das Material an Rahmen, Leisten und Dachvorsprung anschließt. */
  if(REF&&REF.edge){
    if(!(s.id in EDGES))EDGES[s.id]=REF.edge(m);
    if(EDGES[s.id]){lc.globalCompositeOperation="source-atop";lc.drawImage(EDGES[s.id],0,0,W,H);}
  }
  lc.globalCompositeOperation="source-over";
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
    var e=at(b,x+1,y+1)-at(b,x-1,y-1),v=e>0?255:0,al=Math.min(1,Math.abs(e)*3.2)*13;
    i=(y*n+x)*4;d[i]=d[i+1]=d[i+2]=v;d[i+3]=al;
  }
  g.putImageData(im,0,0);return grain;
}
/* Plastische Wirkung der einzelnen Elemente: jede Bahn, Platte oder Raute bekommt oben Licht, unten Schatten
   und einen leicht eigenen Farbton, wie bei echtem Blech mit Überdeckung. */
function relief(c,pr,Wmm,Hmm,map){
  function poly(pts){c.beginPath();pts.forEach(function(p,i){var X=map(p[0],p[1]);i?c.lineTo(X[0],X[1]):c.moveTo(X[0],X[1]);});c.closePath();}
  function rnd(i,j){var h=Math.sin(i*127.1+j*311.7)*43758.5453;return h-Math.floor(h);}
  function grad(p0,p1,stops){var A=map(p0[0],p0[1]),B=map(p1[0],p1[1]),g=c.createLinearGradient(A[0],A[1],B[0],B[1]);stops.forEach(function(s){g.addColorStop(s[0],s[1]);});return g;}
  var LAP=[[0,"rgba(255,255,255,.07)"],[.3,"rgba(255,255,255,0)"],[.65,"rgba(0,0,0,0)"],[1,"rgba(0,0,0,.15)"]];
  /* Siding: glatte Bahn mit leichtem Lichtverlauf und einer schmalen, dunklen Schattenfuge am unteren Rand. */
  var BOARD=[[0,"rgba(255,255,255,.08)"],[.22,"rgba(255,255,255,0)"],[.78,"rgba(0,0,0,.02)"],[.9,"rgba(0,0,0,.1)"],[.925,"rgba(0,0,0,.5)"],[1,"rgba(0,0,0,.62)"]];
  function tone(t,k){return t<.5?"rgba(0,0,0,"+((.5-t)*k)+")":"rgba(255,255,255,"+((t-.5)*k)+")";}
  var k=counts(pr,Wmm,Hmm),n=k.n,m=k.m,i,j,u0,u1,v0,v1;
  if(pr.pat==="hline"){
    var mix=pr.mix||[pr.w];v0=0;
    for(j=0;j<600&&v0<1;j++){
      v1=Math.min(1,v0+mix[j%mix.length]/Hmm);
      poly([[0,v0],[1,v0],[1,v1],[0,v1]]);c.fillStyle=grad([.5,v0],[.5,v1],BOARD);c.fill();
      c.fillStyle=tone(rnd(j,7),.025);c.fill();v0=v1;
    }
  }else if(pr.pat==="offset"){
    for(j=0;j<m;j++){
      v0=j/m;v1=Math.min(1,(j+1)/m);
      poly([[0,v0],[1,v0],[1,v1],[0,v1]]);c.fillStyle=grad([.5,v0],[.5,v1],LAP);c.fill();
      if(n*m>5000)continue;
      var sh=(j*(pr.shift||.5))%1;
      for(i=-1;i<n;i++){
        u0=Math.max(0,(i+sh)/n);u1=Math.min(1,(i+1+sh)/n);if(u1<=u0)continue;
        poly([[u0,v0],[u1,v0],[u1,v1],[u0,v1]]);c.fillStyle=tone(rnd(i,j),.05);c.fill();
      }
    }
  }else if(pr.pat==="raute"){
    if((n+m)*(n+m)>7000)return;
    var a,b2,cx,cy;
    for(a=0;a<n+m;a++)for(b2=-Math.ceil(m);b2<n;b2++){
      cx=(a+b2+1)/2;cy=(a-b2)/2;
      if(cx<-.5||cx>n+.5||cy<-.5||cy>m+.5)continue;
      poly([[(cx-.5)/n,cy/m],[cx/n,(cy-.5)/m],[(cx+.5)/n,cy/m],[cx/n,(cy+.5)/m]]);
      c.fillStyle=grad([cx/n,(cy-.5)/m],[cx/n,(cy+.5)/m],LAP);c.fill();
      c.fillStyle=tone(rnd(a,b2),.05);c.fill();
    }
  }else if(pr.pat==="seam"){
    for(i=0;i<n;i++){
      u0=i/n;u1=Math.min(1,(i+1)/n);poly([[u0,0],[u1,0],[u1,1],[u0,1]]);
      c.fillStyle=grad([u0,.5],[u1,.5],[[0,"rgba(0,0,0,.2)"],[.1,"rgba(0,0,0,0)"],[.88,"rgba(255,255,255,0)"],[1,"rgba(255,255,255,.1)"]]);c.fill();
      c.fillStyle=tone(rnd(i,3),.025);c.fill();
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
  var pr=prod(s),real=realSize(s),Wmm=real.W*1000,Hmm=real.H*1000;
  relief(c,pr,Wmm,Hmm,map);
  var lines=pr.pat==="hline"?[]:patternLines(pr,Wmm,Hmm);
  if(lines.length){
    var path=new Path2D();
    lines.forEach(function(l){var A=map(l[0],l[1]),B=map(l[2],l[3]);path.moveTo(A[0],A[1]);path.lineTo(B[0],B[1]);});
    /* Fuge mit weichem Schattenwurf darunter und schmalem Lichtsaum darüber, damit die Bahnen plastisch wirken. */
    var lw=Math.max(1,W/900);
    c.save();c.translate(lw*.6,lw*1.6);c.lineWidth=lw*4.5;c.strokeStyle="rgba(0,0,0,.07)";c.stroke(path);
    c.lineWidth=lw*2.4;c.strokeStyle="rgba(0,0,0,.10)";c.stroke(path);c.restore();
    c.save();c.translate(-lw*.5,-lw*1.1);c.lineWidth=lw;c.strokeStyle="rgba(255,255,255,.16)";c.stroke(path);c.restore();
    c.lineWidth=lw;c.strokeStyle="rgba(0,0,0,.4)";c.stroke(path);
  }
  /* Oberflächenstruktur (Stucco-Prägung); glatte Produkte bekommen nur einen Hauch davon. */
  c.globalAlpha=pr.smooth?.4:1;c.fillStyle=c.createPattern(stucco(),"repeat");c.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);c.globalAlpha=1;
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
  /* Gefundene Fenster bleiben immer frei, auch wenn die Erkennung sie zur Wand gezählt hat. */
  surfaces.forEach(function(s){
    if(s.kind!=="fassade"||!s.wins)return;
    s.wins.forEach(function(w){var x=w.x0*W,y=w.y0*H,ww=(w.x1-w.x0)*W,hh=(w.y1-w.y0)*H;a.drawImage(src,x,y,ww,hh,x,y,ww,hh);});
  });
  surfaces.forEach(function(s){if(s.kind==="fassade")trims(a,s);});
}
/* Fensterverkleidung wie bei PREFA: Laibung und Sturz aus Ergänzungsband rund um das Fenster, unten eine
   Fensterbank mit Tropfkante. Von vorn sieht man die Kante der Einfassung als Rahmen und die Fensterbank.
   Maße in Metern, umgerechnet über die Breite der Fläche. */
var TRIM={schlank:.04,rahmen:.1,breit:.17},tl=null,ta=null,tc=null;
function ppm(s){var q=quadFor({rot:0},px(s));return ((dist(q[0],q[1])+dist(q[3],q[2]))/2)/(s.wm||9);}
function trims(a,s){
  var t=s.trim;if(!t||!TRIM[t.style]||!s.wins||!s.wins.length)return;
  if(!tl||tl.width!==W||tl.height!==H){tl=mk(W,H);ta=mk(W,H);tc=mk(W,H);}
  var g=tl.getContext("2d"),k=ppm(s),bw=Math.max(2,TRIM[t.style]*k),col=hex(t.color||s.color),lw=Math.max(1,.008*k);
  g.globalCompositeOperation="source-over";g.globalAlpha=1;g.clearRect(0,0,W,H);
  s.wins.forEach(function(w){
    var x0=w.x0*W,y0=w.y0*H,x1=w.x1*W,y1=w.y1*H,ins=Math.min(.06*k,(x1-x0)*.12,(y1-y0)*.12);
    var sill=t.sill&&!w.door,oy1=w.door||sill?y1:y1+bw;
    var O=[x0-bw,y0-bw,x1+bw,oy1],I=[x0+ins,y0+ins,x1-ins,w.door?y1:sill?y1:y1-ins];
    function band(){g.beginPath();g.rect(O[0],O[1],O[2]-O[0],O[3]-O[1]);g.rect(I[0],I[1],I[2]-I[0],I[3]-I[1]);}
    /* Einfassung mit Schattenwurf auf die Fassade */
    g.save();g.shadowColor="rgba(0,0,0,.38)";g.shadowBlur=Math.max(2,.035*k);g.shadowOffsetX=.008*k;g.shadowOffsetY=.016*k;
    band();g.fillStyle=col;g.fill("evenodd");g.restore();
    var gr=g.createLinearGradient(0,O[1],0,O[3]);gr.addColorStop(0,"rgba(255,255,255,.1)");gr.addColorStop(.5,"rgba(255,255,255,0)");gr.addColorStop(1,"rgba(0,0,0,.08)");
    band();g.fillStyle=gr;g.fill("evenodd");
    g.fillStyle=g.createPattern(stucco(),"repeat");g.globalAlpha=.35;band();g.fill("evenodd");g.globalAlpha=1;
    /* Innen geht die Laibung in die Tiefe: dunkle Kante. Außen oben und links ein schmaler Lichtsaum. */
    g.lineWidth=lw*1.6;g.strokeStyle="rgba(0,0,0,.5)";g.strokeRect(I[0],I[1],I[2]-I[0],I[3]-I[1]);
    g.lineWidth=lw;g.strokeStyle="rgba(255,255,255,.22)";g.beginPath();g.moveTo(O[0],O[3]);g.lineTo(O[0],O[1]);g.lineTo(O[2],O[1]);g.stroke();
    g.strokeStyle="rgba(0,0,0,.25)";g.beginPath();g.moveTo(O[2],O[1]);g.lineTo(O[2],O[3]);g.stroke();
    if(sill){
      var ov=.035*k,face=Math.max(3,.045*k),sx0=O[0]-ov,sx1=O[2]+ov,sy0=y1-Math.min(ins,face*.5);
      g.save();g.shadowColor="rgba(0,0,0,.5)";g.shadowBlur=Math.max(3,.06*k);g.shadowOffsetY=.035*k;
      g.fillStyle=col;g.fillRect(sx0,sy0,sx1-sx0,face);g.restore();
      var sg=g.createLinearGradient(0,sy0,0,sy0+face);
      sg.addColorStop(0,"rgba(255,255,255,.3)");sg.addColorStop(.18,"rgba(255,255,255,.06)");sg.addColorStop(.8,"rgba(0,0,0,.05)");sg.addColorStop(1,"rgba(0,0,0,.3)");
      g.fillStyle=sg;g.fillRect(sx0,sy0,sx1-sx0,face);
      g.lineWidth=lw;g.strokeStyle="rgba(0,0,0,.45)";g.beginPath();g.moveTo(sx0,sy0+face);g.lineTo(sx1,sy0+face);g.stroke();
    }
  });
  /* Licht und Schatten vom Foto, dann auf Fassade und Fensteröffnungen beschränken (nicht über Bewuchs davor). */
  var ag=ta.getContext("2d");ag.globalCompositeOperation="copy";ag.drawImage(tl,0,0);
  var sh=s.shade>0?shadeFor(s):null;
  if(sh){g.globalCompositeOperation="hard-light";g.globalAlpha=Math.min(1,s.shade);g.drawImage(sh,0,0,W,H);g.globalAlpha=1;
    g.globalCompositeOperation="destination-in";g.drawImage(ta,0,0);}
  var cg=tc.getContext("2d");cg.globalCompositeOperation="source-over";cg.clearRect(0,0,W,H);cg.fillStyle="#000";
  if(MASKS[s.id])cg.drawImage(MASKS[s.id],0,0,W,H);else{trace(cg,px(s));cg.fill();}
  s.wins.forEach(function(w){cg.fillRect(w.x0*W,w.y0*H,(w.x1-w.x0)*W,(w.y1-w.y0)*H);});
  g.globalCompositeOperation="destination-in";g.drawImage(tc,0,0);g.globalCompositeOperation="source-over";
  a.drawImage(tl,0,0);
}
/* Der Vorher/Nachher-Regler ist immer da, sobald es eine Fläche gibt und gerade nichts markiert wird. */
function slider(){return !drawing&&!adjust&&surfaces.length>0;}
function draw(){
  var r=cv.getBoundingClientRect(),k=W/Math.max(1,r.width),s;
  ctx.drawImage(after,0,0);
  if(slider()){
    var x=split*W,vr=view.getBoundingClientRect(),cy=((vr.top+vr.height/2)-r.top)/Math.max(1,r.height)*H;
    ctx.save();ctx.beginPath();ctx.rect(0,0,x,H);ctx.clip();ctx.drawImage(src,0,0);ctx.restore();
    ctx.fillStyle="rgba(0,0,0,.45)";ctx.fillRect(x-1.5*k,0,3*k,H);
    ctx.fillStyle="#fff";ctx.fillRect(x-.75*k,0,1.5*k,H);
    ctx.beginPath();ctx.arc(x,cy,17*k,0,7);ctx.fillStyle="#fff";ctx.fill();ctx.lineWidth=1.5*k;ctx.strokeStyle="rgba(0,0,0,.5)";ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-5*k,cy-6*k);ctx.lineTo(x-11*k,cy);ctx.lineTo(x-5*k,cy+6*k);
    ctx.moveTo(x+5*k,cy-6*k);ctx.lineTo(x+11*k,cy);ctx.lineTo(x+5*k,cy+6*k);ctx.strokeStyle="#1b2327";ctx.lineWidth=2.2*k;ctx.stroke();
  }
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
  }else if(adjust&&(s=current())){
    var P=px(s);trace(ctx,P);
    ctx.lineWidth=4*k;ctx.strokeStyle="rgba(0,0,0,.6)";ctx.stroke();ctx.lineWidth=2.5*k;ctx.strokeStyle="#5ff0d6";ctx.stroke();
    P.forEach(function(p){dotAt(p,k,"#5ff0d6");});
  }
}
function dotAt(p,k,col){ctx.beginPath();ctx.arc(p[0],p[1],8*k,0,7);ctx.fillStyle=col;ctx.fill();ctx.lineWidth=2*k;ctx.strokeStyle="#10181a";ctx.stroke();}
function refresh(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;renderAfter();draw();save();});}

function current(){return surfaces.filter(function(s){return s.id===sel;})[0]||null;}
function addSurface(kind,pts,o){
  var n=surfaces.filter(function(s){return s.kind===kind;}).length+1;
  var s={id:nextId++,kind:kind,name:KIND[kind]+" "+n,pts:pts,rot:0,shade:.9,
    mat:kind==="dach"?"prefalz":"siding",color:"02",wm:kind==="dach"?10:9,hm:null,est:true};
  if(kind==="fassade"){s.trim={style:"rahmen",sill:true,color:null};s.wins=[];}
  if(o)for(var key in o)s[key]=o[key];
  surfaces.push(s);return s;
}
function startDraw(kind){
  var target=kind==="fenster"?sel:null;
  adjust=false;sel=null;error="";autoNote=false;
  drawing={target:target,kind:kind,pts:[],auto:kind!=="cut"&&!!SEG&&!SEG.blocked(),taps:[],sub:false,cands:[],pick:0,picked:false,busy:false,miss:false,ticket:0};
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
  var first=d.taps.length===1&&d.taps[0].add&&(d.kind==="fassade"||d.kind==="dach")&&SEG.surface;
  Promise.all([SEG.masks(d.taps.slice(),{raw:d.kind==="fenster"}),
    first?SEG.surface(d.kind==="dach"?1:2,d.taps[0]).catch(function(){return null;}):Promise.resolve(null)]).then(function(r){
    var c=r[0],mc=r[1];
    if(drawing!==d||d.ticket!==ticket)return;
    /* Hat das Flächenmodell an der Tippstelle die gewünschte Fläche gefunden, steht sie an erster Stelle. */
    if(mc){c=c.concat([mc]).sort(function(a,b){return a.share-b.share;});}
    d.busy=false;d.cands=c;d.miss=!c.length;
    if(!d.picked||d.pick>=c.length){
      /* Standard: die kleinste Fläche, die kein Detail ist (also das Bauteil, nicht das ganze Haus). */
      d.pick=0;
      if(d.kind==="fenster"){
        /* Fenster: die größte Fläche, die noch Fenstergröße hat (Glas samt Rahmen, nicht die ganze Wand). */
        for(var i=0;i<c.length;i++)if(winFits(d,c[i].mb))d.pick=i;
      }else{
        /* Standard: die größte Fläche, also alle Wände (oder Dachflächen) des Hauses in der angetippten Farbe.
           Ausgenommen Kandidaten, die fast das ganze Bild füllen oder farblich kaum passen. */
        var best=-1,top=0,i2;
        for(i2=0;i2<c.length;i2++)top=Math.max(top,c[i2].sim);
        /* Dach: nur Kandidaten, die farblich so sauber sind wie der beste (sonst rutscht eine gleichfarbige Wand mit hinein). */
        for(i2=0;i2<c.length;i2++)if(c[i2].whole<=.62&&c[i2].sim>=(d.kind==="dach"?Math.max(.1,top-.025):.1))best=i2;
        for(i2=0;i2<c.length;i2++)if(c[i2].model)best=i2;
        if(best<0)for(i2=0;i2<c.length;i2++)if(c[i2].share>=.015){best=i2;break;}
        d.pick=Math.max(0,best);
      }
    }
    ui();draw();
  }).catch(function(){autoFailed(d);});
}
/* Alle Fenster der Fassade automatisch suchen. Ersetzt die bisherige Liste nur, wenn etwas gefunden wurde. */
var scanning=null;
/* Treffer des Fenstermodells auf die markierte Wand beschränken und aufräumen:
   - Doppeltreffer (stark überlappend) zusammenlegen, der sicherere bleibt.
   - Nur Rechtecke, die überwiegend an Wand grenzen (nicht an Himmel, Nachbarhaus oder Garten).
   - Was bis zum unteren Rand der Wand reicht, ist eine Tür oder ein Tor: Verkleidung ohne Fensterbank. */
function modelWindows(boxes,wall){
  var w=Math.max(8,Math.round(W/4)),h=Math.max(8,Math.round(H/4)),c=mk(w,h),g=c.getContext("2d");g.drawImage(wall,0,0,w,h);
  var d=g.getImageData(0,0,w,h).data,M=new Uint8Array(w*h),i,x,y,bottom=new Int32Array(w).fill(-1);
  var wx0=w,wy0=h,wx1=-1,wy1=-1,wn=0;
  for(i=0;i<w*h;i++)if(d[i*4+3]>127){M[i]=1;wn++;x=i%w;y=(i-x)/w;if(y>bottom[x])bottom[x]=y;if(x<wx0)wx0=x;if(x>wx1)wx1=x;if(y<wy0)wy0=y;if(y>wy1)wy1=y;}
  var keep=[],WW=Math.max(1,wx1-wx0+1),WH=Math.max(1,wy1-wy0+1);
  boxes.forEach(function(b){
    if(keep.some(function(k){
      var ix=Math.max(0,Math.min(b.x1,k.x1)-Math.max(b.x0,k.x0)),iy=Math.max(0,Math.min(b.y1,k.y1)-Math.max(b.y0,k.y0));
      return ix*iy>.35*Math.min((b.x1-b.x0)*(b.y1-b.y0),(k.x1-k.x0)*(k.y1-k.y0));
    }))return;
    var X0=Math.floor(b.x0*w),X1=Math.ceil(b.x1*w),Y0=Math.floor(b.y0*h),Y1=Math.ceil(b.y1*h);
    /* Kein Fenster ist so groß wie ein guter Teil der Wand: das wären Erker, Giebelfelder oder Fehltreffer. */
    if(b.cls!==1&&(X1-X0>.45*WW||Y1-Y0>.6*WH||(X1-X0)*(Y1-Y0)>.4*wn))return;
    var pad=Math.max(1,Math.round(.25*Math.min(X1-X0,Y1-Y0)));
    var ring=0,n=0;
    for(y=Math.max(0,Y0-pad);y<Math.min(h,Y1+pad);y++)for(x=Math.max(0,X0-pad);x<Math.min(w,X1+pad);x++){
      if(x>=X0&&x<X1&&y>=Y0&&y<Y1)continue;n++;ring+=M[y*w+x];
    }
    if(!n||ring/n<.35)return;
    var cx=Math.min(w-1,Math.max(0,Math.round((b.x0+b.x1)/2*w))),low=bottom[cx]>=0&&Y1>=bottom[cx]-Math.max(1,Math.round(.03*h));
    keep.push({x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1,door:b.cls===1||low,score:b.score});
  });
  return keep.map(function(k){var o={x0:k.x0,y0:k.y0,x1:k.x1,y1:k.y1};if(k.door)o.door=true;return o;});
}
function findWindows(s){
  if(!SEG||SEG.blocked()||scanning)return;
  var wall=MASKS[s.id];
  if(!wall){wall=mk(Math.max(8,Math.round(W/4)),Math.max(8,Math.round(H/4)));var g=wall.getContext("2d");
    g.beginPath();s.pts.forEach(function(p,i){i?g.lineTo(p.x*wall.width,p.y*wall.height):g.moveTo(p.x*wall.width,p.y*wall.height);});g.closePath();g.fill();}
  var image=src;scanning={id:s.id,pct:0};SEG.prepare(src);uiStatus();
  /* Zuerst das eigene Fenstermodell (ein Durchgang, Sekundenbruchteil); fehlt es, die Suche mit Probe-Tipps. */
  var viaModel=SEG.windows?SEG.windows(.3).then(function(b){var k=modelWindows(b,wall);if(!k.length)throw new Error("leer");return k;}):Promise.reject();
  viaModel.catch(function(){
    return SEG.scan(wall,function(i,n){if(scanning){scanning.pct=Math.round(i/n*100);uiStatus();}},window.__scanDbg,!MASKS[s.id]);
  }).then(function(boxes){
    scanning=null;
    if(image!==src||surfaces.indexOf(s)<0){uiStatus();return;}
    /* Löcher in der Wandfläche bleiben; aus der Suche kommen Fenster dazu, die sich mit keinem davon überschneiden. */
    boxes.forEach(function(b){
      var hit=s.wins.some(function(w){
        var ix=Math.max(0,Math.min(b.x1,w.x1)-Math.max(b.x0,w.x0)),iy=Math.max(0,Math.min(b.y1,w.y1)-Math.max(b.y0,w.y0));
        return ix*iy>.2*Math.min((b.x1-b.x0)*(b.y1-b.y0),(w.x1-w.x0)*(w.y1-w.y0));
      });
      if(!hit)s.wins.push(b);
    });
    if(s.wins.length){
      /* Maßstab: ohne bessere Angabe gilt ein Fenster als rund 1,1 m breit. */
      if(s.est){
        var ws=(s.wins.some(function(b){return !b.door;})?s.wins.filter(function(b){return !b.door;}):s.wins).map(function(b){return (b.x1-b.x0)*W;}).sort(function(a,b){return a-b;}),q=quadFor({rot:0},px(s));
        var est=((dist(q[0],q[1])+dist(q[3],q[2]))/2)/ws[ws.length>>1]*1.1;
        if(est>=2&&est<=40){s.wm=Math.round(est*2)/2;s.est="fenster";}
      }
    }else if(!s.wins.length){error="Es wurden keine Fenster gefunden. Mit „+ Fenster markieren“ fügst du sie von Hand hinzu.";}
    ui();error="";refresh();
  }).catch(function(){scanning=null;uiStatus();});
}
function winFits(d,b){
  var t=surfaces.filter(function(x){return x.id===d.target;})[0];if(!t)return true;
  var k=ppm(t),wm=(b[2]-b[0])*W/k,hm=(b[3]-b[1])*H/k;return wm>=.25&&wm<=3.5&&hm>=.25&&hm<=3.2;
}
/* Erkannte Fläche übernehmen: Kanten am Foto verfeinern, bei Fassaden Fenster vormerken und gründlich suchen. */
function addDetected(kind,c){
  var s=addSurface(kind,c.quad,{mb:c.mb});
  var fine=c.canvas;try{if(REF)fine=REF.refine(c.canvas,src);}catch(e){}
  MASKS[s.id]=fine;try{s.maskUrl=fine.toDataURL("image/png");}catch(e){}
  if(s.kind==="fassade"){
    /* Vorläufig: ganz von Wand umschlossene Öffnungen. Die gründliche Suche läuft gleich danach im Hintergrund. */
    var bw=(c.mb[2]-c.mb[0]),bh=(c.mb[3]-c.mb[1]);
    s.wins=(fine._holes||[]).filter(function(h){
      var ar=h.w*W/(h.h*H);return ar>.35&&ar<2.6&&h.w>=.03*bw&&h.w<=.3*bw&&h.h>=.04*bh&&h.h<=.5*bh;
    }).map(function(h){return {x0:h.x,y0:h.y,x1:h.x+h.w,y1:h.y+h.h};});
    findWindows(s);
  }
  return s;
}
/* Nach dem Laden eines Fotos: Fassade und Dach ohne Tipp markieren, wenn das Flächenmodell sie sicher findet. */
var autoTicket=0,autoRunning=false,autoNote=false;
function autoDetect(){
  if(!SEG||!SEG.surface||SEG.blocked())return;
  var t=++autoTicket,image=src;autoRunning=true;uiStatus();
  Promise.all([SEG.surface(2).catch(function(){return null;}),SEG.surface(1).catch(function(){return null;})]).then(function(r){
    autoRunning=false;
    if(t!==autoTicket||image!==src||surfaces.length||drawing){uiStatus();return;}
    var wall=r[0],roof=r[1],first=null;
    if(wall&&wall.share>=.03){first=addDetected("fassade",wall);}
    if(roof&&roof.share>=.012){var sr=addDetected("dach",roof);if(!first)first=sr;}
    if(first){sel=first.id;autoNote=true;}
    ui();refresh();
  });
}
function finishDraw(){
  var d=drawing;if(!d)return;
  if(d.kind==="fenster"){
    var t=surfaces.filter(function(x){return x.id===d.target;})[0],b;
    if(d.auto){var cc=d.cands[d.pick];if(!cc||d.busy)return;b=cc.mb;}
    else{if(d.pts.length<3)return;var bb=bbox(d.pts.map(function(p){return [p.x,p.y];}));b=bb;}
    if(!winFits(d,b)){error="Die markierte Fläche ist für ein Fenster zu groß oder zu klein. Tippe auf „Kleiner“ oder „Größer“, oder prüf die Breite der Fassade.";uiStatus();error="";return;}
    if(t){t.wins=t.wins||[];t.wins.push({x0:b[0],y0:b[1],x1:b[2],y1:b[3]});if(!t.trim)t.trim={style:"rahmen",sill:true,color:null};}
    sel=d.target;drawing=null;ui();refresh();return;
  }
  if(d.auto){
    var c=d.cands[d.pick];if(!c||d.busy)return;
    var s=addDetected(d.kind,c);
    sel=s.id;
  }else{
    if(d.pts.length<3)return;
    sel=addSurface(d.kind,d.pts).id;
  }
  drawing=null;adjust=false;ui();refresh();
}
function drawHint(){
  var d=drawing,what=d.kind==="dach"?"Dachfläche":"Wandfläche",st=SEG?SEG.state:{};
  if(d.kind==="cut")return "Tippe die Ecken von Fenster oder Tür an. Dort bleibt das Originalfoto sichtbar.";
  if(d.kind==="fenster"){
    if(!d.auto)return "Tippe drei oder vier Ecken des Fensters an, außen am Rahmen.";
    if(!d.taps.length)return "Tippe mitten auf das Fenster, das verkleidet werden soll.";
    if(d.busy)return "Das Fenster wird gesucht.";
    var cc=d.cands[d.pick];
    if(cc&&!winFits(d,cc.mb))return "Diese Fläche hat keine Fenstergröße. Tippe auf „Kleiner“ oder „Größer“.";
    return "Die gelbe Fläche sollte das ganze Fenster samt Rahmen umfassen. Ist sie zu klein, tippe auf „Größer“.";
  }
  if(!d.auto)return d.kind==="dach"?"Tippe die Ecken der Dachfläche der Reihe nach an: zuerst entlang der Traufe, dann am First. Vier Ecken ergeben die beste Perspektive."
    :"Tippe die Ecken der Wandfläche der Reihe nach an. Fenster und Türen sparst du danach aus.";
  var wait=st.phase==="laden"||st.phase==="analyse"?"Die Erkennung startet gerade. ":"";
  if(!d.taps.length)return wait+"Tippe mitten auf die "+what+".";
  if(wait)return wait+"Dein Tipp wird gleich ausgewertet.";
  if(d.busy)return "Die Fläche wird gesucht.";
  if(d.miss)return "Hier wurde keine Fläche gefunden. Tippe auf eine andere Stelle.";
  return "Passt die gelbe Fläche? Fehlt ein Teil, tippe darauf. Ist zu viel markiert, hilft „Kleiner“ oder „Wegnehmen“.";
}
function summary(){return surfaces.filter(function(s){return s.kind!=="cut";}).map(function(s){return s.name+": "+matName(s)+", "+colName(s.color);}).join("\n");}
function exportBlob(cb){renderAfter();after.toBlob(cb,"image/jpeg",.92);}

/* Zeigt, was die Maße ergeben, damit sich die Proportion am Haus nachprüfen lässt. */
function sizeInfo(s){
  var pr=prod(s),r=realSize(s),k=counts(pr,r.W*1000,r.H*1000),f=function(v){return v.toFixed(1).replace(".",",");},t;
  var size=f(r.W)+" × "+f(r.H)+" m";
  if(pr.pat==="seam")t=size+" ergibt "+Math.round(k.n)+" Bahnen nebeneinander.";
  else if(pr.pat==="hline")t=size+" ergibt rund "+Math.round(r.H*1000/((pr.mix?pr.mix.reduce(function(a,b){return a+b;},0)/pr.mix.length:pr.w)))+" Bahnen übereinander.";
  else if(pr.pat==="offset")t=size+" ergibt rund "+Math.round(k.n)+" × "+Math.round(k.m)+" Elemente.";
  else t=size+" ergibt rund "+Math.round(k.n)+" Rauten in der Breite.";
  if(s.est==="fenster")t="Breite aus der Fenstergröße geschätzt, bitte prüfen. "+t;
  else if(s.est)t="Breite geschätzt. Trag das echte Maß der markierten Fläche ein, dann stimmt die Größe der Elemente. "+t;
  $("size-info").textContent=t;
}
function winUi(s,pal){
  $("ed-win").hidden=s.kind!=="fassade";if(s.kind!=="fassade")return;
  if(!s.trim)s.trim={style:"rahmen",sill:true,color:null};if(!s.wins)s.wins=[];
  var t=s.trim,n=s.wins.length;
  $("scan-win").disabled=!!scanning;
  $("win-info").textContent=n?n+(n===1?" Fenster":" Fenster")+" verkleidet":"noch keines markiert";
  Array.prototype.forEach.call(document.querySelectorAll("#win-style button"),function(b){b.setAttribute("aria-pressed",b.dataset.style===t.style);});
  $("win-sill").checked=!!t.sill;
  var on=TRIM[t.style];$("win-opts").hidden=!on;
  var wc=$("win-colors"),l=wc.scrollLeft;wc.textContent="";
  var same=el("button","btn","Wie Fassade");same.type="button";same.setAttribute("aria-pressed",!t.color);
  same.onclick=function(){t.color=null;ui();refresh();};wc.appendChild(same);
  pal.forEach(function(code){
    var c=DATA.colors[code],b=el("button","sw");b.type="button";b.style.background=c.hex;b.title=code+" "+c.name;
    b.setAttribute("aria-label","Fensterfarbe "+code+" "+c.name);b.setAttribute("aria-pressed",code===t.color);
    b.onclick=function(){t.color=code;ui();refresh();};wc.appendChild(b);
  });
  wc.scrollLeft=l;
  $("win-color-name").textContent=t.color?colName(t.color):"wie Fassade";
  var list=$("win-list");list.textContent="";
  s.wins.forEach(function(w,i){
    var b=el("button","btn chip-x",(w.door?"Tür ":"Fenster ")+(i+1)+"  ✕");b.type="button";
    b.setAttribute("aria-label",(w.door?"Tür ":"Fenster ")+(i+1)+" entfernen");
    b.onclick=function(){s.wins.splice(i,1);ui();refresh();};list.appendChild(b);
  });
}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
function matName(s){return prod(s).name;}
function colName(code){var c=DATA.colors[code];return c?code+" "+c.name:"";}
function hintText(){
  if(error)return error;
  if(autoNote&&!drawing&&surfaces.length){
    var nw=0;surfaces.forEach(function(s){if(s.kind==="fassade"&&s.wins)nw+=s.wins.length;});
    return (scanning?"Fassade erkannt, Fenster werden gesucht. ":"Automatisch erkannt: "+surfaces.filter(function(s){return s.kind!=="cut";}).map(function(s){return s.kind==="dach"?"Dach":"Fassade";}).join(" und ")+(nw?" mit "+nw+" Fenster"+(nw===1?"":"n")+". ":". "))+"Wähle Produkt und Farbe. Fehlt ein Fenster, tippe auf „+ Fenster markieren“.";
  }
  if(drawing)return drawHint();
  var s=current();
  if(adjust&&s)return MASKS[s.id]?"Zieh die Eckpunkte, um das Muster auszurichten. Die Fläche selbst bleibt gleich.":"Zieh die Eckpunkte an die Ecken der Fläche.";
  if(!surfaces.length)return "Was soll neu werden? Tippe auf „+ Fassade“ oder „+ Dach“.";
  if(isSample)return "Beispiel zum Ausprobieren. Zieh die Linie im Bild für Vorher und Nachher. Mit „Foto wählen“ nimmst du dein eigenes Haus.";
  return "Zieh die Linie im Bild für Vorher und Nachher. Zoomen geht mit zwei Fingern, Mausrad oder den Knöpfen im Bild.";
}
/* Leichte Aktualisierung: Status, Hinweis und Knöpfe. Läuft auch bei jedem Fortschrittsschritt der Erkennung. */
function uiStatus(){
  var D=drawing,A=D&&D.auto,st=SEG?SEG.state:{},t="",pct=-1;
  $("p-draw").hidden=!D;$("p-main").hidden=!!D;
  cv.className=D||adjust?"edit":"";
  $("l-before").hidden=$("l-after").hidden=$("split").hidden=!slider();
  $("split").value=Math.round(split*100);
  $("z-in").disabled=Z.z>=6;$("z-out").disabled=$("z-fit").disabled=Z.z<=1;
  if(D){
    $("d-done").disabled=A?!D.cands[D.pick]||D.busy:D.pts.length<3;
    $("d-undo").disabled=!(A?D.taps.length:D.pts.length);
    $("methods").hidden=D.kind==="cut";$("autobar").hidden=!(A&&D.taps.length);
    $("m-auto").setAttribute("aria-pressed",!!A);$("m-manual").setAttribute("aria-pressed",!A);
    $("pt-add").setAttribute("aria-pressed",!D.sub);$("pt-sub").setAttribute("aria-pressed",!!D.sub);
    $("sz-less").disabled=D.busy||D.pick<=0;$("sz-more").disabled=D.busy||D.pick>=D.cands.length-1;
  }
  if(st.phase==="laden"){t="Erkennung wird geladen, einmalig rund 50 MB";pct=st.progress;}
  else if(st.phase==="analyse")t="Foto wird analysiert";
  else if(D&&D.busy)t="Fläche wird gesucht";
  else if(scanning){t="Fenster werden gesucht";pct=scanning.pct;}
  else if(autoRunning&&!surfaces.length)t="Fassade und Dach werden erkannt";
  $("busy").hidden=!t;$("busy-text").textContent=t+(pct>=0?": "+pct+" %":"");
  $("busy-bar").style.width=pct>=0?pct+"%":"";$("busy-bar").className=pct>=0?"":"run";
  $("save").disabled=$("share").disabled=!surfaces.length;
  $("adjust").setAttribute("aria-pressed",adjust);
  $("add-fassade").classList.toggle("primary",!surfaces.length);$("add-dach").classList.toggle("primary",!surfaces.length);
  $("hint").textContent=hintText();
}
function ui(){
  uiStatus();save();
  var chips=$("chips");chips.textContent="";
  surfaces.forEach(function(s){
    var b=el("button","btn");b.type="button";b.setAttribute("aria-pressed",s.id===sel);
    if(s.kind!=="cut"){var d=el("span","dot");d.style.background=hex(s.color);b.appendChild(d);}
    b.appendChild(document.createTextNode(s.name));
    b.onclick=function(){sel=s.id;adjust=false;ui();draw();};chips.appendChild(b);
  });
  var s=current();$("editor").hidden=!s;if(!s)return;
  $("ed-style").hidden=s.kind==="cut";
  if(s.kind==="cut")return;
  var mats=$("mats"),cols=$("colors"),ml=mats.scrollLeft,cl=cols.scrollLeft;
  mats.textContent="";
  var pr=prod(s),pal=DATA.palettes[pr.pal];
  DATA.products.filter(function(m){return m.kind===s.kind;}).forEach(function(m){
    var b=el("button","btn",m.name);b.type="button";b.setAttribute("aria-pressed",m.id===s.mat);
    b.onclick=function(){s.mat=m.id;if(DATA.palettes[m.pal].indexOf(s.color)<0)s.color=DATA.palettes[m.pal][0];if(split>.85)split=.5;ui();refresh();};
    mats.appendChild(b);
  });
  $("mat-info").textContent=pr.info;
  cols.textContent="";
  pal.forEach(function(code){
    var c=DATA.colors[code],b=el("button","sw");b.type="button";b.style.background=c.hex;b.title=code+" "+c.name;
    b.setAttribute("aria-label",code+" "+c.name);b.setAttribute("aria-pressed",code===s.color);
    b.onclick=function(){s.color=code;if(split>.85)split=.5;ui();refresh();};cols.appendChild(b);
  });
  mats.scrollLeft=ml;cols.scrollLeft=cl;
  winUi(s,pal);
  var cur=DATA.colors[s.color];
  $("color-name").textContent=colName(s.color)+(cur?" · ähnlich RAL "+cur.ral:"");
  if(document.activeElement!==$("wm"))$("wm").value=s.wm;
  if(document.activeElement!==$("hm"))$("hm").value=s.hm||"";
  sizeInfo(s);
  $("shade").value=Math.round(s.shade*100);
}

function pos(e){var r=cv.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height)),r:r};}
function inPoly(p,pts){var c=false;for(var i=0,j=pts.length-1;i<pts.length;j=i++){var a=pts[i],b=pts[j];
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c;}return c;}
function near(p,q,r,lim){return Math.hypot((p.x-q.x)*r.width,(p.y-q.y)*r.height)<lim;}
/* Zoom: die Leinwand wird per CSS skaliert und verschoben, der Rahmen schneidet ab.
   pos() rechnet über getBoundingClientRect und stimmt dadurch auch im Zoom. */
function applyZoom(){
  var w=cv.offsetWidth,h=cv.offsetHeight;
  Z.z=Math.max(1,Math.min(6,Z.z));
  if(Z.z<=1.001){Z.z=1;Z.tx=0;Z.ty=0;}
  Z.tx=Math.min(0,Math.max(w-w*Z.z,Z.tx));Z.ty=Math.min(0,Math.max(h-h*Z.z,Z.ty));
  cv.style.transform=Z.z===1?"":"translate("+Z.tx+"px,"+Z.ty+"px) scale("+Z.z+")";
  view.classList.toggle("zoomed",Z.z>1);
  $("z-in").disabled=Z.z>=6;$("z-out").disabled=$("z-fit").disabled=Z.z<=1;
  draw();
}
function zoomAt(f,cx,cy){
  var vr=view.getBoundingClientRect(),px=cx-vr.left,py=cy-vr.top,nz=Math.max(1,Math.min(6,Z.z*f));
  f=nz/Z.z;Z.tx=px-(px-Z.tx)*f;Z.ty=py-(py-Z.ty)*f;Z.z=nz;applyZoom();
}
function zoomStep(f){var vr=view.getBoundingClientRect();zoomAt(f,vr.left+vr.width/2,vr.top+vr.height/2);}
function resetZoom(){Z.z=1;Z.tx=0;Z.ty=0;applyZoom();}
function hitSurface(p){
  return surfaces.filter(function(x){return x.kind!=="cut";}).reverse().filter(function(x){return inPoly(p,x.pts);})[0];
}
function tapAt(e){
  var p=pos(e);
  if(drawing){
    if(drawing.auto){drawing.taps.push({x:p.x,y:p.y,add:!drawing.sub});runDetect();return;}
    if(drawing.pts.length>=3&&near(p,drawing.pts[0],p.r,20)){finishDraw();return;}
    drawing.pts.push({x:p.x,y:p.y});ui();draw();return;
  }
  var now=Date.now();
  /* Doppeltipp: hineinzoomen, im Zoom zurück aufs ganze Bild. */
  if(lastTap&&now-lastTap.t<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<30){
    lastTap=null;if(Z.z>1)resetZoom();else zoomAt(2.5,e.clientX,e.clientY);return;
  }
  lastTap={t:now,x:e.clientX,y:e.clientY};
  var hit=hitSurface(p);
  if(hit&&hit.id!==sel){sel=hit.id;adjust=false;ui();draw();}
}
function setSplit(cx){var r=cv.getBoundingClientRect();split=Math.min(1,Math.max(0,(cx-r.left)/r.width));$("split").value=Math.round(split*100);draw();}
/* Gesten: zwei Finger zoomen und verschieben. Ein Finger zieht den Regler, eine Ecke oder (im Zoom) das Bild.
   Ein Tipp ohne Bewegung markiert beziehungsweise wählt eine Fläche. */
cv.addEventListener("pointerdown",function(e){
  if(e.pointerType==="mouse"&&e.button!==0)return;
  ptrs[e.pointerId]={x:e.clientX,y:e.clientY};
  try{cv.setPointerCapture(e.pointerId);}catch(_){}
  var ids=Object.keys(ptrs);
  if(ids.length===2){
    var a=ptrs[ids[0]],b=ptrs[ids[1]];
    gest={type:"pinch",d:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};
    drag=null;e.preventDefault();return;
  }
  if(ids.length>2)return;
  var p=pos(e),s=current();
  gest={type:"tap",x0:e.clientX,y0:e.clientY,lx:e.clientX,ly:e.clientY};
  if(adjust&&s)for(var i=0;i<s.pts.length;i++)if(near(p,s.pts[i],p.r,26)){gest.type="corner";drag={s:s,i:i};e.preventDefault();return;}
  if(slider()&&Math.abs(e.clientX-(p.r.left+split*p.r.width))<28){gest.type="split";e.preventDefault();return;}
  if(drawing||adjust||Z.z>1)e.preventDefault();
});
cv.addEventListener("pointermove",function(e){
  if(!ptrs[e.pointerId])return;
  ptrs[e.pointerId]={x:e.clientX,y:e.clientY};
  var g=gest;if(!g)return;
  if(g.type==="pinch"){
    var ids=Object.keys(ptrs);if(ids.length<2)return;
    var a=ptrs[ids[0]],b=ptrs[ids[1]],d=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    Z.tx+=cx-g.cx;Z.ty+=cy-g.cy;zoomAt(d/g.d,cx,cy);
    g.d=d;g.cx=cx;g.cy=cy;return;
  }
  if(g.type==="tap"&&Math.hypot(e.clientX-g.x0,e.clientY-g.y0)>8){
    g.type=Z.z>1?"pan":slider()?"split":"none";
  }
  if(g.type==="corner"){var p=pos(e);drag.s.pts[drag.i]={x:p.x,y:p.y};refresh();}
  else if(g.type==="split")setSplit(e.clientX);
  else if(g.type==="pan"){Z.tx+=e.clientX-g.lx;Z.ty+=e.clientY-g.ly;applyZoom();}
  g.lx=e.clientX;g.ly=e.clientY;
});
function pointerEnd(e,cancel){
  if(!ptrs[e.pointerId])return;
  delete ptrs[e.pointerId];
  var g=gest,left=Object.keys(ptrs).length;
  if(g&&g.type==="pinch"){gest=left?{type:"none"}:null;return;}
  if(left)return;
  gest=null;drag=null;
  if(!cancel&&g&&g.type==="tap")tapAt(e);
}
cv.addEventListener("pointerup",function(e){pointerEnd(e,false);});
cv.addEventListener("pointercancel",function(e){pointerEnd(e,true);});
/* Mausrad und Trackpad: Rad oder Zusammenziehen zoomt, Wischen auf dem Trackpad verschiebt im Zoom. */
view.addEventListener("wheel",function(e){
  var wheel=e.deltaMode!==0||(Math.abs(e.deltaY)>=50&&e.deltaX===0&&Number.isInteger(e.deltaY));
  if(e.ctrlKey||wheel){e.preventDefault();zoomAt(Math.exp(-e.deltaY*(e.ctrlKey?.012:.0018)*(e.deltaMode===1?33:1)),e.clientX,e.clientY);}
  else if(Z.z>1){e.preventDefault();Z.tx-=e.deltaX;Z.ty-=e.deltaY;applyZoom();}
},{passive:false});
["gesturestart","gesturechange"].forEach(function(t){view.addEventListener(t,function(e){e.preventDefault();});});
$("z-in").onclick=function(){zoomStep(1.6);};
$("z-out").onclick=function(){zoomStep(1/1.6);};
$("z-fit").onclick=resetZoom;
$("split").oninput=function(){split=this.value/100;draw();};

$("add-dach").onclick=function(){startDraw("dach");};
$("add-fassade").onclick=function(){startDraw("fassade");};
$("add-cut").onclick=function(){startDraw("cut");};
$("d-done").onclick=finishDraw;
$("d-undo").onclick=function(){
  if(!drawing)return;
  if(drawing.auto){drawing.taps.pop();runDetect();}else{drawing.pts.pop();ui();draw();}
};
$("pt-add").onclick=function(){if(drawing){drawing.sub=false;uiStatus();}};
$("pt-sub").onclick=function(){if(drawing){drawing.sub=true;uiStatus();}};
function step(n){var d=drawing;if(!d||!d.cands.length)return;d.pick=Math.max(0,Math.min(d.cands.length-1,d.pick+n));d.picked=true;uiStatus();draw();}
$("sz-less").onclick=function(){step(-1);};
$("sz-more").onclick=function(){step(1);};
if(SEG)SEG.onChange(function(st){
  if(st.phase==="fehler"&&drawing&&drawing.auto){autoFailed(drawing);return;}
  uiStatus();
});
function cancelDraw(){if(drawing&&drawing.target)sel=drawing.target;drawing=null;ui();draw();}
$("d-cancel").onclick=cancelDraw;
$("m-auto").onclick=function(){setMethod(true);};
$("m-manual").onclick=function(){setMethod(false);};
$("adjust").onclick=function(){adjust=!adjust;uiStatus();draw();};
document.addEventListener("keydown",function(e){
  if(e.key==="Escape"){if(drawing)cancelDraw();else if(adjust){adjust=false;uiStatus();draw();}}
  else if(e.key==="Enter"&&drawing&&!$("d-done").disabled&&!/^(BUTTON|INPUT|SUMMARY)$/.test(document.activeElement.tagName))finishDraw();
  else if(!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)&&!e.ctrlKey&&!e.metaKey){
    if(e.key==="+"||e.key==="=")zoomStep(1.6);else if(e.key==="-")zoomStep(1/1.6);else if(e.key==="0")resetZoom();
  }
});
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
function num(el){var v=parseFloat(String(el.value).replace(",","."));return v>=1&&v<=80?v:null;}
$("wm").oninput=function(){var s=current(),v=num(this);if(s&&v){s.wm=v;s.est=false;sizeInfo(s);refresh();}};
$("hm").oninput=function(){var s=current();if(!s)return;s.hm=num(this);sizeInfo(s);refresh();};
$("shade").oninput=function(){var s=current();if(s){s.shade=this.value/100;refresh();}};
Array.prototype.forEach.call(document.querySelectorAll("#win-style button"),function(b){
  b.onclick=function(){var s=current();if(s&&s.trim){s.trim.style=b.dataset.style;ui();refresh();}};
});
$("win-sill").onchange=function(){var s=current();if(s&&s.trim){s.trim.sill=this.checked;refresh();}};
$("scan-win").onclick=function(){var s=current();if(s&&s.kind==="fassade")findWindows(s);};
$("add-win").onclick=function(){var s=current();if(s&&s.kind==="fassade")startDraw("fenster");};
$("rot").onclick=function(){var s=current();if(s){s.rot=((s.rot||0)+1)%4;sizeInfo(s);refresh();}};
$("del").onclick=function(){delete MASKS[sel];delete SHADES[sel];delete EDGES[sel];surfaces=surfaces.filter(function(s){return s.id!==sel;});
  sel=surfaces.length?surfaces[surfaces.length-1].id:null;adjust=false;ui();refresh();};
$("btn-sample").onclick=function(){try{localStorage.removeItem("hausprobe.photo");}catch(e){}loadSample();};
/* Foto laden: aus der Auswahl, per Ziehen auf die Seite oder aus der Zwischenablage. */
function loadFile(f){
  if(!f)return;
  var url=URL.createObjectURL(f),img=new Image();
  img.onload=function(){
    var sc=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    var c=mk(Math.max(1,Math.round(img.naturalWidth*sc)),Math.max(1,Math.round(img.naturalHeight*sc)));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
    setImage(c);isSample=false;storePhoto(c);surfaces=[];nextId=1;sel=null;drawing=null;split=.5;adjust=false;$("badge").hidden=true;
    /* Die Analyse startet sofort im Hintergrund, damit der erste Tipp nicht warten muss. */
    if(SEG&&!SEG.blocked()){SEG.prepare(src);autoNote=false;autoDetect();}
    renderAfter();ui();draw();window.scrollTo(0,0);
  };
  img.onerror=function(){URL.revokeObjectURL(url);error="Dieses Bild lässt sich nicht öffnen. Wähle ein JPG oder PNG.";uiStatus();error="";};
  img.src=url;
}
$("file").onchange=function(){var f=this.files&&this.files[0];this.value="";loadFile(f);};
document.addEventListener("dragover",function(e){e.preventDefault();});
document.addEventListener("drop",function(e){
  e.preventDefault();var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
  if(f&&/^image\//.test(f.type))loadFile(f);
});
document.addEventListener("paste",function(e){
  var f=e.clipboardData&&e.clipboardData.files&&e.clipboardData.files[0];
  if(f&&/^image\//.test(f.type))loadFile(f);
});

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
  setImage(sampleHouse());isSample=true;surfaces=[];nextId=1;drawing=null;split=.5;adjust=false;$("badge").hidden=false;
  function n(a){return a.map(function(p){return {x:p[0]/1200,y:p[1]/800};});}
  function r(x0,y0,x1,y1){return n([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);}
  var roof=addSurface("dach",n([[300,410],[900,410],[840,230],[360,230]]),{wm:10.5,hm:5.5,est:false});
  addSurface("fassade",r(330,412,870,650),{color:"10",wm:9.5,hm:4.2,est:false,
    wins:[{x0:394/1200,y0:454/800,x1:506/1200,y1:566/800},{x0:694/1200,y0:454/800,x1:806/1200,y1:566/800},{x0:554/1200,y0:494/800,x1:646/1200,y1:650/800,door:true}],
    trim:{style:"rahmen",sill:true,color:"02"}});
  addSurface("cut",r(394,454,506,566));addSurface("cut",r(694,454,806,566));addSurface("cut",r(554,494,646,650));
  sel=roof.id;renderAfter();ui();draw();
}
function save(){
  clearTimeout(saveT);saveT=setTimeout(function(){
    try{localStorage.setItem("hausprobe.state",JSON.stringify({v:6,sample:isSample,surfaces:surfaces,nextId:nextId}));}catch(e){}
  },300);
}
function storePhoto(c){
  try{localStorage.setItem("hausprobe.photo",c.toDataURL("image/jpeg",.85));}
  catch(e){try{localStorage.removeItem("hausprobe.photo");}catch(e2){}}
}
function applyState(st){
  surfaces=st.surfaces;nextId=st.nextId||surfaces.length+1;sel=surfaces.length?surfaces[0].id:null;
  drawing=null;adjust=false;renderAfter();ui();draw();
  surfaces.forEach(function(s){
    if(!s.maskUrl)return;
    var img=new Image();
    img.onload=function(){var c=mk(img.naturalWidth,img.naturalHeight);c.getContext("2d").drawImage(img,0,0);MASKS[s.id]=c;delete SHADES[s.id];delete EDGES[s.id];refresh();};
    img.src=s.maskUrl;
  });
}
function restore(){
  var st=null,ph=null;
  try{st=JSON.parse(localStorage.getItem("hausprobe.state")||"null");ph=localStorage.getItem("hausprobe.photo");}catch(e){}
  loadSample();
  if(!st||st.v!==6||!Array.isArray(st.surfaces))return;
  if(st.sample){applyState(st);return;}
  if(!ph)return;
  var img=new Image();
  img.onload=function(){var c=mk(img.naturalWidth,img.naturalHeight);c.getContext("2d").drawImage(img,0,0);setImage(c);isSample=false;$("badge").hidden=true;applyState(st);};
  img.src=ph;
}
restore();
window.addEventListener("resize",applyZoom);
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(function(){});
})();
