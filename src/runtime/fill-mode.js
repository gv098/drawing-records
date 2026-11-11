const fillPathCache=new WeakMap();
function regionFillPath(region){
 let path=fillPathCache.get(region);if(!path){path=new Path2D();for(const ring of region[2]){path.moveTo(ring[0],ring[1]);for(let i=2;i<ring.length;i+=2)path.lineTo(ring[i],ring[i+1]);path.closePath();}fillPathCache.set(region,path);}return path;
}
function renderRegionFill(s,context,portion){
 flushFillBrush();if(context===drawingLayers.paint.getContext('2d'))fillPaintRun=null;
 context.save();context.globalAlpha=Math.min(1,portion);context.lineWidth=.45;context.lineJoin='round';
 for(const id of s.regions||[s.region]){const region=data.regions[id],path=regionFillPath(region);context.fillStyle=context.strokeStyle=colorHex(region[0]);context.stroke(path);context.fill(path,'evenodd');}context.restore();
}
// Cache a few vector-shape masks, not source-image pixels. Each brush only
// composites its small footprint; repeating a full complex clip per stroke
// stalls mobile GPUs. Bound cache memory and reuse one local stamp canvas.
const fillMaskCache=new Map(),fillStamp=document.createElement('canvas');
function fillBrushMask(region){
 let entry=fillMaskCache.get(region);if(entry){fillMaskCache.delete(region);fillMaskCache.set(region,entry);return entry;}
 const b=region[4],x=Math.floor(b[0]),y=Math.floor(b[1]),c=(()=>{for(const [key,item] of fillMaskCache){if(fillMaskCache.size>=3&&item!==fillPaintRun?.mask){fillMaskCache.delete(key);return item.canvas;}}return document.createElement('canvas');})();c.width=Math.max(1,Math.ceil(b[2])-x);c.height=Math.max(1,Math.ceil(b[3])-y);const context=c.getContext('2d');context.translate(-x,-y);context.fillStyle='#fff';context.fill(regionFillPath(region),'evenodd');entry={canvas:c,x,y};fillMaskCache.set(region,entry);
 let pixels=0;for(const item of fillMaskCache.values())pixels+=item.canvas.width*item.canvas.height;
 while(fillMaskCache.size>1&&(fillMaskCache.size>3||pixels>data.width*data.height*2)){const key=fillMaskCache.keys().next().value,item=fillMaskCache.get(key);pixels-=item.canvas.width*item.canvas.height;fillMaskCache.delete(key);}return entry;
}
const strokeCurveCache=new Map();
function strokePoints(s){
 if(!s.curve)return s.points;let points=strokeCurveCache.get(s);if(points)return points;
 const [cx,cy,span,angle,bend]=s.curve,ca=Math.cos(angle),sa=Math.sin(angle);points=[];
 for(let j=0;j<=12;j++){const t=j/12,u=(t-.5)*span,v=Math.sin(t*Math.PI*2)*bend;points.push(cx+u*ca-v*sa,cy+u*sa+v*ca,1);}
 strokeCurveCache.set(s,points);if(strokeCurveCache.size>128)strokeCurveCache.delete(strokeCurveCache.keys().next().value);return points;
}
// Keep the current colour run in one coverage canvas. Compositing is deferred
// until display/region boundaries, so fast playback does not rebuild the same
// clipped stamp for every tiny stroke. The same stroke sequence is retained.
let fillPaintRun=null;
const fillCoverage=document.createElement('canvas'),fillUnder=document.createElement('canvas');
function prepareFillStamp(w,h){if(fillStamp.width<w)fillStamp.width=Math.max(w,fillStamp.width*2);if(fillStamp.height<h)fillStamp.height=Math.max(h,fillStamp.height*2);const c=fillStamp.getContext('2d');c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.clearRect(0,0,w,h);c.save();c.beginPath();c.rect(0,0,w,h);c.clip();return c;}
function paintFillCurve(s,context,portion){
 const points=strokePoints(s);context.strokeStyle=colorHex(data.regions[s.region][0]);context.lineWidth=s.width;context.lineCap=context.lineJoin='round';context.beginPath();context.moveTo(points[0],points[1]);
 let length=0,end=s.length*Math.min(1,portion);
 for(let j=3;j<points.length;j+=3){const ax=points[j-3],ay=points[j-2],bx=points[j],by=points[j+1],segment=Math.hypot(bx-ax,by-ay);if(length+segment>=end){const t=Math.max(0,Math.min(1,(end-length)/(segment||1)));context.lineTo(ax+(bx-ax)*t,ay+(by-ay)*t);break;}context.lineTo(bx,by);length+=segment;}context.stroke();
}
function fillStrokeBounds(s,mask){
 const points=strokePoints(s),pad=s.width/2+2;let b=[Infinity,Infinity,-Infinity,-Infinity];for(let i=0;i<points.length;i+=3){b[0]=Math.min(b[0],points[i]-pad);b[1]=Math.min(b[1],points[i+1]-pad);b[2]=Math.max(b[2],points[i]+pad);b[3]=Math.max(b[3],points[i+1]+pad);}
 return [Math.max(mask.x,Math.floor(b[0])),Math.max(mask.y,Math.floor(b[1])),Math.min(mask.x+mask.canvas.width,Math.ceil(b[2])),Math.min(mask.y+mask.canvas.height,Math.ceil(b[3]))];
}
function compositeFillRun(run,context,b,partial=null,background=null){
 const [x,y,x1,y1]=b,w=x1-x,h=y1-y;if(w<=0||h<=0)return;const sx=x-run.mask.x,sy=y-run.mask.y;
 const stamp=prepareFillStamp(w,h);stamp.drawImage(run.coverage,sx,sy,w,h,0,0,w,h);
 if(partial){stamp.save();stamp.translate(-x,-y);paintFillCurve(partial.s,stamp,partial.portion);stamp.restore();}
 stamp.globalCompositeOperation='destination-in';stamp.drawImage(run.mask.canvas,sx,sy,w,h,0,0,w,h);stamp.restore();
 // A preview replaces part of an already composed picture. Clearing an
 // opaque display canvas turns uncovered pixels black; restore its paper
 // background before restoring the paint underlay. Paint layers stay transparent.
 if(background!==null){context.save();context.fillStyle=background;context.fillRect(x,y,w,h);context.restore();}
 else context.clearRect(x,y,w,h);
 context.drawImage(run.under,sx,sy,w,h,x,y,w,h);context.drawImage(fillStamp,0,0,w,h,x,y,w,h);
}
function flushFillBrush(){if(fillPaintRun?.dirty){compositeFillRun(fillPaintRun,fillPaintRun.context,fillPaintRun.dirty);fillPaintRun.dirty=null;}}
function renderFillBrush(s,context,portion,background=null){
 if(portion<=0)return;
 const permanent=context===drawingLayers.paint.getContext('2d')&&portion===1;
 if(s.masked===false){
  flushFillBrush();paintFillCurve(s,context,portion);return;
 }
 if(permanent){
  if(!fillPaintRun||fillPaintRun.region!==s.region||fillPaintRun.context!==context){
   flushFillBrush();const mask=fillBrushMask(data.regions[s.region]),coverage=fillCoverage,under=fillUnder;coverage.width=under.width=mask.canvas.width;coverage.height=under.height=mask.canvas.height;under.getContext('2d').drawImage(context.canvas,mask.x,mask.y,under.width,under.height,0,0,under.width,under.height);coverage.getContext('2d').translate(-mask.x,-mask.y);fillPaintRun={region:s.region,context,mask,coverage,under,dirty:null};
  }
  const run=fillPaintRun;paintFillCurve(s,run.coverage.getContext('2d'),1);const b=fillStrokeBounds(s,run.mask);run.dirty=run.dirty?[Math.min(run.dirty[0],b[0]),Math.min(run.dirty[1],b[1]),Math.max(run.dirty[2],b[2]),Math.max(run.dirty[3],b[3])]:b;return;
 }
 flushFillBrush();const mask=fillBrushMask(data.regions[s.region]),bounds=fillStrokeBounds(s,mask);
 if(fillPaintRun?.region===s.region){compositeFillRun(fillPaintRun,context,bounds,{s,portion},background);return;}
 const [x,y,x1,y1]=bounds,w=x1-x,h=y1-y;if(w<=0||h<=0)return;const stamp=prepareFillStamp(w,h);stamp.translate(-x,-y);paintFillCurve(s,stamp,portion);stamp.globalCompositeOperation='destination-in';stamp.drawImage(mask.canvas,mask.x,mask.y);stamp.restore();context.drawImage(fillStamp,0,0,w,h,x,y,w,h);
}
let modeData={},activeMode='fill';
function updateModeUI(){
 const fill=activeMode==='fill';$('modeFill').setAttribute('aria-pressed',String(fill));$('modeBrush').setAttribute('aria-pressed',String(!fill));
 $('brushStyle').disabled=fill;$('showNib').disabled=false;
 $('modeHint').textContent=fill?'按区域连贯铺色，完成一处再画下一处。':'保留起收笔、压感与涂抹纹理，细节会有偏差。';
}
async function switchMode(mode){
 if(busy||mode===activeMode||!['fill','brush'].includes(mode)||!data)return;
 const thisRun=runId,old=data,at=position,stage=old.stages.find(s=>at<s.end)||old.stages.at(-1),refinement=['tone','detail','finish'],oldRange=refinement.includes(stage.role)?old.stages.filter(s=>refinement.includes(s.role)):[stage],ratio=(at-oldRange[0].start)/Math.max(1,oldRange.at(-1).end-oldRange[0].start);
 stop();const hadMode=!!modeData[mode];
 if(!modeData[mode]){
  if(!sourceVector&&!sourceIsSample)return;
  busy=true;window.appReady=false;controls(false);$('generation').hidden=false;$('genText').textContent=mode==='fill'?'正在生成连续铺色笔触…':'正在生成手绘笔触…';$('genFill').style.width='0%';
  try{const result=sourceIsSample?{data:await getSampleMode(mode)}:await generateSteps({vector:sourceVector,mode},thisRun);if(thisRun!==runId)return;modeData[mode]=result.data;}
  catch(error){if(thisRun!==runId)return;busy=false;window.appReady=true;controls(true);updateModeUI();$('generation').hidden=true;$('error').textContent='步骤生成失败，可重试或继续当前风格：'+error.message;return;}
 }
 activeMode=mode;activateData(modeData[mode]);const nextRange=refinement.includes(stage.role)?data.stages.filter(s=>refinement.includes(s.role)):data.stages.filter(s=>s.role===stage.role),next=nextRange.length?{start:nextRange[0].start,end:nextRange.at(-1).end}:null;
 await seekResponsive(at===old.strokes.length?data.strokes.length:next?Math.round(next.start+Math.max(0,ratio)*(next.end-next.start)):0);if(thisRun!==runId||activeMode!==mode)return;updateModeUI();saveCurrentDrawing({metadataOnly:hadMode});say('已切换绘画风格，保留对应阶段');
}
$('modeFill').onclick=()=>switchMode('fill');$('modeBrush').onclick=()=>switchMode('brush');
