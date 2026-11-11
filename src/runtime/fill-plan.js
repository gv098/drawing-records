/* Smooth fill: structural lines, broad underpainting, then bounded local work.
   Never treat every dark pixel as ink; photographic shadows belong to paint. */
function makeFillMode(hand){
 const source=hand.fillSource;if(!source)return hand;
 const regions=source.regions.slice(),strokes=[],stages=[];
 const stage=(role,name,fn)=>{const start=strokes.length;fn();stages.push({role,name,start,end:strokes.length,kind:role==='ink'||role==='sketch'?'brush':'fill'});};
 const lines=(index,layer)=>{const remap=new Map();for(const s of hand.strokes.slice(hand.stages[index].start,hand.stages[index].end)){if(s.kind==='fill')continue;if(!remap.has(s.region)){remap.set(s.region,regions.length);regions.push(layer==='ink'?[0x18171b,0,[],0,[0,0,hand.width,hand.height]]:hand.regions[s.region]);}strokes.push({...s,region:remap.get(s.region),layer,...(layer==='ink'?{width:.85,opacity:.72}:{})});}};
 const fill=(id,phase)=>{const r=regions[id],b=r[4];if(r[2].length)strokes.push({region:id,phase,layer:'paint',kind:'fill',width:.45,length:Math.max(12,Math.sqrt(r[3])*2),liftMs:60,points:[b[0],b[1],1,b[2],b[3],1]});};
 stage('sketch','草稿 · 概括轮廓',()=>lines(0,'sketch'));
 stage('ink','线稿 · 平滑勾线',()=>lines(1,'ink'));
 stage('base','底色 · 大块铺色',()=>{for(let i=source.stages[0].start;i<source.stages[0].end;i++)fill(i,2);});
 stage('detail','阴影高光 · 局部完善',()=>{for(let i=source.stages[0].end;i<source.regions.length;i++)fill(i,3);});
 return organizeFillPlayback({version:4,revision:10,mode:'fill',width:hand.width,height:hand.height,background:hand.background,regions,strokes,stages,layers:['paint','sketch','ink'],unmasked:true,stats:source.stats,brush:{style:'region-fill'}});
}
function planFill(vector){
 const regions=vector.strokes.slice(),lines=planLineStages((vector.inkPaths||[]).filter(p=>curveLength(p)>=Math.min(vector.width,vector.height)*.055),regions,vector.width,vector.height);
 return makeFillMode({...vector,regions,...lines,fillSource:{regions:vector.strokes,stages:vector.stages,stats:vector.stats}});
}
// Split disconnected islands that older caches batched by colour. Holes remain
// with their containing outline; even-odd fill therefore keeps eyes/gaps intact.
function fillComponents(region,maxW=200,maxH=200){
 const box=region[4];if(box[2]-box[0]<=maxW&&box[3]-box[1]<=maxH)return [region];
 const info=region[2].map(p=>{let area=0;const b=[Infinity,Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i+=2){const j=(i+2)%p.length;area+=p[i]*p[j+1]-p[j]*p[i+1];b[0]=Math.min(b[0],p[i]);b[1]=Math.min(b[1],p[i+1]);b[2]=Math.max(b[2],p[i]);b[3]=Math.max(b[3],p[i+1]);}return {p,area:area/2,b};});
 const shells=info.filter(a=>a.area>0).map(a=>({...a,paths:[a.p]}));if(shells.length<=1)return [region];
 const inside=(p,x,y)=>{let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const ax=p[i],ay=p[i+1],bx=p[j],by=p[j+1];if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;}return hit;};
 for(const hole of info.filter(a=>a.area<=0)){
  const owners=shells.filter(s=>s.b[0]<=hole.b[0]&&s.b[1]<=hole.b[1]&&s.b[2]>=hole.b[2]&&s.b[3]>=hole.b[3]&&inside(s.p,hole.p[0],hole.p[1])).sort((a,b)=>a.area-b.area);
  // Boundary degeneracies are rare; retain the unsplit compound path rather
  // than dropping a hole or colouring it with the wrong parent.
  if(!owners.length)return [region];owners[0].paths.push(hole.p);owners[0].area+=hole.area;
 }
 return shells.map(s=>[region[0],region[1],s.paths,Math.max(1,s.area),s.b]);
}
function organizeFillPlayback(input){
 if(input.mode!=='fill'||input.revision>=15)return input;
 if(input.revision>=12)return progressiveBaseFill(input);
 const W=input.width,H=input.height,N=W*H,regions=input.regions.slice(),strokes=[],stages=[];
 const original=role=>{const s=input.stages.find(s=>s.role===role);return s?input.strokes.slice(s.start,s.end).map(s=>({...s})):[];};
 const sketch=original('sketch'),oldInk=original('ink'),ink=oldInk.filter(s=>s.kind!=='fill');
 if(!ink.length){const region=regions.length;regions.push([0x18171b,0,[],0,[0,0,W,H]]);for(const s of sketch)ink.push({...s,region,layer:'ink',phase:1,kind:'line',width:.85,opacity:.72});}
 const expand=steps=>steps.flatMap(s=>s.kind==='fill'?(s.regions||[s.region]).flatMap(id=>fillComponents(regions[id],W*.30,H*.18).map(r=>{const region=regions.length;regions.push(r);return {...s,region,regions:undefined,layer:'paint'};})):[]);
 const base=expand(original('base')),detail=expand([...original('detail'),...oldInk.filter(s=>s.kind==='fill')]);
 // A truly broad, solid final-colour field is also underpainting. A sparse
 // collection with a large bounding box is never promoted to a broad field.
 const local=[],baseFinal=[];for(const s of detail){const r=regions[s.region],b=r[4],density=r[3]/Math.max(1,(b[2]-b[0])*(b[3]-b[1]));if(r[3]>N*.06&&density>.45)baseFinal.push({...s,phase:2});else local.push(s);}
 let block=0,groupCount=0;
 const bounds=items=>items.reduce((b,s)=>{const a=regions[s.region][4];return [Math.min(b[0],a[0]),Math.min(b[1],a[1]),Math.max(b[2],a[2]),Math.max(b[3],a[3])];},[W,H,0,0]);
 const center=b=>[(b[0]+b[2])/2,(b[1]+b[3])/2];
 const group=items=>{const b=bounds(items),area=items.reduce((n,s)=>n+regions[s.region][3],0);groupCount++;return {...items[0],regions:items.map(s=>s.region),block:block++,length:Math.max(20,Math.sqrt(area)*3),points:[b[0],b[1],1,b[2],b[3],1],workBounds:b};};
 const arrange=(items,isBase)=>{
  const pending=new Set(items),groups=[];
  // Every polygon must fit inside the work area's extent, not just have its
  // centre nearby. Long connected shapes remain single, explicit shapes.
  const maxW=W*(isBase?.55:.40),maxH=H*(isBase?.32:.22);
  for(const seed of items.slice().sort((a,b)=>regions[b.region][3]-regions[a.region][3])){
   if(!pending.delete(seed))continue;const members=[seed];let b=bounds(members);
   if(b[2]-b[0]<=maxW&&b[3]-b[1]<=maxH){
    const c=center(b),near=Array.from(pending).sort((a,d)=>{const p=center(regions[a.region][4]),q=center(regions[d.region][4]);return Math.hypot(p[0]-c[0],p[1]-c[1])-Math.hypot(q[0]-c[0],q[1]-c[1]);});
    for(const s of near){const a=regions[s.region][4],next=[Math.min(b[0],a[0]),Math.min(b[1],a[1]),Math.max(b[2],a[2]),Math.max(b[3],a[3])];if(next[2]-next[0]>maxW||next[3]-next[1]>maxH)continue;members.push(s);pending.delete(s);b=next;}
   }
   groups.push(group(members));
  }
  const ordered=[];let focus=[W*.5,H*.42];
  if(isBase){groups.sort((a,b)=>regions[b.region][3]-regions[a.region][3]);return groups;}
  while(groups.length){let best=0,score=Infinity;for(let i=0;i<groups.length;i++){const c=center(groups[i].workBounds),d=Math.hypot(c[0]-focus[0],c[1]-focus[1]);if(d<score){score=d;best=i;}}const s=groups.splice(best,1)[0];ordered.push(s);focus=center(s.workBounds);}
  return ordered;
 };
 for(const [role,name,list] of [['sketch','草稿 · 概括轮廓',sketch],['ink','线稿 · 平滑勾线',ink],['base','底色 · 大块铺色',arrange(base,true).concat(arrange(baseFinal,true))],['detail','阴影高光 · 局部完善',arrange(local,false)]]){
  const start=strokes.length;strokes.push(...list);stages.push({role,name,start,end:strokes.length,kind:role==='sketch'||role==='ink'?'brush':'fill',length:list.reduce((n,s)=>n+s.length,0)});
 }
 const compact=[],remap=new Map(),map=id=>{if(!remap.has(id)){remap.set(id,compact.length);compact.push(regions[id]);}return remap.get(id);};
 for(const s of strokes){s.region=map(s.region);if(s.regions)s.regions=s.regions.map(map);}
 return progressiveBaseFill({...input,regions:compact,revision:12,algorithm:'connected-local-fill',strokes,stages,stats:{...input.stats,localFillGroups:groupCount,brushStrokes:strokes.length}});
}
