/* Both views are independent, manual-only cameras. Playback never reframes. */
const viewCamera={auto:false,pose:{x:320,y:568.5,z:1},mode:'manual',shots:[],shotIndex:-1,queue:[],motion:null,settling:false};
const referenceCamera={pose:{x:320,y:568.5,z:1}};
const clampView=(v,a,b)=>Math.max(a,Math.min(b,v));
function fullView(){return {x:canvas.width/2,y:canvas.height/2,z:1};}
function cameraMetrics(viewport='drawViewport'){const v=$(viewport),w=canvas.width||640,h=canvas.height||1137;return {w:v.clientWidth,h:v.clientHeight,fit:Math.max(.001,Math.min((v.clientWidth-28)/w,(v.clientHeight-28)/h))};}
function paintView(camera,viewport,paper){
 const m=cameraMetrics(viewport);if(!m.w||!m.h)return;
 const p=camera.pose,scale=m.fit*p.z,element=$(paper);element.style.width=canvas.width+'px';element.style.height=canvas.height+'px';element.style.transform='translate('+(m.w/2-p.x*scale)+'px,'+(m.h/2-p.y*scale)+'px) scale('+scale+')';
}
function applyReference(){paintView(referenceCamera,'refViewport','refPaper');$('refZoomStatus').textContent=referenceCamera.pose.z.toFixed(1)+'×';}
function applyCamera(){
 paintView(viewCamera,'drawViewport','drawPaper');const p=viewCamera.pose;
 $('viewStatus').textContent=(p.z===1?'全图':'手动查看')+' · '+p.z.toFixed(1)+'×';$('currentZoom').textContent=p.z.toFixed(1)+'× 当前';$('zoom').value='current';positionNibColor();
}
function resetViews(){viewCamera.pose=fullView();referenceCamera.pose=fullView();applyCamera();applyReference();}
function prepareCamera(){applyCamera();}
function syncCameraToPosition(){applyCamera();}
function ensureCameraForStroke(){return true;}
function advanceCamera(){return false;}
function finishCamera(){}
function zoomView(camera,viewport,apply,z,clientX,clientY){
 if(!data)return;const m=cameraMetrics(viewport),r=$(viewport).getBoundingClientRect(),dx=clientX-r.left-m.w/2,dy=clientY-r.top-m.h/2,p=camera.pose;
 const x=p.x+dx/(m.fit*p.z),y=p.y+dy/(m.fit*p.z),next=clampView(z,1,8);
 camera.pose=next===1?fullView():{x:x-dx/(m.fit*next),y:y-dy/(m.fit*next),z:next};apply();
}
function centerViewZoom(camera,viewport,apply,z){const r=$(viewport).getBoundingClientRect();zoomView(camera,viewport,apply,z,r.left+r.width/2,r.top+r.height/2);}
$('viewAll').onclick=()=>{viewCamera.pose=fullView();applyCamera();};
$('zoomIn').onclick=()=>centerViewZoom(viewCamera,'drawViewport',applyCamera,viewCamera.pose.z*1.35);
$('zoomOut').onclick=()=>centerViewZoom(viewCamera,'drawViewport',applyCamera,viewCamera.pose.z/1.35);
$('zoom').onchange=()=>centerViewZoom(viewCamera,'drawViewport',applyCamera,Number($('zoom').value));
$('refViewAll').onclick=()=>{referenceCamera.pose=fullView();applyReference();};
$('refZoomIn').onclick=()=>centerViewZoom(referenceCamera,'refViewport',applyReference,referenceCamera.pose.z*1.35);
$('refZoomOut').onclick=()=>centerViewZoom(referenceCamera,'refViewport',applyReference,referenceCamera.pose.z/1.35);
function bindManualView(camera,viewport,apply,reset){
 const element=$(viewport),pointers=new Map();let gesture=null;
 const rebase=()=>{const pts=[...pointers.values()];gesture=pts.length?{pose:{...camera.pose},center:pts.length>1?[(pts[0][0]+pts[1][0])/2,(pts[0][1]+pts[1][1])/2]:pts[0],distance:pts.length>1?Math.hypot(pts[0][0]-pts[1][0],pts[0][1]-pts[1][1]):0}:null;};
 element.addEventListener('wheel',e=>{if(!data)return;e.preventDefault();zoomView(camera,viewport,apply,camera.pose.z*Math.exp(-e.deltaY*.0015),e.clientX,e.clientY);},{passive:false});
 element.addEventListener('pointerdown',e=>{if(!data||e.button>0)return;element.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);rebase();element.classList.add('dragging');});
 element.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,[e.clientX,e.clientY]);const pts=[...pointers.values()],g=gesture,m=cameraMetrics(viewport),r=element.getBoundingClientRect();
  const center=pts.length>1?[(pts[0][0]+pts[1][0])/2,(pts[0][1]+pts[1][1])/2]:pts[0],ratio=pts.length>1&&g.distance?Math.hypot(pts[0][0]-pts[1][0],pts[0][1]-pts[1][1])/g.distance:1,z=clampView(g.pose.z*ratio,1,8);
  const anchorX=g.pose.x+(g.center[0]-r.left-m.w/2)/(m.fit*g.pose.z),anchorY=g.pose.y+(g.center[1]-r.top-m.h/2)/(m.fit*g.pose.z);
  camera.pose={x:anchorX-(center[0]-r.left-m.w/2)/(m.fit*z),y:anchorY-(center[1]-r.top-m.h/2)/(m.fit*z),z};apply();
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,e=>{pointers.delete(e.pointerId);rebase();if(!pointers.size)element.classList.remove('dragging');});
 element.addEventListener('dblclick',e=>{if(camera.pose.z>1)reset();else zoomView(camera,viewport,apply,3,e.clientX,e.clientY);});
 element.addEventListener('keydown',e=>{if(e.key==='+'||e.key==='='){e.preventDefault();centerViewZoom(camera,viewport,apply,camera.pose.z*1.35);}else if(e.key==='-'){e.preventDefault();centerViewZoom(camera,viewport,apply,camera.pose.z/1.35);}else if(e.key==='0'){e.preventDefault();reset();}});
 element.addEventListener('dragstart',e=>e.preventDefault());
}
bindManualView(viewCamera,'drawViewport',applyCamera,()=>$('viewAll').click());
bindManualView(referenceCamera,'refViewport',applyReference,()=>$('refViewAll').click());
