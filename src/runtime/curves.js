/* Pixel geometry is used only for analysis. Playback receives sampled cubic
   curves; no image-shaped clipping or source-image textures are rendered. */
function simplifyCurve(points,epsilon){
 if(points.length<=4)return points.slice();
 const n=points.length/2,keep=new Uint8Array(n),stack=[[0,n-1]];keep[0]=keep[n-1]=1;
 while(stack.length){const [a,b]=stack.pop(),ax=points[a*2],ay=points[a*2+1],dx=points[b*2]-ax,dy=points[b*2+1]-ay,den=dx*dx+dy*dy;let best=epsilon*epsilon,index=-1;
  for(let i=a+1;i<b;i++){const px=points[i*2]-ax,py=points[i*2+1]-ay,t=Math.max(0,Math.min(1,(px*dx+py*dy)/(den||1))),d=(px-t*dx)**2+(py-t*dy)**2;if(d>best){best=d;index=i;}}
  if(index>=0){keep[index]=1;stack.push([a,index],[index,b]);}
 }
 return points.filter((_,i)=>keep[i>>1]);
}
function smoothCurve(raw,closed=false,epsilon=.85){
 if(raw.length<6)return raw.slice();
 let p=raw.slice();if(closed&&(p[0]!==p.at(-2)||p[1]!==p.at(-1)))p.push(p[0],p[1]);
 p=simplifyCurve(p,epsilon);if(closed)p.splice(-2);
 const n=p.length/2;if(closed?n<3:n<2)return raw.slice();
 const point=i=>{i=closed?(i+n)%n:Math.max(0,Math.min(n-1,i));return [p[i*2],p[i*2+1]];};
 const tangent=i=>{const a=point(i-1),b=point(i),c=point(i+1),u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]],lu=Math.hypot(...u),lv=Math.hypot(...v);
  // Preserve intentional cusps (hair tips, corners); smooth gentle curvature.
  if(lu&&lv&&(u[0]*v[0]+u[1]*v[1])/(lu*lv)<.05)return [0,0];
  const dx=c[0]-a[0],dy=c[1]-a[1],length=Math.hypot(dx,dy)||1;return [dx/length,dy/length];};
 const out=[p[0],p[1]];
 for(let i=0;i<(closed?n:n-1);i++){const a=point(i),b=point(i+1),ta=tangent(i),tb=tangent(i+1),length=Math.hypot(b[0]-a[0],b[1]-a[1]),arm=length/3;
  const c=[a[0]+ta[0]*arm,a[1]+ta[1]*arm],d=[b[0]-tb[0]*arm,b[1]-tb[1]*arm],steps=Math.max(2,Math.ceil(length/.8));
  for(let j=1;j<=steps;j++){const t=j/steps,u=1-t;out.push(+(u*u*u*a[0]+3*u*u*t*c[0]+3*u*t*t*d[0]+t*t*t*b[0]).toFixed(2),+(u*u*u*a[1]+3*u*u*t*c[1]+3*u*t*t*d[1]+t*t*t*b[1]).toFixed(2));}
 }
 return out;
}
function curveLength(p){let length=0;for(let j=2;j<p.length;j+=2)length+=Math.hypot(p[j]-p[j-2],p[j+1]-p[j-1]);return length;}
function extractInk(input){
 const {width:W,height:H}=input,src=new Uint8ClampedArray(input.pixels),N=W*H,luma=new Float32Array(N),integral=new Float64Array((W+1)*(H+1)),stride=W+1;
 for(let y=0;y<H;y++){let row=0;for(let x=0;x<W;x++){const k=y*W+x;luma[k]=src[k*4]*.299+src[k*4+1]*.587+src[k*4+2]*.114;row+=luma[k];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}}
 const mask=new Uint8Array(N),radius=4;
 for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const k=y*W+x,x0=Math.max(0,x-radius),x1=Math.min(W,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(H,y+radius+1),avg=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
  if(luma[k]>190||avg-luma[k]<3)continue;
  let ridge=0;for(const r of [2,3,4])for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){const ax=x+dx*r,ay=y+dy*r,bx=x-dx*r,by=y-dy*r;if(ax<0||ay<0||ax>=W||ay>=H||bx<0||by<0||bx>=W||by>=H)continue;ridge=Math.max(ridge,Math.min(luma[ay*W+ax],luma[by*W+bx])-luma[k]);}
  if(ridge>6||(luma[k]<48&&avg-luma[k]>4))mask[k]=1;
 }
 // Zhang–Suen thinning turns dark ridges into single centre lines, so a dark
 // strip is drawn once rather than outlining both sides of each ink pixel.
 const offsets=[-W,-W+1,1,W+1,W,W-1,-1,-W-1];
 for(let round=0;round<35;round++){let changed=0;for(let pass=0;pass<2;pass++){const remove=[];
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const k=y*W+x;if(!mask[k])continue;const p=offsets.map(d=>mask[k+d]),count=p.reduce((a,b)=>a+b,0);if(count<2||count>6)continue;let transitions=0;for(let i=0;i<8;i++)if(!p[i]&&p[(i+1)%8])transitions++;if(transitions!==1)continue;
   if(pass===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;remove.push(k);
  }for(const k of remove)mask[k]=0;changed+=remove.length;
 }if(!changed)break;}
 const neighbors=k=>{const x=k%W,y=(k/W)|0,result=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=W||yy<0||yy>=H||!mask[yy*W+xx])continue;
   // Do not add a diagonal shortcut across an existing orthogonal connection.
   if(dx&&dy&&(mask[y*W+xx]||mask[yy*W+x]))continue;result.push(yy*W+xx);
  }return result;};
 // Remove tiny terminal spurs before tracing through junctions.
 for(let pass=0;pass<2;pass++)for(let k=0;k<N;k++)if(mask[k]&&neighbors(k).length===1){const branch=[k];let prev=-1,current=k;
  while(branch.length<=4){const ns=neighbors(current).filter(n=>n!==prev);if(ns.length!==1)break;prev=current;current=ns[0];if(neighbors(current).length>2){for(const p of branch)mask[p]=0;break;}branch.push(current);}
 }
 const seen=new Set(),paths=[];const edge=(a,b)=>Math.min(a,b)*N+Math.max(a,b);
 const trace=(a,b)=>{const path=[a%W+.5,((a/W)|0)+.5];let prev=a,current=b;seen.add(edge(a,b));
  for(let guard=0;guard<N;guard++){path.push(current%W+.5,((current/W)|0)+.5);if(current===a)break;const next=neighbors(current).filter(n=>!seen.has(edge(current,n)));if(!next.length)break;
   const back=Math.max(0,path.length-10),dx=current%W+.5-path[back],dy=((current/W)|0)+.5-path[back+1];
   next.sort((a,b)=>{const score=n=>{const ux=n%W-current%W,uy=((n/W)|0)-((current/W)|0);return (ux*dx+uy*dy)/(Math.hypot(ux,uy)||1);};return score(b)-score(a);});
   const n=next[0];seen.add(edge(current,n));prev=current;current=n;
  }
  if(curveLength(path)>=5)paths.push(smoothCurve(path,current===a,1.05));
 };
 for(let k=0;k<N;k++)if(mask[k]&&neighbors(k).length===1)for(const n of neighbors(k))if(!seen.has(edge(k,n)))trace(k,n);
 for(let k=0;k<N;k++)if(mask[k])for(const n of neighbors(k))if(!seen.has(edge(k,n)))trace(k,n);
 return paths;
}
