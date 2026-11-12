import {parseMarkdown} from './render.js';
import {safeBrowserUrl} from './url-policy.js';

// Release notes come from GitHub, so build the display from DOM nodes instead
// of interpreting raw HTML. Links open through the same host policy as the editor.
export function renderUpdateNotes(container, source, openLink) {
  const text=typeof source==='string'?source:'';
  try {
    const tree=parseMarkdown(text);
    const definitions=new Map();
    const key=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
    const collect=node=>{
      if(node.type==='definition')definitions.set(key(node.identifier),node);
      for(const child of node.children||[])collect(child);
    };
    collect(tree);
    const element=(tag,children)=>{const result=document.createElement(tag);for(const child of children||[])result.append(render(child));return result;};
    const link=(node,definition)=>{
      const url=safeBrowserUrl(definition?.url);
      const result=document.createElement(url?'a':'span');
      for(const child of node.children||[])result.append(render(child));
      if(url){
        result.href=url;
        if(definition.title)result.title=definition.title;
        result.addEventListener('click',event=>{event.preventDefault();openLink?.(url);});
        result.addEventListener('auxclick',event=>event.preventDefault());
      }
      return result;
    };
    const image=(node,definition)=>{
      const url=safeBrowserUrl(definition?.url),alt=node.alt||node.label||'';
      if(!url)return document.createTextNode(alt);
      const result=document.createElement('img');result.alt=alt;result.loading='lazy';result.referrerPolicy='no-referrer';
      if(definition.title)result.title=definition.title;
      result.src=url;return result;
    };
    function render(node){
      switch(node.type){
        case 'root':{const fragment=document.createDocumentFragment();for(const child of node.children||[])fragment.append(render(child));return fragment;}
        case 'definition':return document.createDocumentFragment();
        case 'paragraph':return element('p',node.children);
        case 'heading':return element('h'+Math.max(1,Math.min(6,node.depth||1)),node.children);
        case 'strong':return element('strong',node.children);
        case 'emphasis':return element('em',node.children);
        case 'delete':return element('del',node.children);
        case 'blockquote':return element('blockquote',node.children);
        case 'list':{const result=element(node.ordered?'ol':'ul',node.children);if(node.ordered&&node.start!=null)result.start=node.start;return result;}
        case 'listItem':{const result=element('li',node.children);if(node.checked!=null){const check=document.createElement('input');check.type='checkbox';check.disabled=true;check.checked=node.checked;result.prepend(check);}return result;}
        case 'text':case 'html':return document.createTextNode(node.value||'');
        case 'inlineCode':{const result=document.createElement('code');result.textContent=node.value||'';return result;}
        case 'code':{const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=node.value||'';pre.append(code);return pre;}
        case 'break':return document.createElement('br');
        case 'thematicBreak':return document.createElement('hr');
        case 'link':return link(node,node);
        case 'linkReference':return link(node,definitions.get(key(node.identifier)));
        case 'image':return image(node,node);
        case 'imageReference':return image(node,definitions.get(key(node.identifier)));
        case 'table':{
          const wrapper=document.createElement('div'),table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
          wrapper.className='update-notes-table';
          (node.children||[]).forEach((row,index)=>{const tr=document.createElement('tr');for(const [column,cell] of (row.children||[]).entries()){const td=element(index===0?'th':'td',cell.children);const align=node.align?.[column];if(['left','center','right'].includes(align))td.style.textAlign=align;tr.append(td);} (index===0?head:body).append(tr);});
          table.append(head,body);wrapper.append(table);return wrapper;
        }
        default:{if(node.children)return element('span',node.children);return document.createTextNode(node.value||'');}
      }
    }
    container.replaceChildren(render(tree));
  } catch {
    // Rendering a malformed announcement must never prevent an update.
    container.textContent=text;
  }
}
