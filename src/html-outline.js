import {parser} from '@lezer/html';

const ignored = new Set(['script','style','noscript','template','iframe','frame','frameset','object','embed','applet','svg','math','textarea','title']);
const hiddenText = 'script,style,noscript,template,iframe,frame,frameset,object,embed,applet,svg,math';
let previousRaw, previousHeadings;
// This is a confirmation threshold, not a size limit: a larger document is
// still navigable after the user explicitly requests its outline.
export const HTML_OUTLINE_MANUAL_THRESHOLD=2*1024*1024;

export function htmlHeadingText(node){return (node.textContent||'').replace(/\s+/gu,' ').trim();}

// Parse HTML as HTML, never with a regex: fake tags in comments, scripts and
// quoted attributes must not become navigation entries. Template contents are
// inert; no external resources are loaded while extracting text.
export function htmlOutline(raw){
  if(raw===previousRaw)return previousHeadings;
  const headings=[];
  parser.parse(raw).iterate({enter(ref){
    if(ref.name==='Element'){
      const node=ref.node;const open=node.getChild('OpenTag');const name=open?.getChild('TagName');
      const tag=name?raw.slice(name.from,name.to).toLowerCase():'';
      if(ignored.has(tag))return false;
      if(/^h[1-6]$/.test(tag)){
        const close=node.getChild('CloseTag');
        const end=close?.from??node.to;
        const fragment=document.createElement('template');
        fragment.innerHTML=raw.slice(open.to,end);
        for(const n of fragment.content.querySelectorAll(hiddenText))n.remove();
        for(const n of fragment.content.querySelectorAll('h1,h2,h3,h4,h5,h6'))n.remove();
        headings.push({level:Number(tag[1]),from:open.from,to:close?.to??node.to,text:htmlHeadingText(fragment.content)});
      }
    }
  }});
  // Build the hierarchy in linear time. HTML exports often contain many
  // headings; repeatedly scanning all following headings is quadratic.
  const stack=[],trimmed=new Map();
  const finish=(h,end)=>{
    let tail=trimmed.get(end);
    if(tail===undefined){tail=end;while(tail>0&&/[\r\n]/.test(raw[tail-1]))tail--;trimmed.set(end,tail);}
    h.end=end;h.foldTo=Math.max(h.to,tail);h.id='heading-'+h.from;
  };
  for(const h of headings){while(stack.length&&stack.at(-1).level>=h.level)finish(stack.pop(),h.from);stack.push(h);}
  while(stack.length)finish(stack.pop(),raw.length);
  previousRaw=raw;previousHeadings=headings;
  return previousHeadings;
}

// Both markup and anchors are generated after sanitization. User-provided IDs
// are sanitized/prefixed by DOMPurify and cannot forge these local anchors.
export function addHtmlOutlineAnchors(fragment,raw){
  const candidates=htmlOutline(raw),byLabel=new Map();let cursor=0;
  for(let i=0;i<candidates.length;i++){
    const h=candidates[i],key=h.level+'\0'+h.text;
    if(!byLabel.has(key))byLabel.set(key,{indices:[],position:0});
    byLabel.get(key).indices.push(i);
  }
  for(const heading of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    const level=Number(heading.localName[1]),text=htmlHeadingText(heading);
    const match=byLabel.get(level+'\0'+text);if(!match)continue;
    while(match.position<match.indices.length&&match.indices[match.position]<cursor)match.position++;
    if(match.position===match.indices.length)continue;
    const index=match.indices[match.position++];
    const anchor=document.createElement('span');anchor.id='mdsplit-heading-'+candidates[index].from;anchor.setAttribute('aria-hidden','true');heading.prepend(anchor);cursor=index+1;
  }
}
