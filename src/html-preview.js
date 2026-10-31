import createDOMPurify from 'dompurify';
import {addHtmlOutlineAnchors} from './html-outline.js';

const resourceAttributes=new Set(['href','xlink:href','srcset','imagesrcset','imagesizes','ping','action','formaction','target','download','poster','background','cite','longdesc','manifest','profile','codebase','data','archive','srcdoc','lowsrc','dynsrc','usemap','form','autofocus','autoplay','contenteditable','nonce','integrity','is']);
const forbiddenTags=['script','noscript','iframe','frame','frameset','object','embed','applet','base','meta','link','form','input','button','select','textarea','option','audio','video','source','track','portal','fencedframe','svg','math','template'];
const rasterDataUrl=/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\r\n]+$/i;
const cssWithoutResources=value=>{
  const css=value.replace(/\/\*[\s\S]*?\*\//g,'');
  // A deliberately conservative subset: escaped spellings and resource-bearing
  // declarations are omitted rather than trying to rewrite arbitrary CSS.
  return /\\|@import|@namespace|@font-face|url\s*\(|image-set\s*\(|(?:^|[;{\s])(?:src|behavior|-moz-binding)\s*:|expression\s*\(/i.test(css)?'':css;
};
const htmlCsp="default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'none'; font-src 'none'; media-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export function buildHtmlPreview(raw,{fontSize=14}={}){
  if(typeof raw!=='string')throw new TypeError('HTMLの原文は文字列で指定してください。');
  // Template contents are inert, so raw resource attributes are never inserted
  // into the application document or a browsing context before sanitization.
  const template=document.createElement('template');template.innerHTML=raw;
  const sanitizer=createDOMPurify(window);
  sanitizer.addHook('uponSanitizeAttribute',(node,data)=>{
    const attribute=data.attrName.toLowerCase();
    if(resourceAttributes.has(attribute))data.keepAttr=false;
    else if(attribute==='src')data.keepAttr=node.nodeName==='IMG'&&rasterDataUrl.test(data.attrValue);
    else if(attribute==='style'){data.attrValue=cssWithoutResources(data.attrValue);if(!data.attrValue)data.keepAttr=false;}
  });
  sanitizer.addHook('afterSanitizeElements',node=>{if(node.nodeName==='STYLE')node.textContent=cssWithoutResources(node.textContent);});
  const clean=sanitizer.sanitize(template.content,{USE_PROFILES:{html:true},RETURN_DOM_FRAGMENT:true,ALLOW_DATA_ATTR:false,FORBID_TAGS:forbiddenTags,FORBID_ATTR:[...resourceAttributes],SANITIZE_NAMED_PROPS:true});
  addHtmlOutlineAnchors(clean,raw);
  const shell=document.createElement('div');shell.append(clean);
  const size=typeof fontSize==='number'&&Number.isFinite(fontSize)?Math.min(28,Math.max(11,fontSize)):14;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="'+htmlCsp+'"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light}body{margin:20px;background:#fff;color:#202124;font:'+size+'px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:5px 8px}pre{white-space:pre-wrap}a{cursor:text}</style></head><body>'+shell.innerHTML+'</body></html>';
}
