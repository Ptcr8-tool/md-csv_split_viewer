import {imageUrlRange} from './document.js';
import {parseMarkdown} from './render.js';
import {lineAt} from './editing.js';

// A details body is Markdown even when mdast groups the enclosing HTML into one
// node. Keep this independent of the active renderer/tab when saving a document.
function detailsRange(raw,from,limit){
  const tags=/<\/?details\b[^>]*>/gi;
  let depth=0,fence=null,at=lineAt(raw,from).start;
  while(at<limit){
    const current=lineAt(raw,at),lineEnd=Math.min(current.end,limit);
    const line=raw.slice(at,lineEnd);
    const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){
      if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;
    }else if(marker&&(marker[1][0]!=='`'||!marker[2].includes('`'))){
      fence={char:marker[1][0],length:marker[1].length};
    }else if(!/^(?: {4}|\t)/.test(line)||at<=from&&from<lineEnd){
      tags.lastIndex=Math.max(from,at);
      let token;
      while((token=tags.exec(raw))&&token.index<lineEnd){
        if(tags.lastIndex>limit)return null;
        depth+=token[0].startsWith('</')?-1:1;
        if(depth===0){
          const headerEnd=raw.indexOf('>',from)+1,closeStart=token.index;
          const summary=/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/i.exec(raw.slice(headerEnd,closeStart));
          return {end:tags.lastIndex,closeStart,bodyStart:summary?headerEnd+summary.index+summary[0].length:headerEnd};
        }
      }
    }
    if(!current.eol||lineEnd===limit)break;
    at=current.end+current.eol.length;
  }
  return null;
}

export function collectImageReferences(raw,extras=[]){
  const references=new Map();
  const collect=(node,base)=>{
    if(node.type==='image'){
      const from=base+node.position.start.offset,to=base+node.position.end.offset;
      const range=imageUrlRange(raw,from,to);
      if(range)references.set(from,{from,to,url:node.url,...range});
    }
    // Raw HTML and code are displayed literally; do not scan their contents.
    if(node.type==='html'||node.type==='code'||node.type==='inlineCode')return;
    for(const child of node.children||[])collect(child,base);
  };
  const blocks=(source,base)=>{
    const nodes=parseMarkdown(source).children,limit=base+source.length;
    for(let i=0;i<nodes.length;i++){
      const node=nodes[i],from=base+node.position.start.offset;
      const details=node.type==='html'&&/^<details\b/i.test(raw.slice(from))?detailsRange(raw,from,limit):null;
      if(details){
        blocks(raw.slice(details.bodyStart,details.closeStart),details.bodyStart);
        while(i+1<nodes.length&&base+nodes[i+1].position.start.offset<details.end)i++;
        const overshoot=base+nodes[i].position.end.offset;
        if(overshoot>details.end)blocks(raw.slice(details.end,overshoot),details.end);
      }else collect(node,base);
    }
  };
  blocks(raw,0);
  // Renderer hints may be stale after another pane edits the document. Accept
  // only ranges and URLs that are still recognized in the current source.
  for(const extra of extras||[]){
    if(!extra||typeof extra!=='object')continue;
    const current=references.get(extra.from);
    if(current&&extra.to===current.to&&extra.url===current.url)references.set(current.from,{...extra,...current});
  }
  return [...references.values()].sort((a,b)=>a.from-b.from);
}
