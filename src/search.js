import {host,isDesktop} from './bridge.js';
export {regexSamples} from './search-core.js';
const searchCache=new WeakMap();
export async function searchText(request,document){
  if(isDesktop){
    if(!document)return host('search.run',request);
    let entry=searchCache.get(document);
    if(!entry || entry.id!==document.id || entry.revision!==document.revision || entry.text!==request.text){
      entry={id:document.id,revision:document.revision,text:request.text,token:crypto.randomUUID(),ready:false};
      searchCache.set(document,entry);
    }
    const {text,...options}=request;
    const args={...options,docId:entry.id,cacheToken:entry.token};
    let result=await host('search.run',entry.ready?args:{...args,text});
    if(result?.cacheMiss)result=await host('search.run',{...args,text});
    entry.ready=true;
    return result;
  }
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./search-worker.js',import.meta.url),{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(new Error('検索に時間がかかりすぎました。正規表現を簡単にしてください。'));},1500);const finish=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=e=>{finish();e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);};worker.onerror=()=>{finish();reject(new Error('検索できませんでした。式を確認してください。'));};worker.postMessage(request);});
}
