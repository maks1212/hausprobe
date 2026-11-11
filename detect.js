/* Flächenerkennung: von einem angetippten Punkt aus die zusammenhängende Fläche ähnlicher Farbe suchen
   und als Vieleck mit wenigen Ecken zurückgeben. Reine Funktion ohne DOM, damit sie sich einzeln testen lässt. */
(function(root){
"use strict";

function morph(m,w,h,r,grow){
  var a=m,b,i,x,y,v,k;
  for(k=0;k<r;k++){
    b=new Uint8Array(w*h);
    for(y=0;y<h;y++)for(x=0;x<w;x++){
      i=y*w+x;
      if(grow)v=a[i]||(x>0&&a[i-1])||(x<w-1&&a[i+1])||(y>0&&a[i-w])||(y<h-1&&a[i+w]);
      else v=a[i]&&x>0&&a[i-1]&&x<w-1&&a[i+1]&&y>0&&a[i-w]&&y<h-1&&a[i+w];
      b[i]=v?1:0;
    }
    a=b;
  }
  return a;
}
function flood(m,w,h,start){
  var comp=new Uint8Array(w*h),stack=new Int32Array(w*h),n=0,count=0,i,x;
  stack[n++]=start;comp[start]=1;
  while(n){
    i=stack[--n];count++;x=i%w;
    if(x>0&&m[i-1]&&!comp[i-1]){comp[i-1]=1;stack[n++]=i-1;}
    if(x<w-1&&m[i+1]&&!comp[i+1]){comp[i+1]=1;stack[n++]=i+1;}
    if(i>=w&&m[i-w]&&!comp[i-w]){comp[i-w]=1;stack[n++]=i-w;}
    if(i<w*(h-1)&&m[i+w]&&!comp[i+w]){comp[i+w]=1;stack[n++]=i+w;}
  }
  return {comp:comp,count:count};
}
function nearest(m,w,h,px,py,R){
  var best=-1,bd=1e9,x,y,d;
  for(y=Math.max(0,py-R);y<=Math.min(h-1,py+R);y++)for(x=Math.max(0,px-R);x<=Math.min(w-1,px+R);x++){
    if(m[y*w+x]){d=(x-px)*(x-px)+(y-py)*(y-py);if(d<bd){bd=d;best=y*w+x;}}
  }
  return best;
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
function lineDist(p,a,b){
  var dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
  return l<1e-9?Math.hypot(p[0]-a[0],p[1]-a[1]):Math.abs(dy*(p[0]-a[0])-dx*(p[1]-a[1]))/l;
}
function dp(pts,eps){
  if(pts.length<3)return pts.slice();
  var a=pts[0],b=pts[pts.length-1],mx=0,mi=-1,i,d;
  for(i=1;i<pts.length-1;i++){d=lineDist(pts[i],a,b);if(d>mx){mx=d;mi=i;}}
  if(mx<=eps)return [a,b];
  return dp(pts.slice(0,mi+1),eps).slice(0,-1).concat(dp(pts.slice(mi),eps));
}
/* Hülle auf ihre echten Ecken reduzieren (höchstens sechs). */
function simplify(hull){
  if(hull.length<=4)return hull;
  var i0=0,i1=0,md=-1,i,d,n=hull.length,x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(i=0;i<n;i++){
    if(hull[i][0]<hull[i0][0])i0=i;
    x0=Math.min(x0,hull[i][0]);x1=Math.max(x1,hull[i][0]);y0=Math.min(y0,hull[i][1]);y1=Math.max(y1,hull[i][1]);
  }
  for(i=0;i<n;i++){d=Math.hypot(hull[i][0]-hull[i0][0],hull[i][1]-hull[i0][1]);if(d>md){md=d;i1=i;}}
  var rot=hull.slice(i0).concat(hull.slice(0,i0)),j=(i1-i0+n)%n;
  var A=rot.slice(0,j+1),B=rot.slice(j).concat([rot[0]]),eps=.02*Math.hypot(x1-x0,y1-y0),out=hull,t;
  for(t=0;t<14;t++){out=dp(A,eps).concat(dp(B,eps).slice(1,-1));if(out.length<=6)break;eps*=1.35;}
  /* Fast deckungsgleiche Ecken zusammenlegen; es bleibt die äußere. */
  var cx=0,cy=0,lim=.05*Math.hypot(x1-x0,y1-y0),again=true,a,b,k;
  out.forEach(function(v){cx+=v[0];cy+=v[1];});cx/=out.length;cy/=out.length;
  while(again&&out.length>4){
    again=false;
    for(k=0;k<out.length;k++){
      a=out[k];b=out[(k+1)%out.length];
      if(Math.hypot(a[0]-b[0],a[1]-b[1])<lim){
        out.splice(Math.hypot(a[0]-cx,a[1]-cy)>=Math.hypot(b[0]-cx,b[1]-cy)?(k+1)%out.length:k,1);again=true;break;
      }
    }
  }
  return out.length>=3?out:hull;
}
function area(P){var a=0,i,n;for(i=0;i<P.length;i++){n=P[(i+1)%P.length];a+=P[i][0]*n[1]-n[0]*P[i][1];}return Math.abs(a)/2;}

/* img: {data: RGBA, w, h}; sx, sy: angetippter Punkt 0..1; tol: Farbtoleranz (ca. 10..70). */
function detect(img,sx,sy,tol){
  if(!img)return null;
  var w=img.w,h=img.h,d=img.data,n=w*h,i,x,y,r,g,b;
  var px=Math.min(w-1,Math.max(0,Math.floor(sx*w))),py=Math.min(h-1,Math.max(0,Math.floor(sy*h)));
  var Y=new Float32Array(n),Cb=new Float32Array(n),Cr=new Float32Array(n);
  for(i=0;i<n;i++){r=d[i*4];g=d[i*4+1];b=d[i*4+2];Y[i]=.299*r+.587*g+.114*b;Cb[i]=(b-Y[i])*.564;Cr[i]=(r-Y[i])*.713;}
  var y0=0,b0=0,r0=0,c=0;
  for(y=Math.max(0,py-2);y<=Math.min(h-1,py+2);y++)for(x=Math.max(0,px-2);x<=Math.min(w-1,px+2);x++){i=y*w+x;y0+=Y[i];b0+=Cb[i];r0+=Cr[i];c++;}
  y0/=c;b0/=c;r0/=c;
  /* Helligkeit zählt nur halb, damit Schatten auf derselben Fläche nicht abreißen. */
  var mask=new Uint8Array(n),dy,db,dr,t2=tol*tol;
  for(i=0;i<n;i++){dy=(Y[i]-y0)*.5;db=Cb[i]-b0;dr=Cr[i]-r0;mask[i]=dy*dy+db*db+dr*dr<t2?1:0;}
  var closed=morph(morph(mask,w,h,1,true),w,h,1,false);
  /* Erst schrumpfen: trennt schmale Brücken zu gleichfarbigen Nachbarflächen. */
  var er=morph(closed,w,h,2,false),base=er,s=nearest(er,w,h,px,py,8);
  if(s<0){base=closed;s=nearest(closed,w,h,px,py,4);if(s<0)return null;}
  var f=flood(base,w,h,s),comp=f.comp;
  if(base===er){var gr=morph(comp,w,h,2,true);for(i=0;i<n;i++)gr[i]=gr[i]&&closed[i]?1:0;comp=gr;}
  var edge=[],cnt=0;
  for(y=0;y<h;y++)for(x=0;x<w;x++){
    i=y*w+x;if(!comp[i])continue;cnt++;
    if(x===0||x===w-1||y===0||y===h-1||!comp[i-1]||!comp[i+1]||!comp[i-w]||!comp[i+w])edge.push([x,y]);
  }
  if(cnt<16)return null;
  var hull=convexHull(edge);if(hull.length<3)return null;
  var poly=simplify(hull),ha=area(hull);

  /* Löcher in der Fläche (Fenster, Türen, Kamin) als Aussparungen vorschlagen. */
  var inside=new Uint8Array(n),k,p,q,lo,hi,xx;
  for(y=0;y<h;y++){
    lo=1e9;hi=-1e9;
    for(k=0;k<hull.length;k++){
      p=hull[k];q=hull[(k+1)%hull.length];
      if(p[1]===q[1]){if(p[1]===y){lo=Math.min(lo,p[0],q[0]);hi=Math.max(hi,p[0],q[0]);}continue;}
      if((y-p[1])*(y-q[1])<=0){xx=p[0]+(q[0]-p[0])*(y-p[1])/(q[1]-p[1]);lo=Math.min(lo,xx);hi=Math.max(hi,xx);}
    }
    for(x=Math.ceil(lo);x<=Math.floor(hi);x++)if(x>=0&&x<w)inside[y*w+x]=1;
  }
  var cand=new Uint8Array(n),seen=new Uint8Array(n),holes=[],stack=new Int32Array(n);
  for(i=0;i<n;i++)cand[i]=inside[i]&&!comp[i]?1:0;
  for(var st=0;st<n;st++){
    if(!cand[st]||seen[st])continue;
    var top=0,a=0,bx0=1e9,by0=1e9,bx1=-1,by1=-1,open=false,j,nb,m;
    stack[top++]=st;seen[st]=1;
    while(top){
      i=stack[--top];a++;x=i%w;y=(i-x)/w;
      if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;
      nb=[x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1];
      for(j=0;j<4;j++){m=nb[j];if(m<0||!inside[m]){open=true;continue;}if(cand[m]&&!seen[m]){seen[m]=1;stack[top++]=m;}}
    }
    var bw=bx1-bx0+1,bh=by1-by0+1;
    if(!open&&a>=Math.max(20,.004*ha)&&Math.min(bw,bh)>=4&&a/(bw*bh)>=.55)holes.push({a:a,r:[bx0-.5,by0-.5,bx1+1.5,by1+1.5]});
  }
  holes.sort(function(u,v){return v.a-u.a;});holes=holes.slice(0,10);

  var cx=0,cy=0;poly.forEach(function(v){cx+=v[0];cy+=v[1];});cx/=poly.length;cy/=poly.length;
  function norm(X,Y2){return {x:Math.min(1,Math.max(0,X/w)),y:Math.min(1,Math.max(0,Y2/h))};}
  return {
    pts:poly.map(function(v){var l=Math.hypot(v[0]-cx,v[1]-cy)||1;return norm(v[0]+.5+(v[0]-cx)/l*1.2,v[1]+.5+(v[1]-cy)/l*1.2);}),
    holes:holes.map(function(o){var R=o.r;return [norm(R[0],R[1]),norm(R[2],R[1]),norm(R[2],R[3]),norm(R[0],R[3])];}),
    share:cnt/n
  };
}

var api={detect:detect};
if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.HausDetect=api;
})(typeof window!=="undefined"?window:this);
