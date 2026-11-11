const {chromium,launchOptions}=require('./browser-runtime.cjs');
const fs=require('fs');
(async()=>{const b=await chromium.launch(launchOptions);try{
 const p=await b.newPage();await p.addScriptTag({content:['curves.js','line-plan.js','engine.js','brush-plan.js'].map(f=>fs.readFileSync('src/runtime/'+f,'utf8')).join('\n')});
 const start=Date.now(),json=await p.evaluate(async url=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0);const input={width:c.width,height:c.height,pixels:ctx.getImageData(0,0,c.width,c.height).data.buffer};return JSON.stringify(planBrush(reconstruct(input,()=>{}),()=>{}));},'data:image/png;base64,'+fs.readFileSync('samples/reference.png').toString('base64'));
 fs.writeFileSync('samples/sample-v3.json',json);require('child_process').execFileSync(process.execPath,['scripts/prepare-fill-sample.cjs'],{stdio:'inherit'});const data=JSON.parse(json);console.log(JSON.stringify({seconds:(Date.now()-start)/1000,stats:data.stats,stages:data.stages}));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
