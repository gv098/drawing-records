function planLineStages(inkPaths,regions,W,H){
 const strokes=[],stages=[],paths=inkPaths.map(p=>({p,length:curveLength(p)}));
 for(const phase of [0,1]){
  const start=strokes.length,color=phase===0?0x8191ac:0x373545,region=regions.length;
  regions.push([color,0,[],0,[0,0,W,H]]);
  const pending=paths.filter(p=>phase===1||p.length>75).map(p=>phase===0?smoothCurve(p.p,false,3):p.p.slice());
  let previous=[W*.5,0],block=0;
  while(pending.length){
   let best=Infinity,index=0,reverse=false;
   for(let i=0;i<pending.length;i++){const p=pending[i];for(const flip of [false,true]){const j=flip?p.length-2:0,score=Math.hypot(p[j]-previous[0],p[j+1]-previous[1])+.12*p[j+1];if(score<best){best=score;index=i;reverse=flip;}}}
   let p=pending.splice(index,1)[0];if(reverse){const rev=[];for(let j=p.length-2;j>=0;j-=2)rev.push(p[j],p[j+1]);p=rev;}
   let chunk=[p[0],p[1],0],length=0;
   const emit=()=>{if(length<.5)return;let d=0;for(let j=0;j<chunk.length;j+=3){if(j)d+=Math.hypot(chunk[j]-chunk[j-3],chunk[j+1]-chunk[j-2]);chunk[j+2]=+(.85*Math.min(1,d/3,(length-d)/3)).toFixed(3);}
    strokes.push({region,block,phase,layer:phase===0?'sketch':'ink',kind:phase===0?'sketch':'line',width:phase===0?1.65:1.35,opacity:phase===0?.52:1,points:chunk,length:+length.toFixed(3),liftMs:phase===0?130:110});};
   for(let j=2;j<p.length;j+=2){length+=Math.hypot(p[j]-p[j-2],p[j+1]-p[j-1]);chunk.push(p[j],p[j+1],1);if(length>(phase===0?170:120)){emit();chunk=[p[j],p[j+1],0];length=0;}}
   emit();previous=p.slice(-2);block++;
  }
  stages.push({name:phase===0?'草稿 · 概括轮廓':'线稿 · 平滑勾线',role:phase===0?'sketch':'ink',start,end:strokes.length,kind:'brush',length:Math.round(strokes.slice(start).reduce((n,s)=>n+s.length,0))});
 }
 return {strokes,stages};
}
