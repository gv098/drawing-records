const DRAWING_CACHE_VERSION=1;
const deletedRecordIds=new Set();
let cacheConnection=null,cacheAttempt=null,cacheRecoveryAction=null,cacheWrites=Promise.resolve(),sourceRecordId=null,sourceThumbnail='';
// Content keys work over LAN HTTP too. Compare the complete URL before reuse.
function drawingKey(url){
 let a=2166136261,b=5381;
 for(let i=0;i<url.length;i++){const c=url.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}
 return url.length+'-'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16);
}
function drawingSummary(record){
 return {id:record.id,label:record.label,thumbnail:record.thumbnail||'',updated:record.updated,mode:record.mode,ready:Object.keys(record.modes||{}).length>0};
}
function cacheErrorMessage(error){
 if(error?.name==='CacheBlockedError')return '另一个旧页面正在占用记录。请关闭其他“绘画记录”标签页，再点“重新读取”。';
 if(error?.name==='CacheTimeoutError')return '读取本机记录超时，请点“重新读取”再试。';
 if(error?.name==='SecurityError'||error?.name==='ReferenceError')return '浏览器不允许此页面使用本地存储，请检查网站存储权限后重试。';
 if(error?.name==='VersionError')return '这个页面的版本较旧，请刷新页面后重试。';
 if(error?.name==='QuotaExceededError')return '本机存储空间不足，暂时无法保存新的记录。';
 return '本机记录暂时无法读取，请点“重新读取”再试。'+(error?.name?'（'+error.name+'）':'');
}
function cacheOpenError(name){const error=new Error(name);error.name=name;return error;}
function recoverDrawingCache(){
 const resume=cacheRecoveryAction;cacheRecoveryAction=null;
 if(resume)resume();
 else if(!sourceIsSample)saveCurrentDrawing();
 if($('historyDialog').open)renderHistory();
}
function openDrawingCache(){
 if(cacheConnection)return Promise.resolve(cacheConnection);
 // A blocked request may still complete after the other tab closes. Keep that
 // request, but never keep a rejected promise as the permanent connection.
 if(cacheAttempt)return cacheAttempt.error?Promise.reject(cacheAttempt.error):cacheAttempt.promise;
 const attempt={promise:null,error:null};cacheAttempt=attempt;
 attempt.promise=new Promise((resolve,reject)=>{
  let request;
  const fail=error=>{attempt.error=error;reject(error);};
  try{request=indexedDB.open('drawing-records',2);}catch(error){cacheAttempt=null;fail(error);return;}
  const timer=setTimeout(()=>fail(cacheOpenError('CacheTimeoutError')),10000);
  request.onupgradeneeded=()=>{
   const db=request.result,tx=request.transaction;
   if(!db.objectStoreNames.contains('session'))db.createObjectStore('session');
   if(!db.objectStoreNames.contains('drawings'))db.createObjectStore('drawings',{keyPath:'id'});
   if(!db.objectStoreNames.contains('summaries'))db.createObjectStore('summaries',{keyPath:'id'});
   const session=tx.objectStore('session'),old=session.get('last');
   old.onsuccess=()=>{
    if(!old.result?.url)return;
    const record={...old.result,id:drawingKey(old.result.url),updated:Date.now()};
    tx.objectStore('drawings').put(record);tx.objectStore('summaries').put(drawingSummary(record));
    session.put(record.id,'lastId');session.delete('last');
   };
  };
  request.onsuccess=()=>{
   clearTimeout(timer);const db=request.result;if(cacheAttempt===attempt)cacheAttempt=null;
   if(cacheConnection){db.close();resolve(cacheConnection);return;}cacheConnection=db;
   const release=()=>{if(cacheConnection===db)cacheConnection=null;};
   db.onversionchange=()=>{db.close();release();};db.onclose=release;
   resolve(db);
   if(attempt.error||cacheRecoveryAction)setTimeout(recoverDrawingCache,0);
  };
  request.onerror=()=>{clearTimeout(timer);if(cacheAttempt===attempt)cacheAttempt=null;fail(request.error);};
  request.onblocked=()=>{clearTimeout(timer);fail(cacheOpenError('CacheBlockedError'));};
 });
 return attempt.promise;
}
async function cacheTransaction(stores,mode,operation,retry=true){
 const db=await openDrawingCache();
 let tx;
 try{tx=db.transaction(stores,mode);}catch(error){
  if(retry&&error.name==='InvalidStateError'){
   db.close();if(cacheConnection===db)cacheConnection=null;
   return cacheTransaction(stores,mode,operation,false);
  }
  throw error;
 }
 return new Promise((resolve,reject)=>{
  tx.onerror=tx.onabort=()=>reject(tx.error||new Error('本地保存失败'));
  const request=operation(tx);tx.oncomplete=()=>resolve(request?.result);
 });
}
async function readDrawing(id){
 const [record,summary]=await Promise.all([cacheTransaction(['drawings'],'readonly',tx=>tx.objectStore('drawings').get(id)),cacheTransaction(['summaries'],'readonly',tx=>tx.objectStore('summaries').get(id))]);
 if(record&&summary){record.mode=summary.mode||record.mode;record.label=summary.label||record.label;record.updated=summary.updated;}return record;
}
async function findSavedDrawing(url){
 try{
  const base=drawingKey(url);
  for(let i=0;;i++){
   const id=base+(i?'-'+i:''),record=await readDrawing(id);
   if(!record||record.url===url)return {id,record};
  }
 }catch(error){return {id:null,record:null,error};}
}
async function readSavedDrawing(){
  const id=await cacheTransaction(['session'],'readonly',tx=>tx.objectStore('session').get('lastId'));
  return id?await readDrawing(id):null;
}
function saveCurrentDrawing({metadataOnly=false}={}){
 const thisRun=runId;
 const record=sourceIsSample?null:{id:sourceRecordId,schema:DRAWING_CACHE_VERSION,url:sourceURL,label:sourceLabel,thumbnail:sourceThumbnail,mode:activeMode,modes:{...modeData},vector:sourceVector,updated:Date.now()};
 if(record&&deletedRecordIds.has(record.id)){$('saveStatus').textContent='已从记录删除';return cacheWrites;}
 $('saveStatus').textContent=record?'正在保存到本机…':'';
 cacheWrites=cacheWrites.catch(()=>{}).then(async()=>{
  if(thisRun!==runId||(record&&deletedRecordIds.has(record.id)))return;
  try{
   if(record&&!record.id){const found=await findSavedDrawing(record.url);record.id=found.id;if(thisRun===runId)sourceRecordId=record.id;if(!record.id)throw found.error||new Error('记录不可用');}
   if(record&&deletedRecordIds.has(record.id))return;
   await cacheTransaction(['session','drawings','summaries'],'readwrite',tx=>{
    const session=tx.objectStore('session');
    if(!record)return session.delete('lastId');
    if(!metadataOnly)tx.objectStore('drawings').put(record);tx.objectStore('summaries').put(drawingSummary(record));
    return session.put(record.id,'lastId');
   });
   if(thisRun===runId)$('saveStatus').textContent=record?(Object.keys(record.modes).length?'已保存在本机':'图片已保存在本机'):'';
   if($('historyDialog').open)await renderHistory();
  }catch(error){
   if(thisRun===runId&&record)$('saveStatus').textContent='本机保存失败：'+cacheErrorMessage(error);
  }
 });
 return cacheWrites;
}
let historyRender=0,historyOpen=0;
async function renderHistory(){
 const render=++historyRender,list=$('historyList');$('historyRetry').hidden=true;$('historyError').textContent='';$('historyCount').textContent='读取中…';
 try{
  const records=await cacheTransaction(['summaries'],'readonly',tx=>tx.objectStore('summaries').getAll());
  if(render!==historyRender)return;
  records.sort((a,b)=>b.updated-a.updated);list.replaceChildren();
  $('historyCount').textContent=records.length+' 张';$('historyEmpty').hidden=records.length>0;
  $('historyError').textContent='';
  for(const record of records){
   const button=document.createElement('button');button.className='history-card';button.dataset.id=record.id;
   button.setAttribute('aria-label','打开 '+record.label);
   const thumb=document.createElement('span');thumb.className='history-thumb';
   if(record.thumbnail){const img=document.createElement('img');img.src=record.thumbnail;img.alt='';img.draggable=false;thumb.append(img);}else thumb.textContent='图';
   const text=document.createElement('span');text.className='history-text';
   const title=document.createElement('strong');title.textContent=record.label;
   const state=document.createElement('span');state.textContent=record.ready?'已解析 · 点击打开':'图片已保存 · 继续生成';
   const time=document.createElement('small');time.textContent=new Date(record.updated).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   text.append(title,state,time);button.append(thumb,text);attachHistoryGestures(button,record);list.append(button);
  }
 }catch(error){
  if(render!==historyRender)return;list.replaceChildren();$('historyEmpty').hidden=true;$('historyCount').textContent='';$('historyError').textContent=cacheErrorMessage(error);$('historyRetry').hidden=false;
 }
}
let deletingHistory=false,historyDeleteTarget=null;
function offerHistoryDelete(record){
 if(deletingHistory||$('deleteHistoryDialog').open)return;
 historyOpen++;
 historyDeleteTarget={id:record.id,label:record.label};
 $('deleteHistoryName').textContent=record.label;$('deleteHistoryError').textContent='';
 $('deleteHistoryDialog').showModal();
}
function attachHistoryGestures(button,record){
 let timer=null,start=null,suppressClick=false;
 const cancel=()=>{clearTimeout(timer);timer=null;start=null;};
 button.addEventListener('pointerdown',event=>{
  cancel();suppressClick=false;
  if(event.button!==0||!event.isPrimary)return;
  start={x:event.clientX,y:event.clientY};
  timer=setTimeout(()=>{timer=null;start=null;if(!button.isConnected||!$('historyDialog').open)return;suppressClick=true;offerHistoryDelete(record);},550);
 });
 button.addEventListener('pointermove',event=>{if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10){suppressClick=true;cancel();}});
 for(const type of ['pointerup','pointercancel','pointerleave','lostpointercapture'])button.addEventListener(type,cancel);
 button.addEventListener('contextmenu',event=>{event.preventDefault();cancel();suppressClick=true;offerHistoryDelete(record);});
 button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){suppressClick=false;cancel();}if(event.key==='Delete'||(event.shiftKey&&event.key==='F10')){event.preventDefault();offerHistoryDelete(record);}});
 button.addEventListener('click',event=>{if(suppressClick){event.preventDefault();suppressClick=false;return;}cancel();openHistoryDrawing(record.id);});
}
async function deleteHistoryRecord(){
 if(deletingHistory||!historyDeleteTarget)return;
 const {id}=historyDeleteTarget;deletingHistory=true;deletedRecordIds.add(id);
 $('confirmHistoryDelete').disabled=$('cancelHistoryDelete').disabled=true;$('confirmHistoryDelete').textContent='正在删除…';
 const deletion=cacheWrites.catch(()=>{}).then(()=>cacheTransaction(['session','drawings','summaries'],'readwrite',tx=>{
  tx.objectStore('drawings').delete(id);tx.objectStore('summaries').delete(id);
  const session=tx.objectStore('session'),last=session.get('lastId');
  last.onsuccess=()=>{if(last.result===id)session.delete('lastId');};
  return last;
 }));
 cacheWrites=deletion.catch(()=>{});
 try{
  await deletion;
  if(sourceRecordId===id)$('saveStatus').textContent='已从记录删除';
  $('deleteHistoryDialog').close();await renderHistory();say('已删除这条绘画记录');
  ($('historyList').querySelector('button')||$('closeHistory')).focus();
 }catch(error){deletedRecordIds.delete(id);$('deleteHistoryError').textContent='删除失败：'+cacheErrorMessage(error);}
 finally{deletingHistory=false;$('confirmHistoryDelete').disabled=$('cancelHistoryDelete').disabled=false;$('confirmHistoryDelete').textContent='删除记录';}
}
$('confirmHistoryDelete').onclick=deleteHistoryRecord;
$('cancelHistoryDelete').onclick=()=>{$('deleteHistoryDialog').close();};
$('deleteHistoryDialog').addEventListener('cancel',event=>{if(deletingHistory)event.preventDefault();});
$('deleteHistoryDialog').addEventListener('close',()=>{historyDeleteTarget=null;});
async function openHistoryDrawing(id){
 const request=++historyOpen,currentRun=runId;
 try{
  const record=await readDrawing(id);
  if(request!==historyOpen||currentRun!==runId||!$('historyDialog').open)return;
  if(!record)throw new Error('记录不存在');
  $('historyDialog').close();activeMode=record.mode==='brush'?'brush':'fill';
  await loadImage(record.url,record.label,false,record);
 }catch{$('historyError').textContent='这条记录暂时无法打开，请重试。';}
}
$('openHistory').onclick=()=>{$('historyDialog').showModal();renderHistory();};
$('historyRetry').onclick=()=>{if(cacheAttempt?.error?.name==='CacheTimeoutError')cacheAttempt=null;renderHistory();};
$('closeHistory').onclick=()=>{$('historyDialog').close();};
$('historyUpload').onclick=()=>{$('historyDialog').close();$('upload').click();};
async function restoreDrawing(){
 const initialRun=runId;$('genText').textContent='正在读取上次图片…';
 let saved;
 try{saved=await readSavedDrawing();}
 catch(error){
  if(runId!==initialRun)return;
  // A failed read is not an empty library. Never overwrite the last selection.
  await loadImage(SAMPLE,'蓝发角色插画',true,null,false);
  if(runId!==initialRun+1)return;
  const fallbackRun=runId;
  $('saveStatus').textContent=cacheErrorMessage(error);
  cacheRecoveryAction=()=>{if(runId===fallbackRun)return restoreDrawing();};
  if(cacheConnection)setTimeout(recoverDrawingCache,0);
  return;
 }
 if(runId!==initialRun)return;
 if(saved?.url){activeMode=saved.mode==='brush'?'brush':'fill';await loadImage(saved.url,saved.label||'上次上传',false,saved);}
 else await loadImage(SAMPLE,'蓝发角色插画',true,null,false);
}
