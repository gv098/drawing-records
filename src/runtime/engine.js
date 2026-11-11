/* Region-first reconstruction: solid vector fills, large regions before details. */
function reconstruct(input, report) {
 const {width:W,height:H,pixels}=input,N=W*H,src=new Uint8ClampedArray(pixels),rgb=new Float32Array(N*3);
 for(let i=0;i<N;i++)for(let c=0;c<3;c++)rgb[i*3+c]=src[i*4+c];
 const lum=c=>c[0]*.299+c[1]*.587+c[2]*.114;
 const pack=c=>(Math.round(c[0])<<16)|(Math.round(c[1])<<8)|Math.round(c[2]);
 const notify=(progress,stage,count=0)=>report({type:'progress',progress,stage,count});
 function paletteFor(image,K){
  const bins=new Map();
  for(let i=0;i<N;i+=2){const j=i*3,r=image[j],g=image[j+1],b=image[j+2],key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);let v=bins.get(key);if(!v){v=[0,0,0,0];bins.set(key,v);}v[0]+=r;v[1]+=g;v[2]+=b;v[3]++;}
  const samples=Array.from(bins.values(),v=>[v[0]/v[3],v[1]/v[3],v[2]/v[3],v[3]]).sort((a,b)=>b[3]-a[3]);
  const centers=[samples[0].slice(0,3)],distances=new Float64Array(samples.length).fill(Infinity);K=Math.min(K,samples.length);
  for(let k=1;k<K;k++){let best=-1,idx=0;const c=centers[k-1];for(let i=0;i<samples.length;i++){const s=samples[i],d=(s[0]-c[0])**2+(s[1]-c[1])**2+(s[2]-c[2])**2;distances[i]=Math.min(distances[i],d);const score=distances[i]*Math.sqrt(s[3]);if(score>best){best=score;idx=i;}}centers.push(samples[idx].slice(0,3));}
  for(let round=0;round<8;round++){const sums=centers.map(()=>[0,0,0,0]);for(const s of samples){let best=Infinity,idx=0;for(let k=0;k<K;k++){const c=centers[k],d=(s[0]-c[0])**2+(s[1]-c[1])**2+(s[2]-c[2])**2;if(d<best){best=d;idx=k;}}const a=sums[idx],w=s[3];for(let j=0;j<3;j++)a[j]+=s[j]*w;a[3]+=w;}for(let k=0;k<K;k++)if(sums[k][3])centers[k]=sums[k].slice(0,3).map(x=>x/sums[k][3]);}
  const cache=new Int16Array(32768).fill(-1),labels=new Uint8Array(N);
  for(let i=0;i<N;i++){const j=i*3,r=image[j],g=image[j+1],b=image[j+2],key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);let idx=cache[key];if(idx<0){let best=Infinity;for(let k=0;k<K;k++){const c=centers[k],d=(r-c[0])**2+(g-c[1])**2+(b-c[2])**2;if(d<best){best=d;idx=k;}}cache[key]=idx;}labels[i]=idx;}
  return {colors:centers,labels};
 }
 function blur(image,r){
  const temp=new Float32Array(N*3),out=new Float32Array(N*3),d=r*2+1;
  for(let y=0;y<H;y++)for(let c=0;c<3;c++){let sum=0;for(let dx=-r;dx<=r;dx++)sum+=image[(y*W+Math.max(0,Math.min(W-1,dx)))*3+c];for(let x=0;x<W;x++){temp[(y*W+x)*3+c]=sum/d;sum+=image[(y*W+Math.min(W-1,x+r+1))*3+c]-image[(y*W+Math.max(0,x-r))*3+c];}}
  for(let x=0;x<W;x++)for(let c=0;c<3;c++){let sum=0;for(let dy=-r;dy<=r;dy++)sum+=temp[(Math.max(0,Math.min(H-1,dy))*W+x)*3+c];for(let y=0;y<H;y++){out[(y*W+x)*3+c]=sum/d;sum+=temp[(Math.min(H-1,y+r+1)*W+x)*3+c]-temp[(Math.max(0,y-r)*W+x)*3+c];}}
  return out;
 }
 function flatPalette(image){
  const groups=new Map(),labels=new Uint8Array(N);
  for(let i=0;i<N;i++){
   const r=image[i*3],g=image[i*3+1],b=image[i*3+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,L=r*.299+g*.587+b*.114;
   let key;
   if(L>246&&d<16)key='background';
   else if(d<29&&L>115)key='light-neutral';
   else if(d<16)key='dark-neutral';
   else {let h=d===0?0:mx===r?((g-b)/d+6)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;key=Math.floor((h+22.5)%360/45)+'-'+(L<83?'dark':'mid');}
   if(!groups.has(key))groups.set(key,{index:groups.size,sum:[0,0,0],count:0,key});
   const a=groups.get(key);labels[i]=a.index;a.sum[0]+=r;a.sum[1]+=g;a.sum[2]+=b;a.count++;
  }
  const colors=Array.from(groups.values(),a=>{const c=a.sum.map(v=>v/a.count);return c;});
  return {colors,labels};
 }
 function mergeSmall(labels,colors,limit){
  const seen=new Uint8Array(N),queue=new Int32Array(N);
  for(let seed=0;seed<N;seed++){
   if(seen[seed])continue;const label=labels[seed];let head=0,tail=1;queue[0]=seed;seen[seed]=1;
   while(head<tail){const i=queue[head++],x=i%W,y=(i/W)|0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;const ni=ny*W+nx;if(!seen[ni]&&labels[ni]===label){seen[ni]=1;queue[tail++]=ni;}}}
   if(tail>=limit)continue;
   const neighbours=new Map();for(let k=0;k<tail;k++){const i=queue[k],x=i%W,y=(i/W)|0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;const other=labels[ny*W+nx];if(other!==label)neighbours.set(other,(neighbours.get(other)||0)+1);}}
   let best=-1,bestScore=-1;for(const [other,count] of neighbours){const a=colors[label],b=colors[other],distance=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);const score=count/(distance+12);if(score>bestScore){bestScore=score;best=other;}}
   if(best>=0)for(let k=0;k<tail;k++)labels[queue[k]]=best;
  }
 }
 function simplify(points,epsilon){
  if(points.length<=8)return points;
  const n=points.length/2,keep=new Uint8Array(n),stack=[[0,n-1]];keep[0]=keep[n-1]=1;
  while(stack.length){const [a,b]=stack.pop(),ax=points[a*2],ay=points[a*2+1],dx=points[b*2]-ax,dy=points[b*2+1]-ay,den=dx*dx+dy*dy;let max=epsilon*epsilon,index=-1;for(let i=a+1;i<b;i++){const px=points[i*2]-ax,py=points[i*2+1]-ay,t=Math.max(0,Math.min(1,(px*dx+py*dy)/(den||1))),d=(px-t*dx)**2+(py-t*dy)**2;if(d>max){max=d;index=i;}}if(index>=0){keep[index]=1;stack.push([a,index],[index,b]);}}
  const result=[];for(let i=0;i<n;i++)if(keep[i])result.push(points[i*2],points[i*2+1]);return result.length>=8?result:points;
 }
 function extract(labels,colors,minArea,epsilon){
  const visited=new Uint8Array(N),queue=new Int32Array(N),regions=[],V=W+1;
  for(let seed=0;seed<N;seed++){
   if(visited[seed])continue;
   const label=labels[seed];let head=0,tail=1;queue[0]=seed;visited[seed]=1;
   let sx=0,sy=0,minX=W,minY=H,maxX=0,maxY=0;
   while(head<tail){const i=queue[head++],x=i%W,y=(i/W)|0;sx+=x;sy+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    if(x>0&&!visited[i-1]&&labels[i-1]===label){visited[i-1]=1;queue[tail++]=i-1;}
    if(x<W-1&&!visited[i+1]&&labels[i+1]===label){visited[i+1]=1;queue[tail++]=i+1;}
    if(y>0&&!visited[i-W]&&labels[i-W]===label){visited[i-W]=1;queue[tail++]=i-W;}
    if(y<H-1&&!visited[i+W]&&labels[i+W]===label){visited[i+W]=1;queue[tail++]=i+W;}
    for(const dy of [-1,1])for(const dx of [-1,1]){const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;const j=ny*W+nx;if(!visited[j]&&labels[j]===label){visited[j]=1;queue[tail++]=j;}}
   }
   if(tail<minArea)continue;
   const starts=new Map(),edges=[];
   function add(a,b,d){const k=edges.length;edges.push([a,b,d,false]);if(!starts.has(a))starts.set(a,[]);starts.get(a).push(k);}
   for(let q=0;q<tail;q++){const i=queue[q],x=i%W,y=(i/W)|0,a=y*V+x;
    if(y===0||labels[i-W]!==label)add(a,a+1,0);
    if(x===W-1||labels[i+1]!==label)add(a+1,a+1+V,1);
    if(y===H-1||labels[i+W]!==label)add(a+1+V,a+V,2);
    if(x===0||labels[i-1]!==label)add(a+V,a,3);
   }
   const paths=[];
   for(let ei=0;ei<edges.length;ei++){
    if(edges[ei][3])continue;
    const initial=edges[ei][0],path=[];let current=ei,guard=0;
    while(current>=0&&guard++<=edges.length){const e=edges[current];if(e[3])break;e[3]=true;path.push(e[0]%V,(e[0]/V)|0);if(e[1]===initial){path.push(initial%V,(initial/V)|0);break;}
     let best=-1,bestRank=99;for(const candidate of starts.get(e[1])||[]){const ne=edges[candidate];if(ne[3])continue;const turn=(ne[2]-e[2]+4)%4,rank=turn===1?0:turn===0?1:turn===3?2:3;if(rank<bestRank){bestRank=rank;best=candidate;}}current=best;
    }
    if(path.length>=8)paths.push(simplify(path,epsilon));
   }
   const color=colors[label];regions.push({color:pack(color),luma:lum(color),paths,area:tail,cx:sx/tail,cy:sy/tail,bounds:[minX,minY,maxX+1,maxY+1],label,seed});
  }
  return regions;
 }
 notify(.02,'合并大色块');
 const radius=Math.max(1,Math.round(Math.max(W,H)/1137*9)),coarse=flatPalette(blur(rgb,radius));
 for(let pass=0;pass<2;pass++){const old=coarse.labels.slice();for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x,counts=new Uint8Array(coarse.colors.length);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)counts[old[i+dy*W+dx]]++;let best=old[i];for(let k=0;k<counts.length;k++)if(counts[k]>counts[best])best=k;coarse.labels[i]=best;}}
 mergeSmall(coarse.labels,coarse.colors,Math.max(40,Math.round(N/900)));
 const baseRegions=extract(coarse.labels,coarse.colors,1,.8);
 notify(.18,'建立中间色调',baseRegions.length);
 const midRadius=2,mid=paletteFor(blur(rgb,midRadius),24),midMerge=Math.max(24,Math.round(N/3200));
 for(let pass=0;pass<2;pass++)mergeSmall(mid.labels,mid.colors,midMerge);
 const midRegions=extract(mid.labels,mid.colors,1,.62).sort((a,b)=>b.area-a.area);
 notify(.30,'提取阴影、高光与轮廓',baseRegions.length+midRegions.length);
 const fine=paletteFor(rgb,80);
 const regions=extract(fine.labels,fine.colors,1,.42);
 notify(.75,'安排大块铺色顺序',regions.length);
 const cornerLabels=new Set([fine.labels[0],fine.labels[W-1],fine.labels[N-1],fine.labels[N-W]]),coarseCorners=new Set([coarse.labels[0],coarse.labels[W-1],coarse.labels[N-1],coarse.labels[N-W]]);
 const baseBackground=baseRegions.filter(r=>coarseCorners.has(r.label)&&r.area>N*.06).sort((a,b)=>b.area-a.area);
 const baseForeground=baseRegions.filter(r=>!baseBackground.includes(r)).sort((a,b)=>b.area-a.area);
 // The 24-colour middle layer is still underpainting. It supplies complete
 // local colour masses before the 80-colour residual layer adds fine changes.
 const groups=[baseBackground.concat(baseForeground,midRegions),[],[],[],[]],largeThreshold=Math.max(50,N/9000);
 for(const r of regions){
  const sample=Math.min(N-1,Math.round(r.cy)*W+Math.round(r.cx)),baseL=lum(coarse.colors[coarse.labels[sample]]);
  const thin=r.area/Math.max(1,(r.bounds[2]-r.bounds[0])*(r.bounds[3]-r.bounds[1]))<.26;
  const isInk=r.luma<58&&(thin||r.area<N*.01),bg=cornerLabels.has(r.label)&&r.area>N*.06;
  if(bg)groups[3].push(r);else if(isInk||r.area<8)groups[4].push(r);else if(r.area>=largeThreshold)groups[r.luma<baseL-4?1:2].push(r);else groups[3].push(r);
 }
 // Small vector fragments form one local colour layer. Preserve fine edges
 // without asking the viewer to watch thousands of single-pixel operations.
 for(let stage=3;stage<5;stage++){
  const large=[],batches=new Map();
  for(const r of groups[stage]){
   if(r.area>=120){large.push(r);continue;}
   const key=r.color+':'+Math.floor(r.cx/160)+':'+Math.floor(r.cy/160);
   if(!batches.has(key))batches.set(key,{...r,paths:[],area:0,bounds:[W,H,0,0]});
   const b=batches.get(key);b.paths.push(...r.paths);b.area+=r.area;b.bounds[0]=Math.min(b.bounds[0],r.bounds[0]);b.bounds[1]=Math.min(b.bounds[1],r.bounds[1]);b.bounds[2]=Math.max(b.bounds[2],r.bounds[2]);b.bounds[3]=Math.max(b.bounds[3],r.bounds[3]);
  }
  groups[stage]=large.concat(Array.from(batches.values()));
 }
 for(let i=1;i<5;i++)groups[i].sort((a,b)=>b.area-a.area);
 const names=['大面积底色','成片阴影','亮部与色彩','局部与装饰','线稿与收边'],strokes=[],stages=[];
 for(let i=0;i<groups.length;i++){const start=strokes.length;for(const r of groups[i])strokes.push([r.color,0,r.paths,r.area,r.bounds]);stages.push({name:names[i],start,end:strokes.length,kind:'fill',area:groups[i].reduce((s,r)=>s+r.area,0)});}
 notify(1,'铺色路径已生成',strokes.length);
 let inkPaths=extractInk(input);
 // Flat graphics without dark ink still need a visible structural outline.
 if(inkPaths.reduce((n,p)=>n+curveLength(p),0)<(W+H)*.3)inkPaths=baseForeground.filter(r=>r.area>20).flatMap(r=>r.paths.filter(p=>curveLength(p)>10).map(p=>smoothCurve(p,true,1.2)));
 return {version:2,width:W,height:H,background:'#ffffff',algorithm:'region-first-layered-fills',inkPaths,stages,strokes,stats:{baseRegions:groups[0].length,coarseRegions:baseRegions.length,midRegions:midRegions.length,baseForeground:baseForeground.length,largestForegroundArea:baseForeground[0]?.area||0,palette:80}};
}
if(typeof self!=='undefined')self.onmessage=e=>{try{
 if(e.data.fillData){self.postMessage({type:'done',data:organizeFillPlayback(e.data.fillData)});return;}
 const mode=e.data.mode||'brush';
 const vector=e.data.vector||reconstruct(e.data,m=>self.postMessage({...m,progress:m.progress*(mode==='fill'?.9:.55)}));
 let data;
 if(mode==='fill'){
  self.postMessage({type:'progress',progress:.92,stage:'整理色块与线稿',count:vector.strokes.length});
  data=planFill(vector);
 }else data=planBrush(vector,m=>self.postMessage({...m,progress:e.data.vector?m.progress:.55+m.progress*.45}));
 self.postMessage({type:'done',data,...(!e.data.vector?{vector}:{})});
}catch(error){self.postMessage({type:'error',message:error.message});}};
