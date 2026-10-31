import {safeBrowserUrl} from './url-policy.js';
const listeners=new Set(), pending=new Map();
let serial=0;
export const isDesktop=typeof window!=='undefined'&&!!window.chrome?.webview;
if(isDesktop)window.chrome.webview.addEventListener('message',e=>{
  const data=e.data;
  if(data.replyTo){const job=pending.get(data.replyTo);if(!job)return;clearTimeout(job.timer);pending.delete(data.replyTo);if(data.error)job.reject(new Error(data.error));else job.resolve(data.result);}
  else for(const fn of listeners)fn(data);
});
export function onHost(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
export async function host(method,args={},additionalObjects){
  if(!isDesktop){
    if(method==='bootstrap')return {settings:JSON.parse(localStorage.getItem('mdsplit.settings')||'{}'),documents:[]};
    if(method==='settings.set'){localStorage.setItem('mdsplit.settings',JSON.stringify(args));return args;}
    if(method==='recovery.write'){localStorage.setItem('mdsplit.recovery',JSON.stringify(args));return true;}
    if(method==='shell.open'){const url=safeBrowserUrl(args.url);if(!url)throw new Error('安全なHTTP・HTTPSのURLを指定してください。');window.open(url,'_blank','noopener');return true;}
    if(method==='window.title'){document.title=args.title;return true;}
    if(method==='clipboard.text'){await navigator.clipboard.writeText(args.text);return true;}
    if(method==='clipboard.readText')return navigator.clipboard.readText();
    throw new Error('この操作はWindows版で利用できます。');
  }
  const id=String(++serial);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('処理が完了しませんでした。もう一度お試しください。'));},method==='update.download'?21*60*1000:120000);
    pending.set(id,{resolve,reject,timer});
    try{
      if(additionalObjects!==undefined){
        if(typeof window.chrome.webview.postMessageWithAdditionalObjects!=='function')throw new Error('この表示環境ではファイルのドロップを扱えません。開くボタンから選択してください。');
        window.chrome.webview.postMessageWithAdditionalObjects({id,method,args},additionalObjects);
      }else window.chrome.webview.postMessage({id,method,args});
    }catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
}
