import {parseMarkdown} from './render.js';
import {safeBrowserUrl} from './url-policy.js';
export {safeBrowserUrl};
export function linkAt(raw,position,markdown=true){
  if(markdown){const tree=parseMarkdown(raw),definitions=new Map();let found=null;
  const collect=n=>{if(n.type==='definition')definitions.set(n.identifier.toLowerCase(),n.url);for(const c of n.children||[])collect(c);};collect(tree);
  const visit=n=>{if(n.position&&position>=n.position.start.offset&&position<=n.position.end.offset){if(n.type==='link')found=safeBrowserUrl(n.url);if(n.type==='linkReference')found=safeBrowserUrl(definitions.get(n.identifier.toLowerCase()));}for(const c of n.children||[])visit(c);};visit(tree);if(found)return found;}
  const from=markdown?0:Math.max(0,position-8192),target=markdown?raw:raw.slice(from,position+8192);
  for(const m of target.matchAll(/https?:\/\/[^\s<>"`]+/gi)){let text=m[0].replace(/[.,;:!?。、]+$/u,'');while(text.endsWith(')')&&(text.match(/\)/g)||[]).length>(text.match(/\(/g)||[]).length)text=text.slice(0,-1);if(position>=from+m.index&&position<=from+m.index+text.length)return safeBrowserUrl(text);}
  return null;
}
export function outlineFromHeadings(headings,raw){return headings.map((h,i)=>{const next=headings.slice(i+1).find(n=>n.level<=h.level);const end=next?.from??raw.length;let foldTo=end;while(foldTo>h.to&&/[\r\n]/.test(raw[foldTo-1]))foldTo--;return {...h,id:'heading-'+h.from,end,foldTo};});}
