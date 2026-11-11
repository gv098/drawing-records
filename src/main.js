import './styles.css';
import { strokeSeconds, liftSeconds } from './playback-timing.js';
import sampleAssets from '../.generated/sample-manifest.json';
'use strict';
const SAMPLE=sampleAssets.reference;
const $=id=>document.getElementById(id);
const canvas=$('drawing'),ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false}),cursor=$('cursor'),cctx=cursor.getContext('2d');
let data=null,position=0,playing=false,lastTime=0,fraction=0,worker=null,busy=false,runId=0,checkpoints=new Map(),sourceURL=SAMPLE,sourceLabel='蓝发角色插画';
let sourceVector=null,sourceIsSample=true,cancelGeneration=null;
/* @include runtime/storage.js */
const sampleSources={fill:sampleAssets.fill,brush:sampleAssets.brush},sampleModes={};
async function getSampleMode(mode){
 if(sampleModes[mode])return sampleModes[mode];
 const url=sampleSources[mode];let result;
 if(url){const response=await fetch(url);if(!response.ok)throw new Error('示例加载失败，请重试');result=await response.json();}
 else result=JSON.parse($('sampleData-'+mode).textContent);
 sampleModes[mode]=result;return result;
}
const colorHex=n=>'#'+n.toString(16).padStart(6,'0');
function say(t){$('sr-status').textContent=t;}
function controls(enabled){for(const id of ['play','prev','next','showResult','modeFill','modeBrush','seek'])$(id).disabled=!enabled;for(const b of $('stages').children)b.disabled=!enabled;$('upload').disabled=false;$('uploadLabel').classList.remove('disabled');}
function clear(){hideNibColor();resetLayers();ctx.fillStyle=data?.background||'#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);cctx.clearRect(0,0,cursor.width,cursor.height);}
/* @include runtime/fill-brush-plan.js */
/* @include runtime/fill-plan.js */
/* @include runtime/fill-mode.js */
/* @include runtime/brush-renderer.js */
/* @include runtime/camera.js */
function remember(){const prior=data.strokes[position-1],next=data.strokes[position];if(prior?.kind==='fillBrush'&&next?.kind==='fillBrush'&&prior.region===next.region)return;if(position%1000!==0||checkpoints.has(position))return;flushFillBrush();const snapshot={};for(const [name,layer] of Object.entries(drawingLayers)){const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d',{willReadFrequently:true}).drawImage(layer,0,0);snapshot[name]=c;}checkpoints.set(position,snapshot);if(checkpoints.size>(matchMedia('(max-width:700px)').matches?2:8))checkpoints.delete(checkpoints.keys().next().value);}
let seekEpoch=0,seeking=false;
function beginSeek(value){
 const target=Math.max(0,Math.min(data.strokes.length,Math.round(value)));fraction=0;lift=null;hideNibColor();releaseBrushClip(cctx);cctx.clearRect(0,0,cursor.width,cursor.height);
 if(target<position){let best=0;for(const k of checkpoints.keys())if(k<=target&&k>best)best=k;clear();if(best)for(const [name,c] of Object.entries(checkpoints.get(best)))drawingLayers[name].getContext('2d').drawImage(c,0,0);position=best;}
 return target;
}
function seek(value){
 seekEpoch++;seeking=false;if(!data)return;const target=beginSeek(value);
 while(position<target){renderBrush(data.strokes[position]);position++;remember();}flushBrush(ctx);syncCameraToPosition();update();
}
async function seekResponsive(value){
 if(!data)return false;const epoch=++seekEpoch,target=beginSeek(value);let lastPaint=performance.now();seeking=true;update();
 while(position<target){
  const deadline=performance.now()+5;let count=0;
  do{renderBrush(data.strokes[position]);position++;remember();count++;}while(position<target&&(count%4!==0||performance.now()<deadline));
  if(performance.now()-lastPaint>32){flushBrush(ctx);update();lastPaint=performance.now();}
  if(position<target){await new Promise(resolve=>setTimeout(resolve,0));if(epoch!==seekEpoch)return false;}
 }
 if(epoch!==seekEpoch)return false;seeking=false;flushBrush(ctx);syncCameraToPosition();update();return true;
}
function update(){
  if(!data)return;const total=data.strokes.length;
  $('counter').textContent=position.toLocaleString()+' / '+total.toLocaleString()+(data.mode==='fill'?' 步':' 笔');$('seek').value=position;
  const current=data.stages.find(s=>position> s.start&&position<=s.end)||data.stages[0];
  $('stageTitle').textContent=position===0?'空白画布':position===total?'重绘完成':current.name;
  $('canvasStatus').textContent=total?Math.round(position/total*100)+'%'+(lift?' · 抬笔':fraction?' · 落笔':''):'0%';
  $('play').textContent=playing||seeking?'暂停':position===total?'从头播放':position===0?'开始绘制':'继续播放';
  for(const b of $('stages').children)b.classList.toggle('active',b.dataset.name===current.name&&position>0);
  const s=data.strokes[Math.min(data.strokes.length-1,(playing||fraction>0)?position:Math.max(0,position-1))];if(s&&(position||fraction)){const color=data.regions[s.region][0];$('hex').textContent=colorHex(color).toUpperCase();$('swatch').style.background=colorHex(color);$('brushWidth').textContent=s.width.toFixed(1)+' px';$('strokeInfo').textContent=s.kind==='fill'?'局部色块 · '+(s.regions?.length||1)+' 个颜色区域':({sketch:'草稿层',ink:'线稿层',paint:'颜色层'}[s.layer]||'笔触')+' · 独立笔触 '+Math.round(s.length)+' px · 模拟压感';}else{$('hex').textContent='—';$('brushWidth').textContent='—';$('swatch').style.background='#fff';$('strokeInfo').textContent='先概括轮廓，再勾线、铺底色和刻画明暗';}
}
let lift=null,lastUI=0;
function showPartial(){
 hideNibColor();composeLayers(ctx);cctx.clearRect(0,0,cursor.width,cursor.height);if(!data||position>=data.strokes.length)return;
 if(lift){if(data.mode!=='fill'&&$('showNib').checked){const t=Math.min(1,lift.done/lift.duration),ease=t*t*(3-2*t);cctx.save();cctx.beginPath();cctx.arc(lift.a[0]+(lift.b[0]-lift.a[0])*ease,lift.a[1]+(lift.b[1]-lift.a[1])*ease,4,0,Math.PI*2);cctx.setLineDash([2,2]);cctx.strokeStyle='#9274c0';cctx.lineWidth=1.2;cctx.stroke();cctx.restore();}return;}
 const s=data.strokes[position];drawNib(s,fraction);
}
function stop(){seekEpoch++;seeking=false;playing=false;showPartial();update();}
function togglePlay(){if(!data||busy)return;if(playing||seeking){stop();return;}if(position>=data.strokes.length)seek(0);playing=true;lastTime=performance.now();update();}
function playbackRate(){
 if($('speed').value!=='auto')return Number($('speed').value)||1;
 const role=data.stages.find(s=>position<s.end)?.role;
 return {sketch:1,ink:1,base:16,tone:8,detail:4,finish:1}[role]||1;
}
function advancePlayback(seconds){
 let budget=seconds,guard=0;const deadline=performance.now()+6;
 // Consume pen-down AND pen-up time. Fast playback can cross multiple events
 // in one frame without turning pen-up movement into paint or a frame delay.
 while(budget>0&&position<data.strokes.length&&guard++<8000){
  if(guard%4===0&&performance.now()>deadline)break;
  if(!ensureCameraForStroke())break;
  if(lift){const left=lift.duration-lift.done;if(budget<left){lift.done+=budget;budget=0;break;}budget-=left;lift=null;continue;}
  const s=data.strokes[position],rate=playbackRate(),duration=strokeSeconds(s,data,rate),left=duration*(1-fraction);
  if(budget<left){fraction+=budget/duration;budget=0;break;}
  renderBrush(s);budget-=left;position++;fraction=0;remember();
  if(position<data.strokes.length){const next=data.strokes[position],a=strokePoints(s).slice(-3,-1),b=strokePoints(next).slice(0,2),d=Math.hypot(a[0]-b[0],a[1]-b[1]);
   const pause=liftSeconds(s,next,d,data,rate);
   lift=pause>0?{a,b,done:0,duration:pause}:null;
  }
  // Normal speed must show the end of this stroke before starting another.
  // Numeric fast modes keep batching all strokes in order.
  if(rate===1)break;
 }
 if(position>=data.strokes.length){playing=false;fraction=0;lift=null;finishCamera();}showPartial();
}
function tick(now){
 const dt=Math.min(.07,Math.max(0,(now-lastTime)/1000));lastTime=now;
 if(playing&&data){if(!advanceCamera(dt))advancePlayback(dt);if(!playing){update();say('重绘完成');}else if(now-lastUI>80){update();lastUI=now;}}
 else if(viewCamera.settling)advanceCamera(dt);
 requestAnimationFrame(tick);
}
function layout(){applyCamera();applyReference();}

function finish(result){
 if(result.mode==='fill')modeData.fill=result;
 else modeData.brush=result;
 activateData(modeData[activeMode]||result);activeMode=data.mode;updateModeUI();
}
function cancelWorker(){if(cancelGeneration)cancelGeneration();}
function generateSteps(input,thisRun){
 return new Promise((resolve,reject)=>{
  const current=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker=current;
  const cleanup=()=>{current.terminate();if(worker===current){worker=null;cancelGeneration=null;}};
  cancelGeneration=()=>{cleanup();reject(new Error('已更换图片'));};
  current.onmessage=e=>{
   if(thisRun!==runId)return;
   const m=e.data;
   if(m.type==='progress'){$('genText').textContent=m.stage+' · '+m.count.toLocaleString()+(input.mode==='fill'?' 步':' 笔');$('genFill').style.width=Math.round(m.progress*100)+'%';}
   else if(m.type==='done'){cleanup();resolve(m);}
   else if(m.type==='error'){cleanup();reject(new Error(m.message));}
  };
  current.onerror=e=>{cleanup();reject(new Error(e.message||'绘制步骤生成失败'));};
  try{current.postMessage(input,input.pixels?[input.pixels]:[]);}catch(error){cleanup();reject(error);}
 });
}
async function playStage(stage){
 if(!data||busy)return;
 stop();const thisRun=runId,original=data;
 if(!await seekResponsive(stage.start)||thisRun!==runId||data!==original)return;
 $('speed').value='1';lift=null;fraction=0;playing=true;lastTime=performance.now();
 showPartial();update();say('从'+stage.name+'起点逐笔播放');
}
function activateData(result){
  fraction=0;lift=null;data=result;prepareBrush();prepareCamera();busy=false;$('generation').hidden=true;checkpoints.clear();position=0;clear();$('seek').max=data.strokes.length;
  $('stages').replaceChildren();data.stages.forEach((s,i)=>{const b=document.createElement('button');b.className='stage';b.dataset.name=s.name;const n=document.createElement('span');n.className='num';n.textContent=String(i+1).padStart(2,'0');const label=document.createElement('span');label.textContent=s.name;const size=document.createElement('span');size.className='size';size.textContent=(s.end-s.start)+(data.mode==='fill'?' 步':' 笔');b.append(n,label,size);b.title='从本阶段起点逐笔播放';b.onclick=()=>playStage(s);$('stages').append(b);});
  controls(true);seek(0);$('status').textContent='本地处理 · '+data.strokes.length.toLocaleString()+(data.mode==='fill'?' 步 · ':' 笔 · ')+data.width+' × '+data.height+' px';say('绘制步骤生成完成，可以播放');window.appReady=true;
}
async function loadImage(url,label,useSample=false,saved=null,rememberSelection=true){
 const thisRun=++runId;cacheRecoveryAction=null;stop();cancelWorker();busy=true;window.appReady=false;controls(false);$('error').textContent='';$('generation').hidden=false;$('genText').textContent='正在读取图片…';$('genFill').style.width='0%';sourceURL=url;sourceLabel=label;sourceIsSample=useSample;
 sourceVector=null;modeData={};sourceRecordId=null;sourceThumbnail='';
 try{
  const img=new Image();img.src=url;await img.decode();if(thisRun!==runId)return;
  const scale=Math.min(1,1137/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
  canvas.width=cursor.width=w;canvas.height=cursor.height=h;clear();$('reference').src=$('thumb').src=url;resetViews();$('sourceName').textContent=label;$('dimensions').textContent=w+' × '+h+' px'+(scale<1?' · 已缩放':'');layout();
  if(useSample){$('genText').textContent='正在读取示例…';const prepared=await getSampleMode(activeMode);if(thisRun!==runId)return;finish(prepared);if(rememberSelection)await saveCurrentDrawing();return;}
  const found=saved?{id:saved.id,record:saved}:await findSavedDrawing(url);if(thisRun!==runId)return;
  sourceRecordId=found.id;if(!saved)deletedRecordIds.delete(sourceRecordId);const cached=found.record;
  const thumbnail=document.createElement('canvas'),thumbScale=Math.min(1,144/Math.max(img.width,img.height));thumbnail.width=Math.max(1,Math.round(img.width*thumbScale));thumbnail.height=Math.max(1,Math.round(img.height*thumbScale));thumbnail.getContext('2d').drawImage(img,0,0,thumbnail.width,thumbnail.height);sourceThumbnail=thumbnail.toDataURL('image/png');
  if(cached?.url===url&&cached.schema===DRAWING_CACHE_VERSION){
   modeData=cached.modes||{};sourceVector=cached.vector||null;const upgradedFill=modeData.fill&&modeData.fill.revision<15,upgradedVector=sourceVector&&!sourceVector.stats?.midRegions;
   if(upgradedFill||upgradedVector){
    $('genText').textContent='正在更新多尺度铺色与修边笔触…';let upgraded;
    if(upgradedVector||!sourceVector){const source=document.createElement('canvas');source.width=w;source.height=h;const sc=source.getContext('2d');sc.fillStyle='#fff';sc.fillRect(0,0,w,h);sc.drawImage(img,0,0,w,h);upgraded=await generateSteps({width:w,height:h,pixels:sc.getImageData(0,0,w,h).data.buffer,mode:'fill'},thisRun);sourceVector=upgraded.vector||sourceVector;}
    else upgraded=await generateSteps({fillData:modeData.fill,mode:'fill'},thisRun);
    if(thisRun!==runId)return;modeData.fill=upgraded.data;
   }
   if(modeData[activeMode]){activateData(modeData[activeMode]);updateModeUI();await saveCurrentDrawing({metadataOnly:!(upgradedFill||upgradedVector)});return;}
  }
  await saveCurrentDrawing();if(thisRun!==runId)return;
  let input={vector:sourceVector,mode:activeMode};
  if(!sourceVector){
   const source=document.createElement('canvas');source.width=w;source.height=h;const sc=source.getContext('2d');sc.fillStyle='#fff';sc.fillRect(0,0,w,h);sc.drawImage(img,0,0,w,h);
   input={width:w,height:h,pixels:sc.getImageData(0,0,w,h).data.buffer,mode:activeMode};
  }
  const result=await generateSteps(input,thisRun);if(thisRun!==runId)return;
  sourceVector=result.vector||sourceVector;finish(result.data);await saveCurrentDrawing();
 }catch(error){if(thisRun===runId)fail(error.message);}
}
function fail(message){busy=false;playing=false;window.appReady=false;cancelWorker();data=null;$('error').textContent='无法处理图片：'+message+'。请尝试 PNG 或 JPG 图片。';$('generation').hidden=true;$('upload').disabled=false;$('uploadLabel').classList.remove('disabled');say('图片处理失败');}
$('showResult').onclick=async()=>{if(!data||busy)return;stop();if(await seekResponsive(data.strokes.length))say('重绘完成');};
$('speed').onchange=()=>{lift=null;if(data)syncCameraToPosition();lastTime=performance.now();showPartial();update();};
$('play').onclick=togglePlay;$('prev').onclick=()=>{stop();seekResponsive(position-1);};$('next').onclick=()=>{stop();seekResponsive(position+1);};$('seek').oninput=e=>{const target=Number(e.target.value);stop();seekResponsive(target);};
$('compare').onclick=()=>{setCompare($('compare').getAttribute('aria-pressed')!=='true');};window.addEventListener('resize',layout);
$('upload').onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024){$('error').textContent='请选择小于 20 MB 的图片。';e.target.value='';return;}const reader=new FileReader();reader.onload=()=>loadImage(reader.result,file.name);reader.onerror=()=>{$('error').textContent='文件读取失败，请重新选择。';};reader.readAsDataURL(file);e.target.value='';};
$('resetSample').onclick=()=>loadImage(SAMPLE,'蓝发角色插画',true);
$('brushStyle').onchange=async()=>{const target=position,part=fraction;stop();checkpoints.clear();position=0;fraction=0;clear();if(await seekResponsive(target)){fraction=part;showPartial();say('已切换笔刷并重绘');}};
$('showNib').onchange=showPartial;
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON','TEXTAREA'].includes(document.activeElement.tagName))return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.code==='ArrowRight'&&data){e.preventDefault();stop();seek(position+1);}if(e.code==='ArrowLeft'&&data){e.preventDefault();stop();seek(position-1);}});
// Only replay data is exposed for local verification; no pixels are substituted.
window.biji={get seeking(){return seeking;},get mode(){return activeMode;},switchMode,get layers(){return drawingLayers;},get data(){return data;},get position(){return position;},get fraction(){return fraction;},seek,stop,loadImage,renderBrush,pointAt,setFraction(v){fraction=v;showPartial();},get playing(){return playing;},get penUp(){return !!lift;},step(seconds){if(!advanceCamera(seconds))advancePlayback(seconds);update();},get camera(){return {auto:viewCamera.auto,pose:{...viewCamera.pose},mode:viewCamera.mode,transitioning:!!(viewCamera.motion||viewCamera.queue.length),shotIndex:viewCamera.shotIndex,shots:viewCamera.shots};},cameraStep(seconds){advanceCamera(seconds);}};
/* @include runtime/mobile.js */
requestAnimationFrame(tick);restoreDrawing();
