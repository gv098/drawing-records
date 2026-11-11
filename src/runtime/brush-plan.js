/* Unmasked brush painting: colour geometry guides paths but never clips paint.
   A coverage mask chooses the next nearby unpainted patch; no scan rows or bands. */
function planBrush(vector,report){
 const W=vector.width,H=vector.height,regions=vector.strokes.map((r,i)=>{
  const rings=r[2].filter(p=>{if(i<vector.stages[0].end)return true;let area=0;for(let j=0;j<p.length;j+=2){const k=(j+2)%p.length;area+=p[j]*p[k+1]-p[k]*p[j+1];}return Math.abs(area)>=6;}).map(p=>smoothCurve(p,true,i<vector.stages[0].end?1.5:.85));
  const b=[W,H,0,0];for(const p of rings)for(let j=0;j<p.length;j+=2){p[j]=Math.max(0,Math.min(W,p[j]));p[j+1]=Math.max(0,Math.min(H,p[j+1]));b[0]=Math.min(b[0],p[j]);b[1]=Math.min(b[1],p[j+1]);b[2]=Math.max(b[2],p[j]);b[3]=Math.max(b[3],p[j+1]);}
  return [r[0],r[1],rings,r[3],[Math.floor(b[0]),Math.floor(b[1]),Math.ceil(b[2]),Math.ceil(b[3])]];
 }),N=W*H;
 const stages=[],strokes=[],skip=new Set(),backgroundPaths=[],backgroundIds=[];
 const light=c=>((c>>16)&255)*.299+((c>>8)&255)*.587+(c&255)*.114;
 let background='#ffffff',previous=[W*.5,0],travel=0,maxJump=0,patches=0;
 for(let i=0;i<vector.strokes.length;i++){
  const r=regions[i],b=r[4],touches=b[0]<=1&&b[1]<=1&&b[2]>=W-1&&b[3]>=H-1;
  if(touches&&r[3]>N*.15&&light(r[0])>238){skip.add(i);if(i>=vector.stages[0].end){backgroundIds.push(i);backgroundPaths.push(...r[2]);background='#'+r[0].toString(16).padStart(6,'0');}}
 }
 const maskCanvas=new OffscreenCanvas(1,1),mc=maskCanvas.getContext('2d',{willReadFrequently:true});
 const excluded=new Path2D();
 for(const ring of backgroundPaths){excluded.moveTo(ring[0],ring[1]);for(let j=2;j<ring.length;j+=2)excluded.lineTo(ring[j],ring[j+1]);excluded.closePath();}
 const round=x=>Math.round(x*100)/100;
 function regionPlan(id,phase,cleanup=false){
  const r=regions[id],b=r[4],left=b[0],top=b[1],rw=b[2]-left,rh=b[3]-top;
  if(rw<=0||rh<=0)return;
  maskCanvas.width=rw;maskCanvas.height=rh;mc.setTransform(1,0,0,1,-left,-top);mc.fillStyle='#fff';
  const shape=new Path2D();for(const ring of r[2]){shape.moveTo(ring[0],ring[1]);for(let j=2;j<ring.length;j+=2)shape.lineTo(ring[j],ring[j+1]);shape.closePath();}
  mc.fill(shape,'evenodd');if(backgroundPaths.length&&!cleanup){mc.globalCompositeOperation='destination-out';mc.fill(excluded,'evenodd');mc.globalCompositeOperation='source-over';}
  const pixels=mc.getImageData(0,0,rw,rh).data;
  let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)count++;
  if(!count)return;
  if(phase===0&&count<45)return; // Fine islands are drawn in later passes.
  const maxWidth=Math.min([64,40,30,20,12][phase],Math.max([20,12,8,5,2][phase],Math.sqrt(count)*.23));
  // Distance to the source boundary guides brush size, never the renderer.
  // The first pass deliberately leaves narrow tendrils and tiny holes alone.
  const distance=new Float32Array(rw*rh),minimumDepth=cleanup?.5:[1.5,1.2,.7,.5,.5][phase];
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const k=y*rw+x;distance[k]=pixels[k*4+3]>64?Math.min(x+1,y+1,rw-x,rh-y,1000):0;}
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const k=y*rw+x;if(!distance[k])continue;let d=distance[k];if(x)d=Math.min(d,distance[k-1]+1);if(y)d=Math.min(d,distance[k-rw]+1);if(x&&y)d=Math.min(d,distance[k-rw-1]+1.414);if(y&&x+1<rw)d=Math.min(d,distance[k-rw+1]+1.414);distance[k]=d;}
  for(let y=rh-1;y>=0;y--)for(let x=rw-1;x>=0;x--){const k=y*rw+x;if(!distance[k])continue;let d=distance[k];if(x+1<rw)d=Math.min(d,distance[k+1]+1);if(y+1<rh)d=Math.min(d,distance[k+rw]+1);if(x+1<rw&&y+1<rh)d=Math.min(d,distance[k+rw+1]+1.414);if(x&&y+1<rh)d=Math.min(d,distance[k+rw-1]+1.414);distance[k]=d;}
  const depthAt=(x,y)=>{x=Math.floor(x-left);y=Math.floor(y-top);return x<0||y<0||x>=rw||y>=rh?0:Math.max(0,distance[y*rw+x]-.45);};
  const cell=[5,3,2,2,1][phase],gw=Math.ceil(rw/cell),gh=Math.ceil(rh/cell),alive=new Uint8Array(gw*gh),depth=new Float32Array(gw*gh),rx=new Float32Array(gw*gh),ry=new Float32Array(gw*gh);
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const d=distance[y*rw+x]-.45;if(d<minimumDepth||(cleanup&&d>Math.max(15,Math.max(W,H)*.055)))continue;const k=Math.floor(y/cell)*gw+Math.floor(x/cell);if(d>depth[k]){alive[k]=1;depth[k]=d;rx[k]=left+x+.5;ry[k]=top+y+.5;}}
  const visited=new Uint8Array(alive.length),components=[];
  const xy=k=>[rx[k],ry[k]];
  for(let seed=0;seed<alive.length;seed++){
   if(!alive[seed]||visited[seed])continue;
   // Keep expensive nearest-point searches within a local connected patch.
   // The brush still covers every live cell, without row-by-row strokes.
   const tileX=Math.floor((seed%gw)/32),tileY=Math.floor(Math.floor(seed/gw)/32);
   const members=[seed];visited[seed]=1;
   for(let q=0;q<members.length;q++){const k=members[q],x=k%gw,y=Math.floor(k/gw);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,n=yy*gw+xx;if(xx<0||xx>=gw||yy<0||yy>=gh||Math.floor(xx/32)!==tileX||Math.floor(yy/32)!==tileY||visited[n]||!alive[n])continue;visited[n]=1;members.push(n);}
   }
   let sx=0,sy=0;for(const k of members){const [x,y]=xy(k);sx+=x;sy+=y;}const cx=sx/members.length,cy=sy/members.length;
   let xx=0,yy=0,cross=0;for(const k of members){const [x,y]=xy(k);xx+=(x-cx)**2;yy+=(y-cy)**2;cross+=(x-cx)*(y-cy);}
   components.push({members,cx,cy,angle:.5*Math.atan2(2*cross,xx-yy)});
  }
  // Finish connected patches locally, without drawing a connector across gaps.
  while(components.length){
   let next=0,best=Infinity;for(let i=0;i<components.length;i++){const c=components[i],score=Math.hypot(c.cx-previous[0],c.cy-previous[1]);if(score<best){best=score;next=i;}}
   const c=components.splice(next,1)[0],block=patches++;let remaining=c.members.reduce((n,k)=>n+alive[k],0),gesture=0,tip=previous,anchor=null,patchAngle=c.angle;
   while(remaining>0){
    let target=-1,nearest=Infinity;
    // Stay around a small working patch for several strokes. Do not trace the
    // expanding paint frontier continuously with the previous pen endpoint.
    const focus=anchor&&gesture%4?anchor:tip;
    for(const k of c.members){if(!alive[k])continue;const [x,y]=xy(k);const score=(x-focus[0])**2+(y-focus[1])**2-depth[k]*depth[k]*5;if(score<nearest){nearest=score;target=k;}}
    const [cx,cy]=xy(target);let width=Math.max(phase>=3?1.8:1,Math.min(maxWidth,depth[target]*1.7));
    if(!anchor||gesture%4===0||nearest>width*width*2){
     anchor=[cx,cy];let sx=0,sy=0,n=0,xx=0,yy=0,xySum=0;
     for(const k of c.members){const [x,y]=xy(k),dx=x-cx,dy=y-cy;if(dx*dx+dy*dy>width*width*2.25)continue;sx+=dx;sy+=dy;xx+=dx*dx;yy+=dy*dy;xySum+=dx*dy;n++;}
     if(n>2){xx-=sx*sx/n;yy-=sy*sy/n;xySum-=sx*sy/n;patchAngle=.5*Math.atan2(2*xySum,xx-yy);}
    }
    const hash=Math.sin(id*91.17+gesture*17.31+block*3.7)*43758.5453,variation=hash-Math.floor(hash);
    let angle=patchAngle+(variation-.5)*.34;
    // Prefer starting from the upper endpoint of this local gesture. Each path
    // is an open sweep, not a loop or a connector to the preceding stroke.
    if(Math.sin(angle)<0)angle+=Math.PI;
    const ca=Math.cos(angle),sa=Math.sin(angle);let points=[],span=width*(1.2+variation*.9);
    // Fit a whole smooth gesture and its full brush footprint inside the
    // available space. No per-pixel opacity stencil is exported or replayed.
    for(let attempt=0;attempt<9;attempt++){
     const bend=span*(.025+variation*.035)*(gesture%2?1:-1);points=[];let fits=true;
     for(let j=0;j<=12;j++){
      const t=j/12,u=(t-.5)*span,v=(4*t*(1-t)-1)*bend,pressure=(.9+.08*variation)*Math.sin(Math.PI*t)**.3;
      const x=cx+u*ca-v*sa,y=cy+u*sa+v*ca;
      if(j>0&&j<12&&depthAt(x,y)+(phase>=3?.65:0)<width*(.12+.88*pressure)*.5)fits=false;
      points.push(round(x),round(y),round(pressure));
     }
     if(fits||attempt===8)break;if(attempt<5)span*=.65;else{width=Math.max(phase>=3?1.8:.7,width*.85);span*=.85;}
    }
    let length=0;for(let j=3;j<points.length;j+=3)length+=Math.hypot(points[j]-points[j-3],points[j+1]-points[j-2]);
    // Erase only the conservatively covered core; uncovered edges produce
    // another nearby sweep rather than a final shape fill or scanline cleanup.
    for(let j=0;j<points.length;j+=3){
     const x=points[j],y=points[j+1],radius=Math.max(.5,width*(.12+.88*points[j+2])*.36-cell*.71);
     const x0=Math.max(0,Math.floor((x-left-radius)/cell)),x1=Math.min(gw-1,Math.floor((x-left+radius)/cell));
     const y0=Math.max(0,Math.floor((y-top-radius)/cell)),y1=Math.min(gh-1,Math.floor((y-top+radius)/cell));
     for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){const k=yy*gw+xx;if(!alive[k])continue;const [px,py]=xy(k);if((px-x)**2+(py-y)**2<=radius*radius)alive[k]=0;}
    }
    // The sweep passes within its opaque brush core of the target cell.
    alive[target]=0;remaining=0;for(const k of c.members)remaining+=alive[k];
    
    const s={region:id,block,phase,width:round(width),points,length:round(length),liftMs:Math.round(75+variation*65)};
    const jump=Math.hypot(points[0]-previous[0],points[1]-previous[1]);travel+=jump;maxJump=Math.max(maxJump,jump);
    strokes.push(s);previous=points.slice(-3,-1);tip=previous;gesture++;
   }
  }
  // Later passes explicitly draw missing boundaries with a fine brush. These
  // are replayable pen paths, not a clipping mask or an instantaneous fill.
  if(phase<4){
   const edgeWidth=[2.2,2,1.7,1.5][phase];
   for(const ring of r[2]){
    if(ring.length<6)continue;
    let chunk=[],chunkLength=0;
    const emit=()=>{
     if(chunk.length<6||chunkLength<.1){chunk=[];chunkLength=0;return;}
     let distance=0;for(let j=0;j<chunk.length;j+=3){if(j)distance+=Math.hypot(chunk[j]-chunk[j-3],chunk[j+1]-chunk[j-2]);chunk[j+2]=round(Math.min(1,distance/1.2,(chunkLength-distance)/1.2));}
     chunk[2]=0;chunk[chunk.length-1]=0;
     const s={region:id,block:patches++,phase,width:edgeWidth,points:chunk,length:round(chunkLength),liftMs:90,kind:'edge'};
     const jump=Math.hypot(chunk[0]-previous[0],chunk[1]-previous[1]);travel+=jump;maxJump=Math.max(maxJump,jump);strokes.push(s);previous=chunk.slice(-3,-1);chunk=[];chunkLength=0;
    };
    for(let j=0;j<=ring.length;j+=2){const k=j%ring.length,x=ring[k],y=ring[k+1];
     if(!chunk.length){chunk.push(x,y,0);continue;}
     const a=chunk.slice(-3),len=Math.hypot(x-a[0],y-a[1]),steps=Math.max(1,Math.ceil(len/1.5));
     for(let n=1;n<=steps;n++){const px=round(a[0]+(x-a[0])*n/steps),py=round(a[1]+(y-a[1])*n/steps);const last=chunk.slice(-3);chunkLength+=Math.hypot(px-last[0],py-last[1]);chunk.push(px,py,1);if(chunkLength>55){emit();chunk.push(px,py,0);}}
    }emit();
   }
  }

 }
 const lines=planLineStages(vector.inkPaths||[],regions,W,H);strokes.push(...lines.strokes);stages.push(...lines.stages);
 report({type:'progress',progress:.1,stage:'草稿与平滑线稿',count:strokes.length});
 const paintStart=strokes.length;
 for(let phase=0;phase<vector.stages.length;phase++){
  const start=strokes.length,source=vector.stages[phase],ids=[];
  // The intermediate 24-colour layer belongs to smooth multiscale filling.
  // Hand-painted mode keeps its coarser underpainting to avoid outlining and
  // texturing more than a thousand overlapping colour regions twice.
  const sourceEnd=phase===0&&vector.stats?.coarseRegions?source.start+vector.stats.coarseRegions:source.end;
  for(let id=source.start;id<sourceEnd;id++)if(!skip.has(id)&&regions[id][2].length)ids.push(id);
  previous=[W*.5,0];
  if(phase===1)for(const id of backgroundIds)regionPlan(id,1,true);
  while(ids.length){
   let next=0,best=Infinity;for(let i=0;i<ids.length;i++){const b=regions[ids[i]][4],x=Math.max(b[0],Math.min(b[2],previous[0])),y=Math.max(b[1],Math.min(b[3],previous[1]));const score=Math.hypot(x-previous[0],y-previous[1])+.08*b[1];if(score<best){best=score;next=i;}}
   regionPlan(ids.splice(next,1)[0],phase);
   if(ids.length%20===0)report({type:'progress',progress:.1+.9*(phase+1-ids.length/Math.max(1,source.end-source.start))/vector.stages.length,stage:phase===0?'在线稿下铺底色':'阴影、高光与细节',count:strokes.length});
  }
  for(let i=start;i<strokes.length;i++){strokes[i].paintPass=phase;strokes[i].phase=phase===0?2:3;strokes[i].layer='paint';}
  if(phase===0)stages.push({name:'底色 · 逐块铺色',role:'base',start,end:strokes.length,kind:'brush',length:Math.round(strokes.slice(start).reduce((n,s)=>n+s.length,0))});
 }
 const detailStart=stages[2].end;
 stages.push({name:'阴影高光 · 局部细化',role:'detail',start:detailStart,end:strokes.length,kind:'brush',length:Math.round(strokes.slice(detailStart).reduce((n,s)=>n+s.length,0))});
 return {version:4,revision:9,width:W,height:H,background,backgroundPaths,algorithm:'smooth-lineart-layered-painting',mode:'brush',fillSource:{regions:vector.strokes,stages:vector.stages,stats:vector.stats},regions,strokes,stages,unmasked:true,layers:['paint','sketch','ink'],stats:{...vector.stats,brushStrokes:strokes.length,sketchStrokes:stages[0].end,inkStrokes:stages[1].end-stages[1].start,baseStrokes:stages[2].end-stages[2].start,patches,travel:Math.round(travel),maxJump:Math.round(maxJump)},brush:{spacing:.10,flow:.94,hardness:.84,pressure:'simulated'}};
}
