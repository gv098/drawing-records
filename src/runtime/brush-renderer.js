/* Hand-painted strokes are unmasked. Smooth underpainting uses its own
   renderer and vector boundaries to keep the colour edges clean. */
const brushTips=new Map();
const drawingLayers=Object.fromEntries(['paint','sketch','ink'].map(name=>{const c=document.createElement('canvas');c.getContext('2d',{willReadFrequently:true});return [name,c];}));
function resetLayers(){fillPaintRun=null;for(const name of Object.keys(drawingLayers)){const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d',{willReadFrequently:true});drawingLayers[name]=c;}}
function sketchAlpha(){if(!data)return 0;const ink=data.stages.find(s=>s.role==='ink');if(!ink||position>=ink.end)return 0;return position>ink.start?.23:.66;}
function composeLayers(target,partial=true){
 flushFillBrush();
 target.save();target.setTransform(1,0,0,1,0,0);target.globalAlpha=1;target.globalCompositeOperation='source-over';target.fillStyle=data?.background||'#fff';target.fillRect(0,0,canvas.width,canvas.height);
 const next=partial&&data&&fraction>0?data.strokes[position]:null;
 for(const name of ['paint','sketch','ink']){const alpha=name==='sketch'?sketchAlpha():1;if(!alpha)continue;
  target.globalAlpha=alpha;target.drawImage(drawingLayers[name],0,0);target.globalAlpha=1;
  if(next?.layer===name){if(name==='sketch'){const tmp=document.createElement('canvas');tmp.width=canvas.width;tmp.height=canvas.height;renderBrush(next,tmp.getContext('2d'),fraction);target.globalAlpha=alpha;target.drawImage(tmp,0,0);target.globalAlpha=1;}else renderBrush(next,target,fraction,true);}
 }target.restore();
}
function flushBrush(context){flushFillBrush();if(context===ctx)composeLayers(ctx);}
function releaseBrushClip(context){}
function prepareBrush(){brushTips.clear();fillMaskCache.clear();strokeCurveCache.clear();resetLayers();}
function brushTip(color,style){
 const key=color+':'+style;if(brushTips.has(key))return brushTips.get(key);
 const tip=document.createElement('canvas');tip.width=tip.height=64;const tc=tip.getContext('2d'),im=tc.createImageData(64,64);
 const hard=style==='soft'?.42:style==='dry'?.76:.84;
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const r=Math.hypot((x+0.5-32)/32,(y+0.5-32)/32),i=(y*64+x)*4;
  const edge=r<=hard?1:Math.max(0,(1-r)/(1-hard));
  const noise=((Math.imul(x+11,374761393)^Math.imul(y+29,668265263))>>>0)%1000/1000;
  const grain=style==='dry'?(.42+.58*noise):(style==='soft'?1:.96+.04*noise);
  im.data[i]=(color>>16)&255;im.data[i+1]=(color>>8)&255;im.data[i+2]=color&255;im.data[i+3]=Math.round(255*edge*grain);
 }tc.putImageData(im,0,0);brushTips.set(key,tip);return tip;
}
function pointAt(s,distance){
 const p=strokePoints(s);let left=Math.min(s.length,Math.max(0,distance));
 for(let j=3;j<p.length;j+=3){const len=Math.hypot(p[j]-p[j-3],p[j+1]-p[j-2]);if(left<=len||j+3>=p.length){const t=Math.min(1,left/(len||1));return [p[j-3]+(p[j]-p[j-3])*t,p[j-2]+(p[j+1]-p[j-2])*t,p[j-1]+(p[j+2]-p[j-1])*t];}left-=len;}return p.slice(-3);
}
function pressureOutline(s,portion=1){
 const end=s.length*Math.min(1,portion),p=s.points,points=[p.slice(0,3)];let length=0;
 for(let i=3;i<p.length;i+=3){length+=Math.hypot(p[i]-p[i-3],p[i+1]-p[i-2]);if(length>=end){points.push(pointAt(s,end));break;}points.push(p.slice(i,i+3));}
 const left=[],right=[];
 for(let i=0;i<points.length;i++){const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],p=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1,r=s.width*(.12+.88*p[2])*.5*Math.min(1,p[2]*8);left.push([p[0]-dy/length*r,p[1]+dx/length*r]);right.unshift([p[0]+dy/length*r,p[1]-dx/length*r]);}
 return left.concat(right);
}
function renderBrush(s,context=ctx,portion=1,direct=false){
 if(!s||portion<=0)return;if(s.kind==='fillBrush'){renderFillBrush(s,context===ctx&&!direct?drawingLayers[s.layer].getContext('2d'):context,portion,direct?(data.background||'#fff'):null);return;}if(s.kind==='fill'){renderRegionFill(s,context===ctx&&!direct?drawingLayers[s.layer].getContext('2d'):context,portion);return;}const style=s.layer==='ink'||s.layer==='sketch'?'round':$('brushStyle').value,color=data.regions[s.region][0],spacing=Math.max(.025,Math.min(s.width*.10,s.length/16)),end=s.length*Math.min(1,portion);
 const ic=context===ctx&&!direct?drawingLayers[s.layer||'paint'].getContext('2d'):context;ic.save();
 // A hard round digital pen is one pressure envelope. Filling it once keeps
 // antialiasing intact; overlapping subpixel stamps used to harden the edge.
 if(style==='round'){
  const outline=pressureOutline(s,portion);ic.beginPath();outline.forEach((p,i)=>i?ic.lineTo(...p):ic.moveTo(...p));ic.closePath();ic.fillStyle=colorHex(color);ic.globalAlpha=s.opacity??1;ic.fill();ic.restore();return;
 }
 const tip=brushTip(color,style);
 // The same fixed sample distances are used for partial and full replay.
 for(let distance=0;distance<=end;distance+=spacing){const [x,y,pressure]=pointAt(s,distance),diameter=s.width*(.12+.88*pressure);ic.globalAlpha=(s.opacity??1)*(style==='soft'?.66:style==='dry'?.86:.94)*Math.min(1,pressure*4)*(.8+.2*pressure);ic.drawImage(tip,x-diameter/2,y-diameter/2,diameter,diameter);}
 ic.restore();
}
let nibColorPoint=null;
function hideNibColor(){nibColorPoint=null;$('nibColor').hidden=true;}
function showNibColor(s,x,y,radius){
 const hex=colorHex(data.regions[s.region][0]).toUpperCase();
 if($('nibColorHex').textContent!==hex){$('nibColorHex').textContent=hex;$('nibColorSwatch').style.backgroundColor=hex;}
 nibColorPoint={x,y,radius};positionNibColor();
}
function positionNibColor(){
 if(!nibColorPoint)return;
 const label=$('nibColor'),m=cameraMetrics(),p=viewCamera.pose,scale=m.fit*p.z;
 const x=m.w/2+(nibColorPoint.x-p.x)*scale,y=m.h/2+(nibColorPoint.y-p.y)*scale;
 if(x<0||y<0||x>m.w||y>m.h){label.hidden=true;return;}
 const width=108,height=28,gap=nibColorPoint.radius*scale+10;
 let left=x+gap;if(left+width>m.w-6)left=x-gap-width;
 label.style.left=Math.max(6,Math.min(m.w-width-6,left))+'px';
 label.style.top=Math.max(6,Math.min(m.h-height-6,y-height/2))+'px';label.hidden=false;
}
function drawNib(s,portion){
 releaseBrushClip(cctx);if(!s||!$('showNib').checked)return;const [x,y,pressure]=pointAt(s,s.length*portion),radius=s.width*(.12+.88*pressure)/2;
 cctx.save();cctx.beginPath();cctx.arc(x,y,radius,0,Math.PI*2);cctx.strokeStyle='rgba(20,18,35,.65)';cctx.lineWidth=2;cctx.stroke();cctx.strokeStyle='rgba(255,255,255,.9)';cctx.lineWidth=.8;cctx.stroke();cctx.beginPath();cctx.arc(x,y,1.3,0,Math.PI*2);cctx.fillStyle=colorHex(data.regions[s.region][0]);cctx.fill();cctx.restore();
 showNibColor(s,x,y,radius);
}
