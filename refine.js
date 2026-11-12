/* Bildqualität: Kanten der erkannten Fläche an die Kanten im Foto anlegen und Licht und Schatten aus dem Foto ableiten. */
(function(root){
"use strict";

/* Mittelwertfilter mit Radius r, getrennt in Zeilen und Spalten, Rand korrekt gewichtet. */
function box(a,w,h,r,out){
  var tmp=new Float32Array(w*h),pre=new Float64Array(Math.max(w,h)+1),x,y,lo,hi,o;
  for(y=0;y<h;y++){
    o=y*w;pre[0]=0;for(x=0;x<w;x++)pre[x+1]=pre[x]+a[o+x];
    for(x=0;x<w;x++){lo=x-r<0?0:x-r;hi=x+r>=w?w-1:x+r;tmp[o+x]=(pre[hi+1]-pre[lo])/(hi-lo+1);}
  }
  for(x=0;x<w;x++){
    pre[0]=0;for(y=0;y<h;y++)pre[y+1]=pre[y]+tmp[y*w+x];
    for(y=0;y<h;y++){lo=y-r<0?0:y-r;hi=y+r>=h?h-1:y+r;out[y*w+x]=(pre[hi+1]-pre[lo])/(hi-lo+1);}
  }
  return out;
}

/* Guided Filter mit Farbbild als Führung (He, Sun, Tang): die grobe Maske übernimmt die Kanten des Fotos. */
function guided(P,R,G,B,w,h,r,eps){
  var N=w*h,i;
  function bx(a){return box(a,w,h,r,new Float32Array(N));}
  function mul(a,b){var o=new Float32Array(N);for(var k=0;k<N;k++)o[k]=a[k]*b[k];return o;}
  var mR=bx(R),mG=bx(G),mB=bx(B),mP=bx(P);
  var cR=bx(mul(R,P)),cG=bx(mul(G,P)),cB=bx(mul(B,P));
  var rr=bx(mul(R,R)),rg=bx(mul(R,G)),rb=bx(mul(R,B)),gg=bx(mul(G,G)),gb=bx(mul(G,B)),bb=bx(mul(B,B));
  var aR=new Float32Array(N),aG=new Float32Array(N),aB=new Float32Array(N),b=new Float32Array(N);
  for(i=0;i<N;i++){
    var m0=mR[i],m1=mG[i],m2=mB[i],p=mP[i];
    var k0=cR[i]-m0*p,k1=cG[i]-m1*p,k2=cB[i]-m2*p;
    var s00=rr[i]-m0*m0+eps,s01=rg[i]-m0*m1,s02=rb[i]-m0*m2,s11=gg[i]-m1*m1+eps,s12=gb[i]-m1*m2,s22=bb[i]-m2*m2+eps;
    var i00=s11*s22-s12*s12,i01=s02*s12-s01*s22,i02=s01*s12-s02*s11,i11=s00*s22-s02*s02,i12=s01*s02-s00*s12,i22=s00*s11-s01*s01;
    var det=s00*i00+s01*i01+s02*i02;if(Math.abs(det)<1e-12)det=1e-12;
    var x0=(i00*k0+i01*k1+i02*k2)/det,x1=(i01*k0+i11*k1+i12*k2)/det,x2=(i02*k0+i12*k1+i22*k2)/det;
    aR[i]=x0;aG[i]=x1;aB[i]=x2;b[i]=p-x0*m0-x1*m1-x2*m2;
  }
  aR=bx(aR);aG=bx(aG);aB=bx(aB);b=bx(b);
  var q=new Float32Array(N);
  for(i=0;i<N;i++)q[i]=aR[i]*R[i]+aG[i]*G[i]+aB[i]*B[i]+b[i];
  return q;
}

function canvasOf(w,h){var c=document.createElement("canvas");c.width=w;c.height=h;return c;}

/* Grobe Maske (Alpha-Kanal) am Foto verfeinern. Liefert eine neue Maske mit weichem, bildgenauem Rand. */
function refine(mask,src){
  var sc=Math.min(1,800/Math.max(src.width,src.height)),w=Math.max(8,Math.round(src.width*sc)),h=Math.max(8,Math.round(src.height*sc)),N=w*h,i;
  var pc=canvasOf(w,h),pg=pc.getContext("2d");pg.drawImage(src,0,0,w,h);var pd=pg.getImageData(0,0,w,h).data;
  var mc=canvasOf(w,h),mg=mc.getContext("2d");mg.imageSmoothingEnabled=true;mg.drawImage(mask,0,0,w,h);var md=mg.getImageData(0,0,w,h).data;
  var P=new Float32Array(N),R=new Float32Array(N),G=new Float32Array(N),B=new Float32Array(N);
  for(i=0;i<N;i++){P[i]=md[i*4+3]/255;R[i]=pd[i*4]/255;G[i]=pd[i*4+1]/255;B[i]=pd[i*4+2]/255;}
  var r=Math.max(3,Math.round(Math.max(w,h)*.011)),q=guided(P,R,G,B,w,h,r,6e-4);
  /* Nur der Randbereich darf sich ändern: weit innen bleibt die Fläche deckend, weit außen leer. */
  var near=box(P,w,h,r*2,new Float32Array(N));
  var out=mg.createImageData(w,h),d=out.data,t,a;
  for(i=0;i<N;i++){
    a=near[i]>.985?1:near[i]<.015?0:q[i];
    t=(a-.3)/.4;t=t<0?0:t>1?1:t;a=t*t*(3-2*t);
    d[i*4]=255;d[i*4+1]=216;d[i*4+2]=77;d[i*4+3]=Math.round(a*255);
  }
  mg.putImageData(out,0,0);
  return mc;
}

/* Licht und Schatten: geglättete Helligkeit des Fotos innerhalb der Fläche, bezogen auf deren besonnte Stellen.
   Ergebnis ist eine Graukarte für den Mischmodus "hard-light": 50 % Grau lässt die Farbe unverändert,
   dunkler multipliziert (Schatten), heller hellt auf. drawMask(ctx,w,h) zeichnet die Fläche als Alpha. */
function shade(src,drawMask){
  var sc=Math.min(1,360/Math.max(src.width,src.height)),w=Math.max(8,Math.round(src.width*sc)),h=Math.max(8,Math.round(src.height*sc)),N=w*h,i;
  var pc=canvasOf(w,h),pg=pc.getContext("2d");pg.drawImage(src,0,0,w,h);var pd=pg.getImageData(0,0,w,h).data;
  var mc=canvasOf(w,h),mg=mc.getContext("2d");drawMask(mg,w,h);var md=mg.getImageData(0,0,w,h).data;
  var L=new Float32Array(N),M=new Float32Array(N),inside=0;
  for(i=0;i<N;i++){M[i]=md[i*4+3]>127?1:0;inside+=M[i];L[i]=(.299*pd[i*4]+.587*pd[i*4+1]+.114*pd[i*4+2])*M[i];}
  if(inside<12)return null;
  var r=Math.max(1,Math.round(Math.max(w,h)/170));
  var Lb=box(box(L,w,h,r,new Float32Array(N)),w,h,r,new Float32Array(N)),Mb=box(box(M,w,h,r,new Float32Array(N)),w,h,r,new Float32Array(N));
  var vals=[];
  for(i=0;i<N;i++){Lb[i]=Mb[i]>.04?Lb[i]/Mb[i]:-1;if(M[i])vals.push(Lb[i]);}
  vals.sort(function(a,b){return a-b;});
  var ref=Math.max(8,vals[Math.floor(vals.length*.8)]);
  var out=pg.createImageData(w,h),d=out.data,v;
  for(i=0;i<N;i++){
    v=Lb[i]<0?1:Math.pow(Lb[i]/ref,.85);v=v<.08?.08:v>1.4?1.4:v;
    v=Math.round(v*127.5);d[i*4]=d[i*4+1]=d[i*4+2]=v>255?255:v;d[i*4+3]=255;
  }
  pg.putImageData(out,0,0);
  return pc;
}

root.HausRefine={refine:refine,shade:shade};
})(typeof window!=="undefined"?window:this);
