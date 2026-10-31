import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { textMap, difference, normalized, lfToRaw, preferredEol } from './document.js';
import {fenceInfo,listLine,lineAt} from './editing.js';
import {codeHighlights,codePresets} from './code-languages.js';
import {whitespaceMark,lineBreakAppearance} from './whitespace.js';
import {safeMarkdownUrl} from './url-policy.js';
import DOMPurify from 'dompurify';

export function parseMarkdown(source,editable=false) {
  const parse=text=>fromMarkdown(text,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]});
  let tree=parse(source);
  if(editable){
    const blocked=[];const visit=node=>{if(node.type==='code'||node.type==='html')blocked.push([node.position.start.offset,node.position.end.offset]);for(const child of node.children||[])visit(child);};visit(tree);
    const points=[];let at=0;
    while(at<source.length){const line=lineAt(source,at),item=listLine(source,at);if(item&&!item.content.trim()&&/[ \t]$/.test(line.text)&&!blocked.some(([a,b])=>at>=a&&at<b))points.push(line.end);if(!line.eol)break;at=line.end+line.eol.length;}
    if(points.length){
      let sentinel='\uFDD0';while(source.includes(sentinel))sentinel+='\uFDD0';
      let text='',last=0;for(const point of points){text+=source.slice(last,point)+sentinel;last=point;}text+=source.slice(last);tree=parse(text);
      const original=offset=>{let delta=0;for(const point of points){const start=point+delta;if(offset<=start)return offset-delta;if(offset<start+sentinel.length)return point;delta+=sentinel.length;}return offset-delta;};
      const restore=node=>{if(node.position){node.position.start.offset=original(node.position.start.offset);node.position.end.offset=original(node.position.end.offset);}if(typeof node.value==='string')node.value=node.value.replaceAll(sentinel,'');for(const child of node.children||[])restore(child);};restore(tree);
    }
  }
  return tree;
}

const el = (tag, cls) => { const n=document.createElement(tag); if(cls)n.className=cls; return n; };
const graphemeSegmenter=new Intl.Segmenter('ja',{granularity:'grapheme'});

export class RichRenderer {
  constructor(container, callbacks) { this.container=container; this.callbacks=callbacks; this.epoch=0; this.openDetails=new Set(); }
  render(source, mode, docId, options={}) {
    this.source=source; this.mode=mode; this.docId=docId; this.epoch++;
    this.options=options;this.maps=new WeakMap(); this.leaves=[]; this.formats=[]; this.images=[];this.codeBlocks=[];this.headings=[];
    const fragment=document.createDocumentFragment();
    this.blocks(source,0,fragment);
    const hint=options.selection?.from,at=hint??source.length;
    const trailing=/\r?\n[ \t]*$/.test(source)&&at===source.length;
    const code=this.codeBlocks.find(c=>at>=c.contentFrom&&at<=c.contentTo);
    if(source.length&&!code&&(trailing||hint!=null&&!lineAt(source,at).text.trim())&&!this.leaves.some(l=>l.from===at||l.to===at)){
      const p=el('p','empty-paragraph');p.dataset.block='';p.dataset.from=at;p.dataset.to=at;p.append(this.leaf('',at,at));const next=Array.from(fragment.childNodes).find(n=>Number(n.dataset?.from)>at);fragment.insertBefore(p,next||null);
    }
    if(!fragment.childNodes.length){ const p=el('p');p.dataset.block='';p.dataset.from='0';p.dataset.to='0';p.append(this.leaf('',0,0));fragment.append(p); }
    this.container.replaceChildren(fragment);
    this.container.classList.toggle('is-empty',!source.length);
    this.container.classList.toggle('discord-view',mode==='discord');
    this.container.classList.toggle('preserve-lines',mode==='discord'||options.softBreaks!==false);
    return this.epoch;
  }
  leaf(value,from,to,kind='text',rawValue,highlights=[]) {
    value=normalized(value);
    const span=el('span','md-leaf');span.dataset.from=from;span.dataset.to=to;span.dataset.kind=kind;
    const raw=rawValue ?? this.source.slice(from,to);
    const map=textMap(raw,value,from,decodeNamedCharacterReference);
    const cuts=new Set([0,value.length]);for(const h of highlights){cuts.add(h.from);cuts.add(h.to);}
    for(let i=0;i<value.length;i++)if(whitespaceMark(value[i],this.options)){cuts.add(i);cuts.add(i+1);}
    const points=Array.from(cuts).sort((a,b)=>a-b);
    const append=(a,b)=>{const text=document.createTextNode(value.slice(a,b)||'\u200b'),slice=value?map.slice(a,b+1):[from,from];let parent=span;
      const classes=highlights.filter(h=>h.from<=a&&h.to>=b).map(h=>h.classes).join(' '),mark=b===a+1?whitespaceMark(value[a],this.options):null;
      if(classes||mark){parent=el('span',classes+(mark?' visible-whitespace ws-'+mark[0]:''));if(mark){if(mark[0]==='line-break'){const appearance=lineBreakAppearance(this.source.slice(map[a],map[b]),this.options.distinguishLineBreaks!==false);parent.dataset.mark=appearance.glyph;parent.title=appearance.label;}else parent.dataset.mark=mark[1];}span.append(parent);}
      parent.append(text);this.maps.set(text,slice);this.leaves.push({node:text,map:slice,from:slice[0],to:slice.at(-1),kind});
    };
    if(!value)append(0,0);else for(let i=0;i<points.length-1;i++)append(points[i],points[i+1]);return span;
  }
  markBlock(n,node,base){ n.dataset.block='';n.dataset.from=node.position.start.offset+base;n.dataset.to=node.position.end.offset+base;return n; }
  blocks(source,base,parent) {
    const nodes=parseMarkdown(source,true).children;
    for(let i=0;i<nodes.length;i++) {
      const node=nodes[i], from=node.position.start.offset+base, to=node.position.end.offset+base;
      if(node.type==='html' && /^<details\b/i.test(this.source.slice(from))) {
        const tokens=/<\/?details\b[^>]*>/gi;tokens.lastIndex=from;let depth=0,end=-1,closeStart=0,m;
        while((m=tokens.exec(this.source))){ if(/^<\//.test(m[0]))depth--;else depth++; if(depth===0){end=tokens.lastIndex;closeStart=m.index;break;} }
        if(end>from){
          const raw=this.source.slice(from,end);
          if(this.mode==='discord'){const pre=this.markBlock(el('pre','raw-block'),{position:{start:{offset:from},end:{offset:end}}},0);pre.append(this.leaf(raw,from,end,'raw'));parent.append(pre);}
          else {
            const d=el('details','md-details');d.dataset.block='';d.dataset.from=from;d.dataset.to=end;
            const headerEnd=this.source.indexOf('>',from)+1;
            const summary=/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(this.source.slice(headerEnd,closeStart));
            const sm=el('summary');let bodyStart=headerEnd;
            if(summary){const sf=headerEnd+summary.index+summary[0].indexOf('>')+1;sm.append(this.leaf(summary[1],sf,sf+summary[1].length));bodyStart=headerEnd+summary.index+summary[0].length;}
            else {sm.textContent='詳細';sm.contentEditable='false';}
            d.append(sm);const body=el('div','details-body');this.blocks(this.source.slice(bodyStart,closeStart),bodyStart,body);d.append(body);
            const key=this.docId+':'+from;
            d.open=this.openDetails.has(key)||/^<details\b[^>]*\bopen\b/i.test(raw);
            d.addEventListener('toggle',()=>{if(d.open)this.openDetails.add(key);else this.openDetails.delete(key);});parent.append(d);
          }
          while(i+1<nodes.length && nodes[i+1].position.start.offset+base<end)i++;
          const overshoot=nodes[i].position.end.offset+base;
          if(overshoot>end)this.blocks(this.source.slice(end,overshoot),end,parent);
          continue;
        }
      }
      parent.append(this.block(node,base));
    }
  }
  block(node,base=0) {
    const from=node.position?.start.offset+base,to=node.position?.end.offset+base;
    let n;
    switch(node.type) {
      case 'paragraph': {
        n=el('p');
        if(this.mode==='discord'&&this.source.slice(from,to).startsWith('-# ')){
          n.className='subtext';const shifted=parseMarkdown(this.source.slice(from+3,to)).children[0];
          this.inlineChildren(shifted?.children||[],from+3,n);
        } else this.inlineChildren(node.children,base,n);break;
      }
      case 'heading': {
        const label=n=>n.value??(n.children||[]).map(label).join('');
        this.headings.push({from,to,level:node.depth,text:label(node)});
        if(this.mode==='discord'&&node.depth>3){n=el('p');n.append(this.leaf(this.source.slice(from,to),from,to,'raw'));}
        else{n=el('h'+node.depth);this.inlineChildren(node.children,base,n);}
        {const button=el('button','heading-fold');button.type='button';button.contentEditable='false';button.setAttribute('aria-label','見出しを折りたたむ');button.textContent='▾';button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',e=>{e.preventDefault();this.callbacks.toggleHeading?.(from);});n.prepend(button);}break;
      }
      case 'blockquote': n=el('blockquote');for(const c of node.children)n.append(this.block(c,base));break;
      case 'list': n=el(node.ordered?'ol':'ul');if(node.start!=null)n.start=node.start;for(const c of node.children)n.append(this.block(c,base));break;
      case 'listItem': {
        n=el('li');
        const prefix=listLine(this.source,from),checked=node.checked??(prefix?.task!=null?/x/i.test(prefix.task):null);
        if(checked!=null&&this.mode!=='discord'){
          n.className='task-item';const check=el('input');check.type='checkbox';check.checked=checked;check.contentEditable='false';check.setAttribute('aria-label','チェック項目');
          check.addEventListener('change',()=>{const raw=this.source.slice(from,to);const at=raw.search(/\[[ xX]\]/);if(at>=0)this.callbacks.patch(from+at+1,from+at+2,check.checked?'x':' ');});n.append(check);
        }else if(checked!=null){n.append(this.leaf(checked?'[x] ':'[ ] ',from+this.source.slice(from,to).indexOf('['),from+this.source.slice(from,to).indexOf(']')+1,'raw'));}
        if(prefix&&!prefix.content.trim()){
          const p=el('p','empty-list-item');p.dataset.block='';p.dataset.from=prefix.contentFrom;p.dataset.to=prefix.contentFrom;p.append(this.leaf('',prefix.contentFrom,prefix.contentFrom));n.append(p);
          for(const c of node.children)if(c.position.end.offset+base>prefix.end)n.append(this.block(c,base));
        }else for(const c of node.children)n.append(this.block(c,base));break;
      }
      case 'thematicBreak':
        if(this.mode==='discord'){n=el('p');n.append(this.leaf(this.source.slice(from,to),from,to,'raw'));}
        else {n=el('div','rule-block');const hr=el('hr');hr.contentEditable='false';n.append(hr);n.dataset.atom='true';}break;
      case 'code': {
        const info=fenceInfo(this.source,from,to),start=info.contentFrom,end=info.contentTo;this.codeBlocks.push(info);
        if(info.fenced)this.formats.push({...info,kind:'code-block',open:this.source.slice(from,start),close:this.source.slice(end,to)});
        if(node.lang==='mermaid'&&this.mode!=='discord')n=this.mermaid(node,from,to,start,end);
        else{
          n=el('div','code-block');n.dataset.language=info.language||node.lang||'';
          if(info.fenced){const tools=el('div','code-tools');tools.contentEditable='false';const label=el('label');label.textContent='言語 ';const select=el('select');select.setAttribute('aria-label','コードブロックの言語');
            for(const preset of codePresets){const option=el('option');option.value=preset.id;option.textContent=preset.label;select.append(option);}
            if(!codePresets.some(p=>p.id===info.language)){const option=el('option');option.value=info.language;option.textContent=info.language;select.append(option);}select.value=info.language;
            select.addEventListener('change',()=>this.callbacks.codeLanguage(info,select.value));label.append(select);tools.append(label);n.append(tools);
          }
          const pre=el('pre','code-content'),code=el('code'),value=info.fenced?normalized(this.source.slice(start,end)):node.value,epoch=this.epoch;
          const highlights=codeHighlights(value,info.language||node.lang,()=>{if(epoch===this.epoch)this.callbacks.refresh();});
          code.append(this.leaf(value,start,end,'block-code',this.source.slice(start,end),highlights));pre.append(code);n.append(pre);
        }break;
      }
      case 'table':
        if(this.mode==='discord'){n=el('pre','raw-block');n.append(this.leaf(this.source.slice(from,to),from,to,'raw'));}
        else {
          n=el('div','table-wrap');const table=el('table');node.children.forEach((row,ri)=>{const tr=el('tr');row.children.forEach((cell,ci)=>{const td=el(ri===0?'th':'td');td.dataset.cell='';td.dataset.row=ri;td.dataset.col=ci;td.dataset.from=cell.position.start.offset+base;td.dataset.to=cell.position.end.offset+base;td.style.textAlign=node.align[ci]||'left';this.inlineChildren(cell.children,base,td);if(!td.childNodes.length)td.append(this.leaf('',cell.position.start.offset+base,cell.position.end.offset+base));tr.append(td);});table.append(tr);});n.append(table);
        }break;
      case 'html': n=el('pre','raw-block');n.append(this.leaf(this.source.slice(from,to),from,to,'raw'));break;
      case 'definition': n=el('pre','raw-block');n.append(this.leaf(this.source.slice(from,to),from,to,'raw'));break;
      default:n=el('p');if(node.children)this.inlineChildren(node.children,base,n);else n.append(this.leaf(node.value||this.source.slice(from,to),from,to));
    }
    if(node.position)this.markBlock(n,node,base);return n;
  }
  inlineChildren(children,base,parent){for(const c of children||[])parent.append(this.inline(c,base));}
  codeAt(from,to=from){return this.codeBlocks.find(c=>from>=c.contentFrom&&to<=c.contentTo);}
  inline(node,base) {
    const from=node.position.start.offset+base,to=node.position.end.offset+base,raw=this.source.slice(from,to);
    let n;
    switch(node.type){
      case 'text': {
        if(this.mode==='discord'&&raw.includes('||')){
          const fragment=document.createDocumentFragment();let cursor=from;
          for(const m of raw.matchAll(/\|\|([\s\S]+?)\|\|/g)){
            if(from+m.index>cursor)fragment.append(this.leaf(this.source.slice(cursor,from+m.index),cursor,from+m.index));
            const sp=el('span','spoiler');sp.append(this.leaf(m[1],from+m.index+2,from+m.index+m[0].length-2));
            sp.addEventListener('click',()=>sp.classList.add('revealed'));fragment.append(sp);
            this.formats.push({from:from+m.index,to:from+m.index+m[0].length,contentFrom:from+m.index+2,contentTo:from+m.index+m[0].length-2,open:'||',close:'||'});cursor=from+m.index+m[0].length;
          }
          if(cursor<to)fragment.append(this.leaf(this.source.slice(cursor,to),cursor,to));return fragment;
        }
        return this.leaf(node.value,from,to);
      }
      case 'strong':case 'emphasis':case 'delete': {
        n=el(node.type==='strong'?(this.mode==='discord'&&raw.startsWith('__')?'u':'strong'):node.type==='emphasis'?'em':'s');
        this.inlineChildren(node.children,base,n);
        const a=node.children[0]?.position.start.offset+base,b=node.children.at(-1)?.position.end.offset+base;
        this.formats.push({from,to,contentFrom:a,contentTo:b,open:this.source.slice(from,a),close:this.source.slice(b,to)});return n;
      }
      case 'inlineCode':{
        n=el('code');let ticks=raw.match(/^`+/)?.[0].length||1;let a=from+ticks,b=to-ticks;
        if(this.source[a]===' '&&this.source[b-1]===' '&&node.value.trim()) {a++;b--;}
        n.append(this.leaf(node.value,a,b,'code'));this.formats.push({from,to,contentFrom:a,contentTo:b,open:this.source.slice(from,a),close:this.source.slice(b,to)});return n;
      }
      case 'break': n=el('br');n.dataset.from=from;n.dataset.to=to;return n;
      case 'link': {
        n=el('a');if(safeMarkdownUrl(node.url))n.href=node.url;n.title=node.title||node.url;
        n.addEventListener('click',e=>{e.preventDefault();if(e.ctrlKey)this.callbacks.openLink(node.url);});this.inlineChildren(node.children,base,n);
        n.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();this.callbacks.openLink(node.url);});
        const a=node.children[0]?.position.start.offset+base,b=node.children.at(-1)?.position.end.offset+base;
        this.formats.push({from,to,contentFrom:a,contentTo:b,open:this.source.slice(from,a),close:this.source.slice(b,to)});return n;
      }
      case 'image': {
        this.images.push({from,to,url:node.url});
        if(this.mode==='discord')return this.leaf(raw,from,to,'raw');
        n=el('span','image-atom');n.contentEditable='false';n.dataset.atom='true';n.dataset.from=from;n.dataset.to=to;
        const img=el('img');img.alt=node.alt||'';img.title=node.title||node.alt||'';img.loading='lazy';
        if(safeMarkdownUrl(node.url,{image:true}))img.src=this.callbacks.imageUrl(node.url,this.docId);
        img.addEventListener('dblclick',()=>this.callbacks.editImage(from,to,node));
        img.addEventListener('error',()=>{n.classList.add('image-error');n.title='画像を読み込めません: '+node.url;});n.append(img);return n;
      }
      case 'html':return this.leaf(raw,from,to,'raw');
      default:if(node.children){n=el('span');this.inlineChildren(node.children,base,n);return n;}return this.leaf(node.value||raw,from,to);
    }
  }
  mermaid(node,from,to,start,end) {
    const n=el('figure','mermaid-block');n.contentEditable='false';n.dataset.atom='true';n.dataset.from=from;n.dataset.to=to;
    const tools=el('div','component-tools');const label=el('span');label.textContent='MERMAID';tools.append(label);
    const stage=el('div','mermaid-stage');stage.textContent='図を描画しています…';
    const edit=el('textarea','diagram-code');edit.hidden=true;edit.setAttribute('aria-label','Mermaidコード');edit.value=this.source.slice(start,end);
    const button=(name,action)=>{const b=el('button');b.type='button';b.textContent=name;b.addEventListener('click',action);tools.append(b);return b;};
    button('コード編集',()=>{edit.hidden=!edit.hidden;if(!edit.hidden)edit.focus();});
    button('コードをコピー',()=>this.callbacks.copyText(this.source.slice(Number(n.dataset.from),Number(n.dataset.to))));
    button('PNGコピー',()=>this.callbacks.copyDiagram(stage,'png'));
    button('PNG保存',()=>this.callbacks.copyDiagram(stage,'png-file'));
    button('SVG保存',()=>this.callbacks.copyDiagram(stage,'svg'));
    const error=el('div','diagram-error');error.hidden=true;
    edit.addEventListener('input',()=>{
      const oldEnd=Number(edit.dataset.end||end),body=this.source.slice(start,oldEnd);
      const delta=difference(normalized(body),edit.value),from=start+lfToRaw(body,delta.from),to=start+lfToRaw(body,delta.to),insert=delta.insert.replace(/\n/g,preferredEol(body));
      this.callbacks.patch(from,to,insert,{keepDiagramEditor:true});edit.dataset.end=oldEnd+insert.length-(to-from);this.drawDiagram(stage,edit.value,error);
    });
    edit.addEventListener('keydown',e=>{if(e.key==='Tab'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();edit.setRangeText('\t',edit.selectionStart,edit.selectionEnd,'end');edit.dispatchEvent(new Event('input',{bubbles:true}));}});
    edit.addEventListener('blur',()=>this.callbacks.refresh());
    n.append(tools,stage,error,edit);this.drawDiagram(stage,node.value,error);return n;
  }
  async drawDiagram(stage,code,error) {
    const ticket=(stage._ticket||0)+1;stage._ticket=ticket;
    try {
      const {default:mermaid}=await import('mermaid');
      if(!this.mermaidInitialized){mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',suppressErrorRendering:true,htmlLabels:false,secure:['secure','securityLevel','htmlLabels','startOnLoad','suppressErrorRendering','maxTextSize','maxEdges'],flowchart:{htmlLabels:false}});this.mermaidInitialized=true;}
      const id='diagram-'+crypto.randomUUID().replaceAll('-','');
      const result=await mermaid.render(id,code);
      if(stage._ticket!==ticket)return;
      stage.innerHTML=DOMPurify.sanitize(result.svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['script','foreignObject']});error.hidden=true;
    }catch(e){if(stage._ticket!==ticket)return;error.textContent='図を更新できません。コードを確認してください。';error.title=String(e.message||e);error.hidden=false;if(!stage.querySelector('svg'))stage.textContent='Mermaidコードから図を描画できませんでした。';}
  }
  rebase(from,to,insert) {
    const delta=insert.length-(to-from);
    const shift=p=>p>=to?p+delta:p>from?from+insert.length:p;
    this.source=this.source.slice(0,from)+insert+this.source.slice(to);
    for(const l of this.leaves){l.from=shift(l.from);l.to=shift(l.to);for(let i=0;i<l.map.length;i++)l.map[i]=shift(l.map[i]);}
    for(const n of this.container.querySelectorAll('[data-from]')){n.dataset.from=shift(Number(n.dataset.from));if(n.dataset.to!=null)n.dataset.to=shift(Number(n.dataset.to));}
    for(const f of this.formats)for(const key of ['from','to','contentFrom','contentTo'])f[key]=shift(f[key]);
    for(const image of this.images){image.from=shift(image.from);image.to=shift(image.to);}
  }
  point(node,offset) {
    if(!node)return null;
    if(this.maps.has(node)){const map=this.maps.get(node);return map[Math.min(Math.max(0,offset),map.length-1)];}
    if(node.nodeType===Node.TEXT_NODE)return this.point(node.parentNode,0);
    if(node.dataset?.atom)return Number(offset>0?node.dataset.to:node.dataset.from);
    const children=node.childNodes;
    if(offset<children.length){const leaf=this.first(children[offset]);if(leaf)return leaf.map[0];const c=children[offset];if(c.dataset?.from)return Number(c.dataset.from);}
    if(offset>0){const leaf=this.last(children[Math.min(offset,children.length)-1]);if(leaf)return leaf.map.at(-1);const c=children[Math.min(offset,children.length)-1];if(c?.dataset?.to)return Number(c.dataset.to);}
    if(node.dataset?.from!=null)return Number(node.dataset.from);
    return node===this.container?0:this.point(node.parentNode,Array.prototype.indexOf.call(node.parentNode.childNodes,node));
  }
  first(n){if(!n)return null;return this.leaves.find(l=>l.node===n||n.contains(l.node));}
  last(n){if(!n)return null;return this.leaves.findLast(l=>l.node===n||n.contains(l.node));}
  selection() {
    const s=window.getSelection();if(!s.rangeCount||!this.container.contains(s.anchorNode)||!this.container.contains(s.focusNode))return null;
    const a=this.point(s.anchorNode,s.anchorOffset),b=this.point(s.focusNode,s.focusOffset);if(a==null||b==null)return null;
    return {from:Math.min(a,b),to:Math.max(a,b)};
  }
  restoreIn(element){
    const leaf=this.first(element);if(!leaf)return;this.container.focus({preventScroll:true});const range=document.createRange();range.setStart(leaf.node,0);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  restoreSelection(from,to=from,focus=true) {
    const locate=(position)=>{
      let best=null,score=Infinity;
      for(const l of this.leaves)for(let i=0;i<l.map.length;i++){const d=Math.abs(l.map[i]-position);if(d<score){best={node:l.node,offset:i};score=d;}if(d===0)break;}
      return best;
    };
    const a=locate(from),b=locate(to);if(!a||!b)return;
    if(focus)this.container.focus({preventScroll:true});
    const r=document.createRange();r.setStart(a.node,Math.min(a.offset,a.node.length));r.setEnd(b.node,Math.min(b.offset,b.node.length));const s=getSelection();s.removeAllRanges();s.addRange(r);
  }
  neighbor(position,direction) {
    const entries=[];
    for(const l of this.leaves){entries.push(l.map[0]);for(const s of graphemeSegmenter.segment(l.node.data))entries.push(l.map[Math.min(l.map.length-1,s.index+s.segment.length)]);}
    return direction<0?entries.filter(p=>p<position).at(-1)??position:entries.find(p=>p>position)??position;
  }
}
