/* Trainingsdaten sammeln: Fotos markieren (Dach, Wand, Fenster, Tür), im Browser speichern, als ZIP exportieren.
   Markiert wird mit derselben Erkennung wie in der App: Tipp, Vorschlag prüfen, übernehmen. */
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
var SEG=window.HausSeg,cv=$("cv"),ctx=cv.getContext("2d");
var NAMES=["Hintergrund","Dach","Wand","Fenster","Tür"],COLORS=[[0,0,0],[224,72,58],[60,127,214],[242,194,48],[54,179,126]];
var MAXSIDE=1600;
var queue=[],cur=null,cls=1,sub=false,taps=[],cands=[],pick=0,busy=false,undo=[],items=[];
var overlay=document.createElement("canvas");

/* ---------- Speicher (IndexedDB) ---------- */
var dbp=null;
function db(){
  if(dbp)return dbp;
  dbp=new Promise(function(res,rej){
    var r=indexedDB.open("hausprobe-label",1);
    r.onupgradeneeded=function(){r.result.createObjectStore("items",{keyPath:"id"});};
    r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};
  });
  return dbp;
}
function tx(mode,fn){return db().then(function(d){return new Promise(function(res,rej){var t=d.transaction("items",mode),s=t.objectStore("items"),out=fn(s);t.oncomplete=function(){res(out&&out.result);};t.onerror=function(){rej(t.error);};});});}
function putItem(it){return tx("readwrite",function(s){return s.put(it);});}
function allItems(){return tx("readonly",function(s){return s.getAll();});}
function clearItems(){return tx("readwrite",function(s){return s.clear();});}

/* ---------- Anzeige ---------- */
function hint(t){$("hint").textContent=t;}
function setBusy(t){$("busy").hidden=!t;$("busy-text").textContent=t||"";}
function draw(){
  if(!cur){ctx.clearRect(0,0,cv.width,cv.height);return;}
  var W=cur.w,H=cur.h;
  ctx.drawImage(cur.canvas,0,0);
  ctx.globalAlpha=.5;ctx.drawImage(overlay,0,0,W,H);ctx.globalAlpha=1;
  var c=cands[pick];
  if(c){
    ctx.save();ctx.globalAlpha=.55;ctx.drawImage(c.canvas,0,0,W,H);ctx.restore();
  }
  var k=W/Math.max(1,cv.getBoundingClientRect().width);
  taps.forEach(function(t){ctx.beginPath();ctx.arc(t.x*W,t.y*H,7*k,0,7);ctx.fillStyle=t.add?"#fff":"#e5533d";ctx.fill();ctx.lineWidth=2*k;ctx.strokeStyle="#10181a";ctx.stroke();});
}
/* Markierungen als farbige Ebene (Auflösung der Markierung, wird beim Zeichnen skaliert). */
function paintOverlay(){
  var L=cur.label,lw=cur.lw,lh=cur.lh;
  if(overlay.width!==lw||overlay.height!==lh){overlay.width=lw;overlay.height=lh;}
  var g=overlay.getContext("2d"),im=g.createImageData(lw,lh),d=im.data,i,c;
  for(i=0;i<L.length;i++){c=L[i];if(!c)continue;d[i*4]=COLORS[c][0];d[i*4+1]=COLORS[c][1];d[i*4+2]=COLORS[c][2];d[i*4+3]=255;}
  g.putImageData(im,0,0);
}
function ui(){
  $("work").hidden=!cur;$("view").hidden=!cur;
  $("queue").textContent=queue.length?"Noch "+queue.length+" Foto"+(queue.length===1?"":"s")+" in der Reihe":"";
  Array.prototype.forEach.call(document.querySelectorAll("#cls button"),function(b){b.setAttribute("aria-pressed",+b.dataset.c===cls);});
  $("pt-add").setAttribute("aria-pressed",!sub);$("pt-sub").setAttribute("aria-pressed",sub);
  $("sz-less").disabled=busy||pick<=0;$("sz-more").disabled=busy||pick>=cands.length-1;
  $("apply").disabled=busy||!cands[pick];$("cand-clear").disabled=!taps.length;$("undo").disabled=!undo.length;
  $("count").textContent=items.length+" gespeichert";$("export").disabled=!items.length;$("clear-all").disabled=!items.length;
  cv.className=cur?"edit":"";
  if(!cur)hint("Wähle Fotos von Häusern aus Deutschland, Österreich oder der Schweiz, oder suche auf Wikimedia Commons.");
  else if(busy)hint("Einen Moment …");
  else if(!taps.length)hint("Tippe mitten auf: "+NAMES[cls]+". Mit „Übernehmen“ wird die gelbe Fläche als "+NAMES[cls]+" eingetragen.");
  else hint("Passt die helle Fläche? Weitere Tipps ergänzen, „Wegnehmen“ entfernt Teile. Dann „Übernehmen“.");
}

/* ---------- Fotos laden ---------- */
function toCanvas(img){
  var sc=Math.min(1,MAXSIDE/Math.max(img.width,img.height)),c=document.createElement("canvas");
  c.width=Math.max(8,Math.round(img.width*sc));c.height=Math.max(8,Math.round(img.height*sc));
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);return c;
}
function next(){
  cur=null;taps=[];cands=[];pick=0;undo=[];
  var q=queue.shift();if(!q){ui();draw();return;}
  setBusy("Foto wird geladen");
  q.load().then(function(img){
    var c=toCanvas(img),ls=Math.min(1,1024/Math.max(c.width,c.height));
    cur={canvas:c,w:c.width,h:c.height,lw:Math.max(8,Math.round(c.width*ls)),lh:Math.max(8,Math.round(c.height*ls)),meta:q.meta,name:q.name};
    cur.label=new Uint8Array(cur.lw*cur.lh);
    cv.width=cur.w;cv.height=cur.h;paintOverlay();
    $("lic").value=q.meta.license||"own";$("author").value=q.meta.author||"";$("srcurl").value=q.meta.url||"";
    ["c1","c2","c3","c4"].forEach(function(id){$(id).checked=false;});
    SEG.prepare(c);setBusy("");ui();draw();
  }).catch(function(){setBusy("");hint("Dieses Foto ließ sich nicht laden. Es wird übersprungen.");setTimeout(next,1200);});
}
function enqueue(list){var start=!cur&&!queue.length;queue=queue.concat(list);if(start)next();else ui();}
$("files").onchange=function(){
  var fs=Array.prototype.slice.call(this.files||[]);this.value="";
  enqueue(fs.filter(function(f){return /^image\//.test(f.type);}).map(function(f){
    return {name:f.name,meta:{license:"own"},load:function(){return createImageBitmap(f);}};
  }));
};

/* ---------- Markieren ---------- */
function pos(e){var r=cv.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))};}
var ticket=0;
function detect(){
  var t=++ticket;
  if(!taps.length){cands=[];pick=0;busy=false;ui();draw();return;}
  busy=true;ui();
  SEG.masks(taps.slice(),{raw:cls>=3||cls===0}).then(function(c){
    if(t!==ticket)return;busy=false;cands=c;
    /* Dach und Wand: die größte farblich passende Fläche; Fenster und Tür: die größte, die nicht fast das ganze Bild ist. */
    pick=0;for(var i=0;i<c.length;i++){if(cls>=3?c[i].share<.12:(c[i].whole<=.62&&c[i].sim>=.1))pick=i;}
    ui();draw();
  }).catch(function(){busy=false;cands=[];ui();hint("Die Erkennung läuft auf diesem Gerät gerade nicht.");});
}
cv.addEventListener("pointerdown",function(e){
  if(!cur||busy)return;e.preventDefault();
  var p=pos(e);taps.push({x:p.x,y:p.y,add:!sub});detect();
});
Array.prototype.forEach.call(document.querySelectorAll("#cls button"),function(b){
  b.onclick=function(){cls=+b.dataset.c;if(taps.length)detect();ui();};
});
$("pt-add").onclick=function(){sub=false;ui();};
$("pt-sub").onclick=function(){sub=true;ui();};
$("sz-less").onclick=function(){pick=Math.max(0,pick-1);ui();draw();};
$("sz-more").onclick=function(){pick=Math.min(cands.length-1,pick+1);ui();draw();};
$("cand-clear").onclick=function(){taps=[];cands=[];pick=0;ticket++;busy=false;ui();draw();};
function pushUndo(){undo.push(cur.label.slice());if(undo.length>15)undo.shift();}
/* Fläche eintragen. Fenster und Türen haben Vorrang: Dach und Wand überschreiben sie nicht. */
function paintMask(mask,c){
  var lw=cur.lw,lh=cur.lh,t=document.createElement("canvas");t.width=lw;t.height=lh;
  var g=t.getContext("2d");g.drawImage(mask,0,0,lw,lh);var d=g.getImageData(0,0,lw,lh).data,L=cur.label,i;
  for(i=0;i<L.length;i++){if(d[i*4+3]<128)continue;if((c===1||c===2)&&L[i]>=3)continue;L[i]=c;}
}
$("apply").onclick=function(){
  var c=cands[pick];if(!c||!cur)return;
  pushUndo();paintMask(c.canvas,cls);
  taps=[];cands=[];pick=0;paintOverlay();ui();draw();
};
$("undo").onclick=function(){if(!undo.length)return;cur.label=undo.pop();paintOverlay();ui();draw();};
$("suggest").onclick=function(){
  if(!cur||!SEG.windows)return;
  setBusy("Fenster und Türen werden gesucht");
  SEG.windows(.3).then(function(boxes){
    setBusy("");pushUndo();
    var lw=cur.lw,lh=cur.lh,L=cur.label,n=0;
    boxes.forEach(function(b){
      var c=b.cls===1?4:3,x0=Math.round(b.x0*lw),x1=Math.round(b.x1*lw),y0=Math.round(b.y0*lh),y1=Math.round(b.y1*lh),x,y;
      for(y=Math.max(0,y0);y<Math.min(lh,y1);y++)for(x=Math.max(0,x0);x<Math.min(lw,x1);x++)L[y*lw+x]=c;n++;
    });
    paintOverlay();ui();draw();
    hint(n?n+" Vorschläge eingetragen. Prüfe sie und lösche falsche mit „Löschen“ und einem Tipp.":"Keine Fenster oder Türen gefunden.");
  }).catch(function(){setBusy("");hint("Das Fenstermodell ist noch nicht verfügbar.");});
};
document.addEventListener("keydown",function(e){
  if(/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))return;
  if(e.key==="Enter"&&!$("apply").disabled){e.preventDefault();$("apply").click();}
  else if(e.key==="Escape")$("cand-clear").click();
  else if(e.key>="0"&&e.key<="4"){var b=document.querySelector('#cls button[data-c="'+(e.key==="0"?0:e.key)+'"]');if(b)b.click();}
});

/* ---------- Speichern ---------- */
function labelPng(){
  var c=document.createElement("canvas");c.width=cur.lw;c.height=cur.lh;var g=c.getContext("2d"),im=g.createImageData(cur.lw,cur.lh),d=im.data,L=cur.label,i;
  for(i=0;i<L.length;i++){d[i*4]=d[i*4+1]=d[i*4+2]=L[i];d[i*4+3]=255;}
  g.putImageData(im,0,0);
  return new Promise(function(res){c.toBlob(res,"image/png");});
}
function photoJpg(){return new Promise(function(res){cur.canvas.toBlob(res,"image/jpeg",.92);});}
$("save").onclick=function(){
  if(!cur)return;
  var counts=[0,0,0,0,0];cur.label.forEach(function(v){counts[v]++;});
  if(counts[1]+counts[2]+counts[3]+counts[4]===0){hint("Es ist noch nichts markiert. Markiere zuerst Dach oder Wand, oder überspringe das Foto.");return;}
  var meta={name:cur.name,license:$("lic").value,author:$("author").value.trim(),url:$("srcurl").value.trim(),
    complete:{roof:$("c1").checked,wall:$("c2").checked,window:$("c3").checked,door:$("c4").checked},
    width:cur.w,height:cur.h,labelWidth:cur.lw,labelHeight:cur.lh,pixels:{roof:counts[1],wall:counts[2],window:counts[3],door:counts[4]},
    saved:new Date().toISOString()};
  Promise.all([photoJpg(),labelPng()]).then(function(b){
    var id=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    return putItem({id:id,meta:meta,img:b[0],label:b[1]});
  }).then(function(){return refresh();}).then(next).catch(function(){hint("Speichern ist fehlgeschlagen. Ist der Speicher des Browsers voll?");});
};
$("skip").onclick=next;
function refresh(){
  return allItems().then(function(list){
    items=list.sort(function(a,b){return a.id<b.id?-1:1;});
    var box=$("saved");box.textContent="";
    items.slice(-24).forEach(function(it){var im=document.createElement("img");im.alt="";im.src=URL.createObjectURL(it.img);im.onload=function(){URL.revokeObjectURL(im.src);};box.appendChild(im);});
    ui();
  });
}
$("clear-all").onclick=function(){$("confirm").hidden=false;};
$("clear-no").onclick=function(){$("confirm").hidden=true;};
$("clear-yes").onclick=function(){$("confirm").hidden=true;clearItems().then(refresh);};

/* ---------- Export als ZIP (unkomprimiert, ohne Zusatzbibliothek) ---------- */
var CRC=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(u){var c=0xFFFFFFFF;for(var i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function zip(files){
  var enc=new TextEncoder(),parts=[],central=[],off=0;
  files.forEach(function(f){
    var name=enc.encode(f.name),data=f.data,crc=crc32(data),h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);
    h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
    parts.push(new Uint8Array(h.buffer),name,data);
    var c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);
    c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,off,true);
    central.push(new Uint8Array(c.buffer),name);
    off+=30+name.length+data.length;
  });
  var size=central.reduce(function(s,p){return s+p.length;},0),e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,off,true);
  return new Blob(parts.concat(central,[new Uint8Array(e.buffer)]),{type:"application/zip"});
}
$("export").onclick=function(){
  if(!items.length)return;
  setBusy("Export wird erstellt");
  var files=[],manifest={format:"hausprobe-label-1",classes:NAMES,items:[]};
  Promise.all(items.map(function(it){
    return Promise.all([it.img.arrayBuffer(),it.label.arrayBuffer()]).then(function(b){
      files.push({name:"images/"+it.id+".jpg",data:new Uint8Array(b[0])},{name:"labels/"+it.id+".png",data:new Uint8Array(b[1])});
      manifest.items.push(Object.assign({id:it.id},it.meta));
    });
  })).then(function(){
    files.push({name:"manifest.json",data:new TextEncoder().encode(JSON.stringify(manifest,null,1))});
    var blob=zip(files),a=document.createElement("a"),u=URL.createObjectURL(blob);
    a.href=u;a.download="hausprobe-trainingsdaten-"+new Date().toISOString().slice(0,10)+".zip";document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(u);},20000);setBusy("");
  }).catch(function(){setBusy("");hint("Der Export ist fehlgeschlagen.");});
};

/* ---------- Wikimedia Commons: frei lizenzierte Fotos suchen ---------- */
var cq="",coff=0,cres=[];
function strip(h){var d=document.createElement("div");d.innerHTML=h||"";return (d.textContent||"").trim();}
function licOf(s){
  s=(s||"").trim();
  if(/^(CC0|Public domain|PD)/i.test(s))return "CC0";
  if(/^CC BY-SA\b/i.test(s))return "CC BY-SA";
  if(/^CC BY\b/i.test(s)&&!/NC|ND/i.test(s))return "CC BY";
  return null;
}
function search(q,more){
  if(!more){cq=q;coff=0;cres=[];$("commons-grid").textContent="";}
  $("commons-msg").textContent="Suche läuft …";$("commons-more").hidden=true;
  var u="https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=40"+
    "&gsroffset="+coff+"&gsrsearch="+encodeURIComponent(cq+" filetype:bitmap")+"&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth="+MAXSIDE;
  fetch(u).then(function(r){return r.json();}).then(function(j){
    coff=j.continue&&j.continue.gsroffset||0;
    var pages=j.query&&j.query.pages?Object.keys(j.query.pages).map(function(k){return j.query.pages[k];}):[],n=0;
    pages.sort(function(a,b){return (a.index||0)-(b.index||0);}).forEach(function(p){
      var ii=p.imageinfo&&p.imageinfo[0];if(!ii||!ii.thumburl)return;
      var m=ii.extmetadata||{},lic=licOf(m.LicenseShortName&&m.LicenseShortName.value);if(!lic)return;
      if(Math.max(ii.width,ii.height)<800)return;
      var r={title:p.title,thumb:ii.thumburl,page:ii.descriptionurl,license:lic,licName:m.LicenseShortName.value,author:strip(m.Artist&&m.Artist.value)};
      cres.push(r);n++;
      var lab=document.createElement("label"),cb=document.createElement("input"),im=document.createElement("img"),sm=document.createElement("small");
      cb.type="checkbox";cb.dataset.i=cres.length-1;cb.onchange=function(){$("commons-take").disabled=!document.querySelector("#commons-grid input:checked");};
      im.src=ii.thumburl.replace(/\/\d+px-/,"/320px-");im.alt=p.title;im.loading="lazy";
      sm.textContent=r.licName+" · "+(r.author||"unbekannt");lab.title=p.title;
      lab.appendChild(cb);lab.appendChild(im);lab.appendChild(sm);$("commons-grid").appendChild(lab);
    });
    $("commons-msg").textContent=cres.length?cres.length+" Fotos mit freier Lizenz gefunden.":"Keine passenden Fotos gefunden.";
    $("commons-more").hidden=!coff;
  }).catch(function(){$("commons-msg").textContent="Wikimedia Commons ist gerade nicht erreichbar. Lade die Fotos stattdessen herunter und wähle sie mit „Fotos wählen“.";});
}
$("open-commons").onclick=function(){$("commons").hidden=false;if(!cres.length)search($("commons-q").value);};
$("commons-close").onclick=function(){$("commons").hidden=true;};
$("commons-form").onsubmit=function(e){e.preventDefault();search($("commons-q").value);};
Array.prototype.forEach.call(document.querySelectorAll("#commons-presets button"),function(b){b.onclick=function(){$("commons-q").value=b.dataset.q;search(b.dataset.q);};});
$("commons-more").onclick=function(){search(cq,true);};
$("commons-take").onclick=function(){
  var sel=Array.prototype.map.call(document.querySelectorAll("#commons-grid input:checked"),function(cb){cb.checked=false;cb.closest("label").style.opacity=.35;return cres[+cb.dataset.i];});
  $("commons-take").disabled=true;$("commons").hidden=true;
  enqueue(sel.map(function(r){
    return {name:r.title,meta:{license:r.license,author:r.author,url:r.page},
      load:function(){return fetch(r.thumb,{mode:"cors"}).then(function(x){if(!x.ok)throw new Error();return x.blob();}).then(createImageBitmap);}};
  }));
};
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("commons").hidden)$("commons").hidden=true;});

refresh().catch(function(){ui();});
window.addEventListener("resize",draw);
ui();
})();
