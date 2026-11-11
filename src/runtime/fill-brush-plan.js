/* Turn vector colour regions into visible, structure-following brushwork.
   Masks keep broad underpainting inside its subject. Fine marks use paths that
   fit inside the region, so their visible shape is made by the brush itself. */
function progressiveBaseFill(input){
 if(input.mode!=='fill'||input.revision>=15)return input;
 const W=input.width,H=input.height,N=W*H,regions=input.regions,strokes=[],stages=[];
 const raster=new OffscreenCanvas(1,1),rc=raster.getContext('2d',{willReadFrequently:true});
 const round=v=>Math.round(v*100)/100;
 const colorDistance=(a,b)=>Math.hypot(((a>>16)&255)-((b>>16)&255),((a>>8)&255)-((b>>8)&255),(a&255)-(b&255));
 const center=id=>{const b=regions[id][4];return [(b[0]+b[2])/2,(b[1]+b[3])/2];};
 const idsOf=s=>(s.regions||[s.region]).filter(id=>Number.isInteger(id)&&regions[id]);
 const source=role=>{const stage=input.stages.find(s=>s.role===role);return stage?input.strokes.slice(stage.start,stage.end):[];};
 const addStage=(role,name,fn)=>{const start=strokes.length;fn();stages.push({role,name,start,end:strokes.length,kind:'brush',length:strokes.slice(start).reduce((n,s)=>n+(s.length||0),0)});};

 // Preserve the carefully smoothed outline stages. Paint stages are rebuilt
 // from unique regions, not from the previous planner's repeated cover marks.
 for(const role of ['sketch','ink']){
  const old=input.stages.find(s=>s.role===role);if(!old)continue;
  addStage(role,old.name,()=>strokes.push(...source(role).filter(s=>s.layer!=='paint').map(s=>({...s}))));
 }

 const assignments=new Map();
 function remember(id,pass,block){
  if(!regions[id]||assignments.has(id))return;
  assignments.set(id,{id,pass,block:block??assignments.size});
 }
 for(const step of source('base'))for(const id of idsOf(step))remember(id,'base',step.workBlock??step.block);
 const refinements=['tone','detail','finish'].flatMap(source),legacyDetail=source('detail');
 for(const step of refinements.length?refinements:legacyDetail){
  for(const id of idsOf(step)){
   if(assignments.has(id))continue;
   const r=regions[id],b=r[4],area=r[3],box=Math.max(1,(b[2]-b[0])*(b[3]-b[1])),density=area/box;
   const luma=((r[0]>>16)&255)*.299+((r[0]>>8)&255)*.587+(r[0]&255)*.114;
   const tiny=Math.max(8,N*.00002),pass=area>=Math.max(110,N*.0008)&&density>.14?'tone':area<tiny&&(luma>210||luma<42)?'finish':'detail';
   remember(id,pass,step.workBlock??step.block);
  }
 }
 for(const step of legacyDetail)for(const id of idsOf(step))if(!assignments.has(id))remember(id,'detail',step.workBlock??step.block);

 const configs={
  base:{min:7,max:64,area:.24,thickness:1.15,cell:.38,target:.995,maxSpan:6.2,masked:true},
  tone:{min:6,max:34,area:.17,thickness:.95,cell:.40,target:.995,maxSpan:5.4,masked:true},
  detail:{min:4.5,max:18,area:.16,thickness:.90,cell:.40,target:.975,maxSpan:5.2,masked:true},
  finish:{min:1.25,max:8,area:.11,thickness:.68,cell:.42,target:.94,maxSpan:4.5,masked:false}
 };
 let previous=[W*.48,H*.16],serial=0,skippedResidual=0,unmaskedFine=0,maskedFine=0;

 function maskFor(id,cell){
  const region=regions[id],b=region[4],left=Math.floor(b[0]),top=Math.floor(b[1]);
  const rw=Math.max(1,Math.ceil(b[2])-left),rh=Math.max(1,Math.ceil(b[3])-top);
  raster.width=rw;raster.height=rh;rc.setTransform(1,0,0,1,-left,-top);rc.clearRect(left,top,rw,rh);
  const path=new Path2D();for(const ring of region[2]){path.moveTo(ring[0],ring[1]);for(let i=2;i<ring.length;i+=2)path.lineTo(ring[i],ring[i+1]);path.closePath();}
  rc.fillStyle='#fff';rc.fill(path,'evenodd');
  const pixels=rc.getImageData(0,0,rw,rh).data,gw=Math.max(1,Math.ceil(rw/cell)),gh=Math.max(1,Math.ceil(rh/cell));
  const inside=new Uint8Array(gw*gh),alive=new Set();
  for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
   const px=Math.min(rw-1,Math.max(0,Math.floor((gx+.5)*cell))),py=Math.min(rh-1,Math.max(0,Math.floor((gy+.5)*cell)));
   if(pixels[(py*rw+px)*4+3]>96){const k=gy*gw+gx;inside[k]=1;alive.add(k);}
  }
  const at=(x,y)=>{const px=Math.floor(x-left),py=Math.floor(y-top);return px>=0&&py>=0&&px<rw&&py<rh&&pixels[(py*rw+px)*4+3]>96;};
  return {left,top,rw,rh,gw,gh,cell,inside,alive,total:alive.size,at,point:k=>[left+(k%gw+.5)*cell,top+(Math.floor(k/gw)+.5)*cell]};
 }

 function regionAngle(grid){
  let sx=0,sy=0,n=0;for(const k of grid.alive){const p=grid.point(k);sx+=p[0];sy+=p[1];n++;}if(n<2)return 0;
  const mx=sx/n,my=sy/n;let xx=0,xy=0,yy=0;for(const k of grid.alive){const p=grid.point(k),x=p[0]-mx,y=p[1]-my;xx+=x*x;xy+=x*y;yy+=y*y;}
  return .5*Math.atan2(2*xy,xx-yy);
 }
 function localAngle(grid,x,y,fallback){
  const gx=Math.floor((x-grid.left)/grid.cell),gy=Math.floor((y-grid.top)/grid.cell),radius=5;
  let sx=0,sy=0,n=0;for(let yy=Math.max(0,gy-radius);yy<=Math.min(grid.gh-1,gy+radius);yy++)for(let xx=Math.max(0,gx-radius);xx<=Math.min(grid.gw-1,gx+radius);xx++)if(grid.inside[yy*grid.gw+xx]){sx+=xx;sy+=yy;n++;}
  if(n<5)return fallback;const mx=sx/n,my=sy/n;let a=0,b=0,c=0;for(let yy=Math.max(0,gy-radius);yy<=Math.min(grid.gh-1,gy+radius);yy++)for(let xx=Math.max(0,gx-radius);xx<=Math.min(grid.gw-1,gx+radius);xx++)if(grid.inside[yy*grid.gw+xx]){const dx=xx-mx,dy=yy-my;a+=dx*dx;b+=dx*dy;c+=dy*dy;}
  if(Math.abs(a-c)+Math.abs(b)<.2)return fallback;let angle=.5*Math.atan2(2*b,a-c);while(angle-fallback>Math.PI/2)angle-=Math.PI;while(angle-fallback<-Math.PI/2)angle+=Math.PI;return angle;
 }
 function diskFits(grid,x,y,r){
  if(!grid.at(x,y))return false;for(let i=0;i<12;i++){const a=i*Math.PI/6;if(!grid.at(x+Math.cos(a)*r,y+Math.sin(a)*r))return false;}return true;
 }
 function safeWidth(grid,points,nominal){
  let width=nominal;for(;width>=.8;width*=.78){const radius=width*.52;if(points.every((p,i)=>i%3||diskFits(grid,p,points[i+1],radius)))return width;}return .72;
 }
 function removeCovered(grid,points,width){
  const radius=Math.max(grid.cell*.55,width*.52),rr=radius*radius;let removed=0;
  for(const k of Array.from(grid.alive)){const p=grid.point(k);for(let i=3;i<points.length;i+=3){const ax=points[i-3],ay=points[i-2],bx=points[i],by=points[i+1],dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((p[0]-ax)*dx+(p[1]-ay)*dy)/(dx*dx+dy*dy||1)));if((p[0]-ax-t*dx)**2+(p[1]-ay-t*dy)**2<=rr){grid.alive.delete(k);removed++;break;}}}
  return removed;
 }
 function chooseSeed(grid,focus){let seed=-1,best=Infinity;for(const k of grid.alive){const p=grid.point(k),gx=k%grid.gw,gy=(k/grid.gw)|0;let neighbours=0;for(let y=Math.max(0,gy-1);y<=Math.min(grid.gh-1,gy+1);y++)for(let x=Math.max(0,gx-1);x<=Math.min(grid.gw-1,gx+1);x++)if(grid.alive.has(y*grid.gw+x))neighbours++;
   const distance=Math.hypot(p[0]-focus[0],p[1]-focus[1]),score=distance-neighbours*grid.cell*2.2;if(score<best){best=score;seed=k;}}return seed;}
 function grow(grid,seed,angle,width,maxSpan,id,gesture){
  const start=grid.point(seed),step=Math.max(grid.cell*.85,width*.46),limit=Math.max(3,Math.ceil(maxSpan*width/step));
  function side(sign){
   const out=[];let x=start[0],y=start[1],heading=angle+(sign<0?Math.PI:0);
   for(let i=0;i<limit;i++){
    const local=localAngle(grid,x,y,heading),phase=Math.sin(id*1.73+gesture*.91+i*.58)*(width>3?.04:.08);
    let delta=local-heading;while(delta>Math.PI/2)delta-=Math.PI;while(delta<-Math.PI/2)delta+=Math.PI;
    if(Math.abs(delta)>.72&&i>1)break;heading+=Math.max(-.18,Math.min(.18,delta*.42))+phase;
    const nx=x+Math.cos(heading)*step,ny=y+Math.sin(heading)*step;if(!grid.at(nx,ny))break;
    out.push([nx,ny,1]);x=nx;y=ny;
   }return out;
  }
  return side(-1).reverse().concat([[start[0],start[1],1]],side(1)).flat();
 }

 // Thin a narrow colour shape to its centre line. This joins a chain of tiny
 // residual cells into one deliberate mark instead of a row of separate dabs.
 function skeletonPaths(grid){
  const {gw,gh,inside,cell,left,top}=grid,size=gw*gh,mask=inside.slice(),offsets=[-gw,-gw+1,1,gw+1,gw,gw-1,-1,-gw-1];
  if(size>450000)return [];
  for(let round=0;round<24;round++){let changed=0;for(let pass=0;pass<2;pass++){const remove=[];
   for(let y=1;y<gh-1;y++)for(let x=1;x<gw-1;x++){const k=y*gw+x;if(!mask[k])continue;const p=offsets.map(d=>mask[k+d]),count=p.reduce((a,b)=>a+b,0);if(count<2||count>6)continue;let transitions=0;for(let i=0;i<8;i++)if(!p[i]&&p[(i+1)%8])transitions++;if(transitions!==1)continue;
    if(pass===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;remove.push(k);
   }for(const k of remove)mask[k]=0;changed+=remove.length;
  }if(!changed)break;}
  const neighbours=k=>{const x=k%gw,y=(k/gw)|0,result=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=gw||yy<0||yy>=gh||!mask[yy*gw+xx])continue;if(dx&&dy&&(mask[y*gw+xx]||mask[yy*gw+x]))continue;result.push(yy*gw+xx);}return result;};
  const seen=new Set(),paths=[],edge=(a,b)=>Math.min(a,b)*size+Math.max(a,b);
  function trace(a,b){const cells=[a];let current=b;seen.add(edge(a,b));for(let guard=0;guard<size;guard++){cells.push(current);const next=neighbours(current).filter(n=>!seen.has(edge(current,n)));if(!next.length)break;
    const back=cells[Math.max(0,cells.length-5)],dx=current%gw-back%gw,dy=((current/gw)|0)-((back/gw)|0);next.sort((u,v)=>{const score=n=>((n%gw-current%gw)*dx+(((n/gw)|0)-((current/gw)|0))*dy)/(Math.hypot(n%gw-current%gw,((n/gw)|0)-((current/gw)|0))||1);return score(v)-score(u);});
    const n=next[0];seen.add(edge(current,n));current=n;
   }if(cells.length>=3){const points=[];for(const k of cells)points.push(left+(k%gw+.5)*cell,top+(((k/gw)|0)+.5)*cell,1);paths.push(points);}}
  for(let k=0;k<size;k++)if(mask[k]&&neighbours(k).length===1)for(const n of neighbours(k))if(!seen.has(edge(k,n)))trace(k,n);
  for(let k=0;k<size;k++)if(mask[k])for(const n of neighbours(k))if(!seen.has(edge(k,n)))trace(k,n);
  return paths;
 }

 function paintRegion(item){
  const {id,pass,block}=item,region=regions[id],b=region[4],cfg=configs[pass],boxW=Math.max(1,b[2]-b[0]),boxH=Math.max(1,b[3]-b[1]);
  if(pass!=='base'&&region[3]<1.5){skippedResidual+=region[3];return;}
  const thickness=region[3]/Math.max(boxW,boxH),width=Math.max(cfg.min,Math.min(cfg.max,Math.sqrt(region[3])*cfg.area,thickness*cfg.thickness));
  const density=region[3]/Math.max(1,boxW*boxH),freehand=pass==='finish'&&thickness<2.5&&Math.max(boxW,boxH)>5&&density<.34;
  const maskedRegion=cfg.masked||!freehand,grid=maskFor(id,Math.max(.8,width*cfg.cell));if(!grid.total)return;
  const luma=((region[0]>>16)&255)*.299+((region[0]>>8)&255)*.587+(region[0]&255)*.114,paper=(pass==='base'||pass==='tone')&&region[3]>N*.12&&luma>242;
  const target=paper?1:freehand?.86:cfg.target,fallback=regionAngle(grid),goal=Math.ceil(grid.total*(1-target));let gesture=0;
  const capacity=paper?.15:{base:.85,tone:.55,detail:.35,finish:3.4}[pass];
  const maxStrokes=Math.max(2,Math.ceil(region[3]/Math.max(1,width*width*capacity)));
  const emit=(points,desiredWidth)=>{
   if(points.length<6)return false;let actualWidth=desiredWidth,masked=maskedRegion;
   if(!maskedRegion){actualWidth=Math.max(.8,safeWidth(grid,points,desiredWidth));masked=false;}
   let length=0;for(let i=3;i<points.length;i+=3)length+=Math.hypot(points[i]-points[i-3],points[i+1]-points[i-2]);
   if(length<Math.max(1.4,actualWidth*.7))return false;
   const removed=removeCovered(grid,points,actualWidth);if(removed<1)return false;
   if(!masked)unmaskedFine++;else if(pass!=='base')maskedFine++;
   strokes.push({region:id,phase:pass==='base'?2:3,paintPass:pass,workBlock:block,layer:'paint',kind:'fillBrush',block:serial++,width:round(actualWidth),length:round(length),liftMs:pass==='finish'?95:65,masked,points:points.map(round)});
   previous=points.slice(-3,-1);gesture++;return true;
  };
  if(!maskedRegion){
   const maxLength=Math.max(24,width*cfg.maxSpan*2.4);
   skeletons:for(const path of skeletonPaths(grid).sort((a,b)=>b.length-a.length)){
    let part=[path[0],path[1],1],length=0;for(let i=3;i<path.length;i+=3){const segment=Math.hypot(path[i]-path[i-3],path[i+1]-path[i-2]);if(length+segment>maxLength&&part.length>=9){emit(part,width);if(gesture>=maxStrokes)break skeletons;part=part.slice(-3);length=0;}part.push(path[i],path[i+1],1);length+=segment;}emit(part,width);if(gesture>=maxStrokes)break;
   }
  }
  while(grid.alive.size>goal&&gesture<maxStrokes){
   const seed=chooseSeed(grid,gesture?previous:center(id));if(seed<0)break;
   const p=grid.point(seed),angle=localAngle(grid,p[0],p[1],fallback),points=grow(grid,seed,angle,width,cfg.maxSpan,id,gesture);
   if(points.length<6){grid.alive.delete(seed);continue;}
   if(!emit(points,width)){grid.alive.delete(seed);continue;}
  }
  skippedResidual+=grid.alive.size*grid.cell*grid.cell;
 }

 function order(items,isBase){
  const pending=items.slice(),ordered=[];let focus=isBase?[W*.5,H*.22]:previous,priorColor=null,priorBlock=null;
  while(pending.length){let best=0,bestScore=Infinity;
   for(let i=0;i<pending.length;i++){const item=pending[i],p=center(item.id),distance=Math.hypot(p[0]-focus[0],p[1]-focus[1]);
    const colour=priorColor===null?0:colorDistance(priorColor,regions[item.id][0])*.55;
    const block=priorBlock===null||item.block===priorBlock?0:Math.min(W,H)*.18;
    const r=regions[item.id],luma=((r[0]>>16)&255)*.299+((r[0]>>8)&255)*.587+(r[0]&255)*.114,isPaper=isBase&&r[3]>N*.12&&luma>242;
    const large=isBase?(isPaper?Math.sqrt(r[3])*.25:-Math.sqrt(r[3])*.25):0,topFirst=isBase&&!isPaper?p[1]*.10:0,paperLast=isPaper?W+H:0,score=distance+colour+block+large+topFirst+paperLast;if(score<bestScore){bestScore=score;best=i;}
   }
   const item=pending.splice(best,1)[0];ordered.push(item);focus=center(item.id);priorColor=regions[item.id][0];priorBlock=item.block;
  }return ordered;
 }

 const paintPass=(pass,name)=>{previous=pass==='base'?[W*.48,H*.18]:previous;addStage(pass,name,()=>{
  const items=Array.from(assignments.values()).filter(a=>a.pass===pass);for(const item of order(items,pass==='base'))paintRegion(item);
 });};
 paintPass('base','底色 · 大笔逐步铺色');
 paintPass('tone','明暗 · 顺形塑造体积');
 paintPass('detail','局部 · 集中刻画');
 paintPass('finish','收尾 · 逐笔高光修边');
 const baseStage=stages.find(s=>s.role==='base'),fineStages=stages.filter(s=>['tone','detail','finish'].includes(s.role));
 return {...input,revision:15,algorithm:'multiscale-structure-residual-brushwork',strokes,stages,stats:{...input.stats,baseBrushStrokes:baseStage.end-baseStage.start,refinementBrushStrokes:fineStages.reduce((n,s)=>n+s.end-s.start,0),brushStrokes:strokes.length,residualArea:Math.round(skippedResidual),unmaskedFineStrokes:unmaskedFine,maskedFineStrokes:maskedFine}};
}
