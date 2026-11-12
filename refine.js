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

/* Weiche Verfeinerung: grobe Maske per Guided Filter an die Kanten des Fotos anlegen (gut für Bewuchs und Unregelmäßiges). */
function softAlpha(mask,src){
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

/* Umrisse der Maske als geschlossene Linienzüge entlang der Pixelkanten (Fläche liegt in Laufrichtung rechts).
   Außenränder und Löcher (Fenster) kommen als getrennte Linienzüge. */
function trace(B,w,h){
  function at(x,y){return x>=0&&y>=0&&x<w&&y<h&&B[y*w+x]?1:0;}
  var seen=new Uint8Array(w*h),out=[],x,y;
  var DX=[1,0,-1,0],DY=[0,1,0,-1];
  for(y=0;y<h;y++)for(x=0;x<w;x++){
    if(!B[y*w+x]||at(x,y-1)||seen[y*w+x])continue;
    var pts=[],vx=x,vy=y,d=0,guard=0;
    do{
      if(d===0)seen[vy*w+vx]=1;
      pts.push([vx,vy]);vx+=DX[d];vy+=DY[d];
      var ar,al;
      if(d===0){ar=at(vx,vy);al=at(vx,vy-1);}
      else if(d===1){ar=at(vx-1,vy);al=at(vx,vy);}
      else if(d===2){ar=at(vx-1,vy-1);al=at(vx-1,vy);}
      else{ar=at(vx,vy-1);al=at(vx-1,vy-1);}
      if(!ar)d=(d+1)%4;else if(al)d=(d+3)%4;
    }while((vx!==x||vy!==y||d!==0)&&++guard<4*w*h);
    out.push(pts);
  }
  return out;
}
function segDist(p,a,b){
  var dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  if(l2<1e-9)return Math.hypot(p[0]-a[0],p[1]-a[1]);
  var t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2;t=t<0?0:t>1?1:t;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
/* Douglas-Peucker auf einem geschlossenen Linienzug; liefert die Indizes der Eckpunkte in Reihenfolge. */
function corners(pts,tol){
  var n=pts.length,far=0,md=-1,i,d;
  for(i=1;i<n;i++){d=Math.hypot(pts[i][0]-pts[0][0],pts[i][1]-pts[0][1]);if(d>md){md=d;far=i;}}
  var keep=new Uint8Array(n);keep[0]=1;keep[far]=1;
  var stack=[[0,far],[far,n]];
  while(stack.length){
    var s=stack.pop(),a=s[0],b=s[1],A=pts[a],Bp=pts[b%n],mx=0,mi=-1;
    for(i=a+1;i<b;i++){d=segDist(pts[i],A,Bp);if(d>mx){mx=d;mi=i;}}
    if(mx>tol){keep[mi]=1;stack.push([a,mi],[mi,b]);}
  }
  var out=[];for(i=0;i<n;i++)if(keep[i])out.push(i);return out;
}
function cut(a1,a2,b1,b2){
  var d1x=a2[0]-a1[0],d1y=a2[1]-a1[1],d2x=b2[0]-b1[0],d2y=b2[1]-b1[1],den=d1x*d2y-d1y*d2x;
  if(Math.abs(den)<.25*Math.hypot(d1x,d1y)*Math.hypot(d2x,d2y))return null;
  var t=((b1[0]-a1[0])*d2y-(b1[1]-a1[1])*d2x)/den;
  return [a1[0]+t*d1x,a1[1]+t*d1y];
}

/* Gerade Kanten finden: lange, fast gerade Stücke des Umrisses werden auf die stärkste Bildkante in ihrer Nähe gelegt.
   Liefert Linienzüge (0..1) für die scharfe Fläche und die geraden Stücke, an denen sie gelten soll. */
function straighten(mask,src){
  var w=mask.width,h=mask.height,N=w*h,i,x,y,big=Math.max(w,h);
  var md=mask.getContext("2d").getImageData(0,0,w,h).data,B=new Uint8Array(N);
  for(i=0;i<N;i++)B[i]=md[i*4+3]>127?1:0;
  var pc=canvasOf(w,h),pg=pc.getContext("2d");pg.drawImage(src,0,0,w,h);var pd=pg.getImageData(0,0,w,h).data;
  /* Kantenstärke über alle drei Farbkanäle, damit auch Kanten gleicher Helligkeit zählen (grüner Rahmen vor dunkler Wand). */
  var G=new Float32Array(N),sum=0;
  for(y=1;y<h-1;y++)for(x=1;x<w-1;x++){
    var o=(y*w+x)*4,g=0,c,dx,dy;
    for(c=0;c<3;c++){dx=pd[o+4+c]-pd[o-4+c];dy=pd[o+w*4+c]-pd[o-w*4+c];g+=dx*dx+dy*dy;}
    G[y*w+x]=Math.sqrt(g);sum+=G[y*w+x];
  }
  G=box(G,w,h,1,new Float32Array(N));
  var thr=Math.max(14,2*sum/N);
  var D=1,Lmin=big*.03,tol=Math.max(3,big*.0045),minArea=N*.0004,sig=1.5;
  function score(ax,ay,bx,by,K){
    var s=0,k,t,px,py;
    for(k=0;k<K;k++){t=.1+.8*k/(K-1);px=ax+(bx-ax)*t;py=ay+(by-ay)*t;
      px=px<0?0:px>=w?w-1:px|0;py=py<0?0:py>=h?h-1:py|0;s+=G[py*w+px];}
    return s/K;
  }
  var paths=[],segs=[];
  trace(B,w,h).forEach(function(pts){
    var n=pts.length,area=0,k;
    for(k=0;k<n;k++){var q=pts[(k+1)%n];area+=pts[k][0]*q[1]-q[0]*pts[k][1];}
    if(Math.abs(area)/2<minArea)return;
    var idx=corners(pts,tol),m=idx.length;
    if(m<3)return;
    var E=[];
    for(k=0;k<m;k++){
      var P=pts[idx[k]],Q=pts[idx[(k+1)%m]],len=Math.hypot(Q[0]-P[0],Q[1]-P[1]),e={a:idx[k],b:idx[(k+1)%m],snap:null};
      if(len>=Lmin){
        /* Ausgleichsgerade durch die Umrisspunkte dieses Stücks (ohne die Eckbereiche). */
        var cnt=(e.b-e.a+n)%n||n,skip=Math.floor(cnt*.08),mx=0,my=0,c=0,j,p,sxx=0,syy=0,sxy=0;
        for(j=skip;j<=cnt-skip;j++){p=pts[(e.a+j)%n];mx+=p[0];my+=p[1];c++;}
        mx/=c;my/=c;
        for(j=skip;j<=cnt-skip;j++){p=pts[(e.a+j)%n];sxx+=(p[0]-mx)*(p[0]-mx);syy+=(p[1]-my)*(p[1]-my);sxy+=(p[0]-mx)*(p[1]-my);}
        var ang=.5*Math.atan2(2*sxy,sxx-syy),ux=Math.cos(ang),uy=Math.sin(ang);
        if(ux*(Q[0]-P[0])+uy*(Q[1]-P[1])<0){ux=-ux;uy=-uy;}
        var tp=(P[0]-mx)*ux+(P[1]-my)*uy,tq=(Q[0]-mx)*ux+(Q[1]-my)*uy;
        var A=[mx+ux*tp,my+uy*tp],Bq=[mx+ux*tq,my+uy*tq],nx=-uy,ny=ux;
        /* Die Lage stimmt schon: höchstens um ein Pixel auf die Bildkante rücken. Mehr Spielraum springt
           auf die kräftigere Nachbarkante (z. B. vom Zierrahmen auf den weißen Fensterstock). */
        var K=Math.max(12,Math.min(90,Math.round(len/2))),best=-1,bo=null,o1,o2,sc,mean;
        for(o1=-D;o1<=D;o1++)for(o2=o1-1;o2<=o1+1;o2++){
          mean=score(A[0]+nx*o1,A[1]+ny*o1,Bq[0]+nx*o2,Bq[1]+ny*o2,K);
          sc=mean*Math.exp(-(o1*o1+o2*o2)/(4*sig*sig));
          if(mean>=thr&&sc>best){best=sc;bo=[o1,o2];}
        }
        if(!bo)bo=[0,0];
        /* Nur echte Bauteilkanten gerade ziehen: quer zur Linie muss überall an derselben Stelle eine Bildkante liegen.
           An Sträuchern oder Schattenrändern streut das, dort bleibt der weiche, unregelmäßige Rand. */
        var offs=[],kk,oo,gb,ob,tt,cx,cy,qx,qy;
        for(kk=0;kk<K;kk++){
          tt=.1+.8*kk/(K-1);cx=A[0]+(Bq[0]-A[0])*tt;cy=A[1]+(Bq[1]-A[1])*tt;gb=-1;ob=0;
          for(oo=-4;oo<=4;oo++){
            qx=cx+nx*oo;qy=cy+ny*oo;qx=qx<0?0:qx>=w?w-1:qx|0;qy=qy<0?0:qy>=h?h-1:qy|0;
            if(G[qy*w+qx]>gb){gb=G[qy*w+qx];ob=oo;}
          }
          if(gb>=thr)offs.push(ob);
        }
        offs.sort(function(u,v){return u-v;});
        var med=offs.length?offs[offs.length>>1]:0,agree=0;
        offs.forEach(function(v){if(Math.abs(v-med)<=1)agree++;});
        if(agree>=K*.65)e.snap=[[A[0]+nx*bo[0],A[1]+ny*bo[0]],[Bq[0]+nx*bo[1],Bq[1]+ny*bo[1]]];
      }
      E.push(e);
    }
    /* Benachbarte gerade Kanten treffen sich in ihrem Schnittpunkt: das ergibt saubere Ecken. */
    for(k=0;k<m;k++){
      var e0=E[k],e1=E[(k+1)%m];
      if(e0.snap&&e1.snap){
        var X=cut(e0.snap[0],e0.snap[1],e1.snap[0],e1.snap[1]),V=pts[e0.b];
        if(X&&Math.hypot(X[0]-V[0],X[1]-V[1])<Math.max(8,big*.012)){e0.end=X;e1.start=X;}
      }
    }
    var path=[];
    E.forEach(function(e){
      if(e.snap){
        var s=e.start||e.snap[0],t=e.end||e.snap[1];
        path.push(s,t);segs.push([s[0]/w,s[1]/h,t[0]/w,t[1]/h]);
      }else{
        var j=e.a;do{path.push(pts[j]);j=(j+1)%n;}while(j!==e.b);
      }
    });
    paths.push(path.map(function(p){return [p[0]/w,p[1]/h];}));
  });
  return {paths:paths,segs:segs};
}

/* Erkannte Fläche verfeinern. An geraden Kanten gilt die scharf gezeichnete Linie, überall sonst die weiche Verfeinerung. */
function refine(mask,src){
  var soft=softAlpha(mask,src);
  var fs=Math.min(1,1400/Math.max(src.width,src.height)),fw=Math.max(8,Math.round(src.width*fs)),fh=Math.max(8,Math.round(src.height*fs));
  var oc=canvasOf(fw,fh),og=oc.getContext("2d");og.imageSmoothingEnabled=true;og.drawImage(soft,0,0,fw,fh);
  /* Umrisse aus der weich verfeinerten Fläche: sie liegt farblich genauer an Rahmen und Leisten als die Rohmaske. */
  var st=null;try{st=straighten(soft,src);}catch(e){}
  if(!st||!st.segs.length)return oc;
  var band=Math.max(5,Math.max(fw,fh)*.012);
  var wc=canvasOf(fw,fh),wg=wc.getContext("2d");wg.lineCap="round";wg.lineWidth=band*2;wg.strokeStyle="#000";
  st.segs.forEach(function(s){wg.beginPath();wg.moveTo(s[0]*fw,s[1]*fh);wg.lineTo(s[2]*fw,s[3]*fh);wg.stroke();});
  var cc=canvasOf(fw,fh),cg=cc.getContext("2d");cg.fillStyle="#ffd84d";cg.beginPath();
  st.paths.forEach(function(p){p.forEach(function(v,i){i?cg.lineTo(v[0]*fw,v[1]*fh):cg.moveTo(v[0]*fw,v[1]*fh);});cg.closePath();});
  cg.fill("evenodd");
  cg.globalCompositeOperation="destination-in";cg.drawImage(wc,0,0);
  og.globalCompositeOperation="destination-out";og.drawImage(wc,0,0);
  og.globalCompositeOperation="lighter";og.drawImage(cc,0,0);
  og.globalCompositeOperation="source-over";
  oc._segs=st.segs;
  return oc;
}

/* Licht und Schatten: geglättete Helligkeit des Fotos innerhalb der Fläche, bezogen auf deren besonnte Stellen.
   Ergebnis ist eine Karte für den Mischmodus "hard-light": 50 % Grau lässt die Farbe unverändert,
   dunkler multipliziert (Schatten), heller hellt auf. drawMask(ctx,w,h) zeichnet die Fläche als Alpha.
   Ein neues Material ist sauber: schwache Unterschiede (Verwitterung, Flecken, Fugen des alten Belags) werden
   ausgeblendet, echte Schlagschatten bleiben in voller Stärke und bekommen den leicht bläulichen Ton von Außenschatten. */
function shade(src,drawMask){
  var sc=Math.min(1,512/Math.max(src.width,src.height)),w=Math.max(8,Math.round(src.width*sc)),h=Math.max(8,Math.round(src.height*sc)),N=w*h,i;
  var pc=canvasOf(w,h),pg=pc.getContext("2d");pg.drawImage(src,0,0,w,h);var pd=pg.getImageData(0,0,w,h).data;
  var mc=canvasOf(w,h),mg=mc.getContext("2d");drawMask(mg,w,h);var md=mg.getImageData(0,0,w,h).data;
  var L=new Float32Array(N),M=new Float32Array(N),inside=0;
  for(i=0;i<N;i++){M[i]=md[i*4+3]>127?1:0;inside+=M[i];L[i]=(.299*pd[i*4]+.587*pd[i*4+1]+.114*pd[i*4+2])*M[i];}
  if(inside<12)return null;
  var r=Math.max(1,Math.round(Math.max(w,h)/200));
  var Lb=box(box(L,w,h,r,new Float32Array(N)),w,h,r,new Float32Array(N)),Mb=box(box(M,w,h,r,new Float32Array(N)),w,h,r,new Float32Array(N));
  var vals=[];
  for(i=0;i<N;i++){Lb[i]=Mb[i]>.04?Lb[i]/Mb[i]:-1;if(M[i])vals.push(Lb[i]);}
  vals.sort(function(a,b){return a-b;});
  var ref=Math.max(8,vals[Math.floor(vals.length*.75)]);
  var out=pg.createImageData(w,h),d=out.data,v,dk,t,k;
  for(i=0;i<N;i++){
    v=Lb[i]<0?1:Lb[i]/ref;
    if(v<1){dk=1-v;t=(dk-.1)/.26;t=t<0?0:t>1?1:t;k=t*t*(3-2*t);dk*=k;v=1-dk;if(v<.1)v=.1;}
    else{v=1+(v-1)*.3;if(v>1.12)v=1.12;dk=0;}
    d[i*4]=Math.min(255,Math.round(v*(1-.07*dk)*127.5));
    d[i*4+1]=Math.min(255,Math.round(v*127.5));
    d[i*4+2]=Math.min(255,Math.round(v*(1+.1*dk)*127.5));
    d[i*4+3]=255;
  }
  pg.putImageData(out,0,0);
  return pc;
}

/* Schattensaum: schwarze Ebene, deren Deckkraft zum Rand der Fläche hin leicht zunimmt. */
function edge(mask){
  var sc=Math.min(1,420/Math.max(mask.width,mask.height)),w=Math.max(8,Math.round(mask.width*sc)),h=Math.max(8,Math.round(mask.height*sc)),N=w*h,i;
  var c=canvasOf(w,h),g=c.getContext("2d");g.drawImage(mask,0,0,w,h);var md=g.getImageData(0,0,w,h).data;
  var inv=new Float32Array(N);for(i=0;i<N;i++)inv[i]=1-md[i*4+3]/255;
  var r=Math.max(2,Math.round(Math.max(w,h)*.007)),b=box(box(inv,w,h,r,new Float32Array(N)),w,h,r,new Float32Array(N));
  var out=g.createImageData(w,h),d=out.data;
  for(i=0;i<N;i++){d[i*4+3]=Math.round(Math.min(1,b[i]*1.5)*.34*255);}
  g.putImageData(out,0,0);
  return c;
}

root.HausRefine={refine:refine,shade:shade,edge:edge};
})(typeof window!=="undefined"?window:this);
