import {currentUiLanguage} from './i18n.js';
const tr=(ja,en)=>currentUiLanguage()==='en'?en:ja;
const searchErrors={'置換後の文章が64MBを超えます。':'The replacement exceeds 64 MB.','検索対象または式が大きすぎます。':'The search text or expression is too large.','一致が10万件を超えました。検索条件を絞ってください。':'There are more than 100,000 matches. Narrow the search.'};
const translateSearchError=message=>currentUiLanguage()==='en'?(searchErrors[message]||message):message;
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
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./search-worker.js',import.meta.url),{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(new Error(tr('検索に時間がかかりすぎました。正規表現を簡単にしてください。','The search took too long. Simplify the regular expression.')));},1500);const finish=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=e=>{finish();e.data.error?reject(new Error(translateSearchError(e.data.error))):resolve(e.data.result);};worker.onerror=()=>{finish();reject(new Error(tr('検索できませんでした。式を確認してください。','Could not search. Check the expression.')));};worker.postMessage(request);});
}
