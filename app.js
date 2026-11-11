(function(){
"use strict";
var MATS={
  dach:[{id:"stehfalz",name:"Stehfalz"},{id:"raute",name:"Rauten"},{id:"platte",name:"Dachplatten"},{id:"schindel",name:"Schindeln"}],
  fassade:[{id:"siding",name:"Sidings waagrecht"},{id:"stehfalz",name:"Paneele senkrecht"},{id:"raute",name:"Rauten"},{id:"glatt",name:"Glatt"}]
};
var COLORS=[
  {name:"Anthrazit",hex:"#3b4045"},{name:"Schwarz",hex:"#222325"},{name:"Steingrau",hex:"#7d8386"},
  {name:"Hellgrau",hex:"#aeb3b5"},{name:"Silber",hex:"#c9cccd"},{name:"Reinweiß",hex:"#f0efea"},
  {name:"Ziegelrot",hex:"#8e3b2c"},{name:"Oxidrot",hex:"#6a2a23"},{name:"Nussbraun",hex:"#5a4333"},
  {name:"Bronze",hex:"#7c5e3c"},{name:"Sandbraun",hex:"#a59173"},{name:"Moosgrün",hex:"#3f5a46"}
];
var KIND={dach:"Dach",fassade:"Fassade",cut:"Aussparung"};
var $=function(id){return document.getElementById(id);};
var cv=$("cv"),ctx=cv.getContext("2d");
var W=1200,H=800,src=null,gray=null,after=document.createElement("canvas");
var tmp=document.createElement("canvas"),probe=document.createElement("canvas");probe.width=probe.height=12;
var surfaces=[],sel=null,mode="view",split=.5,drawing=null,drag=null,dragSplit=false,nextId=1,pending=false,error="",small=null,isSample=true,saveT=0;

function mk(w,h){var c=document.createElement("canvas");c.width=w;c.height=h;return c;}
function px(s){return s.pts.map(function(p){return [p.x*W,p.y*H];});}
function trace(c,P){c.beginPath();P.forEach(function(p,i){i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);});c.closePath();}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function bbox(P){var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;P.forEach(function(p){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);});return [x0,y0,x1,y1];}

function setImage(c){
  src=c;W=c.width;H=c.height;cv.width=W;cv.height=H;after.width=W;after.height=H;
  gray=mk(W,H);var g=gray.getContext("2d");g.drawImage(src,0,0);
  var im=g.getImageData(0,0,W,H),d=im.data;
  for(var i=0;i<d.length;i+=4){var l=(d[i]*.299+d[i+1]*.587+d[i+2]*.114)|0;d[i]=d[i+1]=d[i+2]=l;}
  g.putImageData(im,0,0);
  var sc=Math.min(1,256/Math.max(W,H)),sw=Math.max(8,Math.round(W*sc)),sh=Math.max(8,Math.round(H*sc)),sm=mk(sw,sh),sx=sm.getContext("2d");
  sx.drawImage(src,0,0,sw,sh);small={data:sx.getImageData(0,0,sw,sh).data,w:sw,h:sh};
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
function patternLines(mat,n,ratio){
  var L=[],i,j,m,c;
  if(mat==="stehfalz"){for(i=1;i<n;i++)L.push([i/n,0,i/n,1]);}
  else if(mat==="siding"){for(j=1;j<n;j++)L.push([0,j/n,1,j/n]);}
  else if(mat==="platte"||mat==="schindel"){
    if(mat==="schindel")n=Math.round(n*1.6);
    m=Math.max(1,Math.round(n*ratio*(mat==="schindel"?1.75:1.4)));
    for(j=0;j<m;j++){
      if(j)L.push([0,j/m,1,j/m]);
      for(i=0;i<=n;i++){var u=(i+(j%2)*.5)/n;if(u>0&&u<1)L.push([u,j/m,u,(j+1)/m]);}
    }
  }else if(mat==="raute"){
    m=Math.max(1,Math.round(n*ratio));
    for(c=1;c<n+m;c++)L.push([(c-Math.min(c,m))/n,Math.min(c,m)/m,Math.min(c,n)/n,(c-Math.min(c,n))/m]);
    for(c=-(m-1);c<n;c++){var a=Math.max(c,0),b=Math.min(n,m+c);L.push([a/n,(a-c)/m,b/n,(b-c)/m]);}
  }
  return L;
}
function paint(c,s){
  var P=px(s),q=quadFor(s,P),map=homography(q),b=bbox(P);
  c.save();trace(c,P);c.clip();
  c.fillStyle=s.color;c.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);
  var t=[(q[0][0]+q[1][0])/2,(q[0][1]+q[1][1])/2],e=[(q[3][0]+q[2][0])/2,(q[3][1]+q[2][1])/2];
  var gr=c.createLinearGradient(t[0],t[1],e[0],e[1]);gr.addColorStop(0,"rgba(255,255,255,.10)");gr.addColorStop(1,"rgba(0,0,0,.12)");
  c.fillStyle=gr;c.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);
  var wq=(dist(q[0],q[1])+dist(q[3],q[2]))/2,hq=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
  var lines=patternLines(s.mat,s.scale,hq/Math.max(1,wq));
  if(lines.length){
    var path=new Path2D();
    lines.forEach(function(l){var A=map(l[0],l[1]),B=map(l[2],l[3]);path.moveTo(A[0],A[1]);path.lineTo(B[0],B[1]);});
    var lw=Math.max(1,W/850);c.lineWidth=lw;
    c.save();c.translate(lw*.9,lw*.9);c.strokeStyle="rgba(255,255,255,.20)";c.stroke(path);c.restore();
    c.strokeStyle="rgba(0,0,0,.42)";c.stroke(path);
  }
  /* Carry the photo's own light and shadow over the new material. */
  var bx=Math.max(0,Math.floor(b[0])),by=Math.max(0,Math.floor(b[1])),bw=Math.min(W,Math.ceil(b[2]))-bx,bh=Math.min(H,Math.ceil(b[3]))-by;
  if(s.shade>0&&bw>2&&bh>2){
    var pc=probe.getContext("2d");pc.drawImage(gray,bx,by,bw,bh,0,0,12,12);
    var d=pc.getImageData(0,0,12,12).data,sum=0;for(var i=0;i<d.length;i+=4)sum+=d[i];
    var m=sum/(d.length/4)/255;
    tmp.width=bw;tmp.height=bh;var tc=tmp.getContext("2d");tc.drawImage(gray,bx,by,bw,bh,0,0,bw,bh);
    if(m<.5){tc.fillStyle="rgba(255,255,255,"+((.5-m)/(1-m))+")";}else{tc.fillStyle="rgba(0,0,0,"+((m-.5)/Math.max(m,.01))+")";}
    tc.fillRect(0,0,bw,bh);
    c.globalCompositeOperation="hard-light";c.globalAlpha=s.shade;c.drawImage(tmp,bx,by);
    c.globalCompositeOperation="source-over";c.globalAlpha=1;
  }
  c.restore();
  trace(c,P);c.lineWidth=Math.max(1,W/900);c.strokeStyle="rgba(0,0,0,.35)";c.stroke();
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
  if(drawing){
    var D=drawing.pts.map(function(p){return [p.x*W,p.y*H];});
    if(D.length>1){ctx.beginPath();D.forEach(function(p,i){i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);});if(drawing.auto)ctx.closePath();
      ctx.lineWidth=4*k;ctx.strokeStyle="rgba(0,0,0,.6)";ctx.stroke();ctx.lineWidth=2.5*k;ctx.strokeStyle="#ffd84d";ctx.stroke();
      if(drawing.auto){ctx.fillStyle="rgba(255,216,77,.22)";ctx.fill();}}
    (drawing.holes||[]).forEach(function(hp){trace(ctx,hp.map(function(p){return [p.x*W,p.y*H];}));
      ctx.lineWidth=2*k;ctx.strokeStyle="#fff";ctx.setLineDash([5*k,4*k]);ctx.stroke();ctx.setLineDash([]);});
    D.forEach(function(p){dotAt(p,k,"#ffd84d");});
    if(drawing.seed){ctx.beginPath();ctx.arc(drawing.seed.x*W,drawing.seed.y*H,4*k,0,7);ctx.fillStyle="#fff";ctx.fill();ctx.lineWidth=1.5*k;ctx.strokeStyle="#10181a";ctx.stroke();}
  }
}
function dotAt(p,k,col){ctx.beginPath();ctx.arc(p[0],p[1],8*k,0,7);ctx.fillStyle=col;ctx.fill();ctx.lineWidth=2*k;ctx.strokeStyle="#10181a";ctx.stroke();}
function refresh(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;renderAfter();draw();save();});}

function current(){return surfaces.filter(function(s){return s.id===sel;})[0]||null;}
function addSurface(kind,pts,o){
  var n=surfaces.filter(function(s){return s.kind===kind;}).length+1;
  var s={id:nextId++,kind:kind,name:KIND[kind]+" "+n,pts:pts,rot:0,shade:.55,
    mat:kind==="dach"?"stehfalz":"siding",color:kind==="dach"?COLORS[0].hex:COLORS[3].hex,scale:kind==="dach"?24:22};
  if(o)for(var key in o)s[key]=o[key];
  surfaces.push(s);return s;
}
function startDraw(kind){mode="edit";drawing={kind:kind,pts:[],auto:kind!=="cut",seed:null,tol:30,holes:[],miss:false};sel=null;error="";ui();draw();}
function setMethod(auto){if(!drawing)return;drawing.auto=auto;drawing.pts=[];drawing.holes=[];drawing.seed=null;drawing.miss=false;ui();draw();}
function runDetect(){
  var d=drawing;if(!d||!d.seed)return;
  var r=window.HausDetect?window.HausDetect.detect(small,d.seed.x,d.seed.y,d.tol):null;
  d.pts=r?r.pts:[];d.holes=r?r.holes:[];d.miss=!r;ui();draw();
}
function finishDraw(){
  if(!drawing||drawing.pts.length<3)return;
  var holes=drawing.holes||[];
  sel=addSurface(drawing.kind,drawing.pts).id;holes.forEach(function(h){addSurface("cut",h);});drawing=null;ui();refresh();
}
function drawHint(){
  var d=drawing,what=d.kind==="dach"?"Dachfläche":"Wandfläche";
  if(d.kind==="cut")return "Tippe die Ecken von Fenster oder Tür an. Dort bleibt das Originalfoto sichtbar.";
  if(!d.auto)return d.kind==="dach"?"Tippe die Ecken der Dachfläche der Reihe nach an: zuerst entlang der Traufe, dann am First. Vier Ecken ergeben die beste Perspektive."
    :"Tippe die Ecken der Wandfläche der Reihe nach an. Fenster und Türen sparst du danach aus.";
  if(!d.seed)return "Tippe mitten auf die "+what+". Die App sucht die zusammenhängende Fläche in dieser Farbe.";
  if(d.miss)return "Hier wurde keine Fläche gefunden. Tippe auf eine andere Stelle oder setze die Ecken selbst.";
  return "Passt der Umriss? Der Regler macht die Fläche kleiner oder größer, ein Tipp an anderer Stelle sucht neu. Ecken kannst du nach dem Bestätigen verschieben.";
}
function summary(){return surfaces.filter(function(s){return s.kind!=="cut";}).map(function(s){return s.name+": "+matName(s)+", "+colName(s.color);}).join("\n");}
function exportBlob(cb){renderAfter();after.toBlob(cb,"image/jpeg",.92);}

function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
function matName(s){var m=(MATS[s.kind]||[]).filter(function(x){return x.id===s.mat;})[0];return m?m.name:"";}
function colName(hex){var c=COLORS.filter(function(x){return x.hex===hex;})[0];return c?c.name:"";}
function ui(){
  $("mode-view").setAttribute("aria-pressed",mode==="view");$("mode-edit").setAttribute("aria-pressed",mode==="edit");
  cv.className=mode==="edit"?"edit":"";
  $("l-before").hidden=$("l-after").hidden=$("split").hidden=mode!=="view";
  $("drawbar").hidden=!drawing;$("d-done").disabled=!drawing||drawing.pts.length<3;$("d-undo").disabled=!drawing||!drawing.pts.length;
  $("methods").hidden=!drawing||drawing.kind==="cut";$("tolwrap").hidden=!(drawing&&drawing.auto&&drawing.seed);$("actions").hidden=mode!=="view";
  if(drawing){$("m-auto").setAttribute("aria-pressed",!!drawing.auto);$("m-manual").setAttribute("aria-pressed",!drawing.auto);$("tol").value=drawing.tol;$("d-undo").hidden=!!drawing.auto;}
  save();
  var h;
  if(error)h=error;
  else if(drawing)h=drawHint();
  else if(!surfaces.length)h="Noch keine Fläche markiert. Starte mit + Dach oder + Fassade.";
  else if(mode==="view")h="Zieh die Trennlinie über das Bild: links das Original, rechts der neue Look.";
  else h="Tippe eine Fläche an, um sie auszuwählen. Die Eckpunkte der ausgewählten Fläche kannst du verschieben.";
  $("hint").textContent=h;

  var chips=$("chips");chips.textContent="";
  surfaces.forEach(function(s){
    var b=el("button","btn");b.type="button";b.setAttribute("aria-pressed",s.id===sel);
    if(s.kind!=="cut"){var d=el("span","dot");d.style.background=s.color;b.appendChild(d);}
    b.appendChild(document.createTextNode(s.kind==="cut"?s.name:s.name+" · "+matName(s)+" "+colName(s.color)));
    b.onclick=function(){if(drawing)return;sel=s.id;ui();draw();};chips.appendChild(b);
  });
  var s=current();$("editor").hidden=!s||!!drawing;if(!s)return;
  $("ed-title").textContent=s.name;$("ed-style").hidden=$("rot").hidden=s.kind==="cut";
  if(s.kind==="cut")return;
  var mats=$("mats");mats.textContent="";
  MATS[s.kind].forEach(function(m){
    var b=el("button","btn",m.name);b.type="button";b.setAttribute("aria-pressed",m.id===s.mat);
    b.onclick=function(){s.mat=m.id;ui();refresh();};mats.appendChild(b);
  });
  var cols=$("colors");cols.textContent="";
  COLORS.forEach(function(c){
    var b=el("button","sw");b.type="button";b.style.background=c.hex;b.title=c.name;b.setAttribute("aria-label",c.name);b.setAttribute("aria-pressed",c.hex===s.color);
    b.onclick=function(){s.color=c.hex;ui();refresh();};cols.appendChild(b);
  });
  $("color-name").textContent=colName(s.color);
  $("scale").value=52-s.scale;$("scale").disabled=s.mat==="glatt";$("shade").value=Math.round(s.shade*100);
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
    if(drawing.auto){drawing.seed={x:p.x,y:p.y};runDetect();return;}
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
$("d-undo").onclick=function(){if(drawing){drawing.pts.pop();ui();draw();}};
$("d-cancel").onclick=function(){drawing=null;ui();draw();};
$("m-auto").onclick=function(){setMethod(true);};
$("m-manual").onclick=function(){setMethod(false);};
$("tol").oninput=function(){if(drawing){drawing.tol=+this.value;runDetect();}};
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
$("scale").oninput=function(){var s=current();if(s){s.scale=52-(+this.value);refresh();}};
$("shade").oninput=function(){var s=current();if(s){s.shade=this.value/100;refresh();}};
$("rot").onclick=function(){var s=current();if(s){s.rot=((s.rot||0)+1)%4;refresh();}};
$("del").onclick=function(){surfaces=surfaces.filter(function(s){return s.id!==sel;});sel=null;ui();refresh();};
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
  addSurface("fassade",r(330,412,870,650),{color:COLORS[5].hex});
  addSurface("cut",r(394,454,506,566));addSurface("cut",r(694,454,806,566));addSurface("cut",r(554,494,646,650));
  sel=roof.id;renderAfter();ui();draw();
}
function save(){
  clearTimeout(saveT);saveT=setTimeout(function(){
    try{localStorage.setItem("hausprobe.state",JSON.stringify({v:1,sample:isSample,surfaces:surfaces,nextId:nextId}));}catch(e){}
  },300);
}
function storePhoto(c){
  try{localStorage.setItem("hausprobe.photo",c.toDataURL("image/jpeg",.85));}
  catch(e){try{localStorage.removeItem("hausprobe.photo");}catch(e2){}}
}
function applyState(st){
  surfaces=st.surfaces;nextId=st.nextId||surfaces.length+1;sel=surfaces.length?surfaces[0].id:null;
  drawing=null;mode="view";renderAfter();ui();draw();
}
function restore(){
  var st=null,ph=null;
  try{st=JSON.parse(localStorage.getItem("hausprobe.state")||"null");ph=localStorage.getItem("hausprobe.photo");}catch(e){}
  loadSample();
  if(!st||st.v!==1||!Array.isArray(st.surfaces))return;
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
