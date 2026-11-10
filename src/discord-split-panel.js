import {currentUiLanguage} from './i18n.js';
const tr=(ja,en)=>currentUiLanguage()==='en'?en:ja;
import { difference } from './document.js';
import { discordBoundaries, normalizeDiscordBreaks, splitDiscord, splitDiscordAt } from './discord.js';

const element=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};

// The selected position is calculated in the original text, not in the
// automatically added Markdown used for a self-contained copied message.
function pointInBody(event, body, from) {
  const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
  let node=range?.startContainer, offset=range?.startOffset;
  if(!node && document.caretPositionFromPoint){const p=document.caretPositionFromPoint(event.clientX,event.clientY);node=p?.offsetNode;offset=p?.offset;}
  if(!node || !body.contains(node))return null;
  const measure=document.createRange();measure.selectNodeContents(body);
  try { measure.setEnd(node,offset); } catch { return null; }
  return from+measure.toString().length;
}

export class DiscordSplitPanel {
  constructor(list,{copy,notify,onRender=()=>{}}){this.list=list;this.copy=copy;this.notify=notify;this.onRender=onRender;this.state=null;this.states=new Map();this.dragged=null;}
  reset(){this.state=null;this.states.clear();this.dragged=null;this.list.replaceChildren();}
  prepare(doc,limit){
    this.state=this.states.get(doc.id);
    if(!this.state){
      this.state={id:doc.id,raw:doc.raw,limit,breaks:splitDiscord(doc.raw,limit).slice(0,-1).map(p=>p.to),manual:false,picked:null};
      this.states.set(doc.id,this.state);return;
    }
    const s=this.state;
    if(s.raw!==doc.raw){
      if(s.manual){
        const change=difference(s.raw,doc.raw),delta=change.insert.length-(change.to-change.from);
        s.breaks=normalizeDiscordBreaks(doc.raw,s.breaks.map(p=>p<=change.from?p:p>=change.to?p+delta:change.from+change.insert.length));
      }else s.breaks=splitDiscord(doc.raw,limit).slice(0,-1).map(p=>p.to);
      s.raw=doc.raw;s.picked=null;
    }
    if(s.limit!==limit){
      s.limit=limit;
      if(!s.manual)s.breaks=splitDiscord(doc.raw,limit).slice(0,-1).map(p=>p.to);
      s.picked=null;
    }
  }
  render(doc,limit){
    const scroll=this.list.closest('.chunks-panel')?.scrollTop;
    this.list.replaceChildren();
    try{
      this.prepare(doc,limit);
      const s=this.state,parts=splitDiscordAt(s.raw,s.breaks,limit);
      const toolbar=element('div','chunks-actions');
      const reset=element('button','secondary chunks-reset',tr('自動分割に戻す','Reset to automatic splits'));reset.type='button';
      reset.title=tr('手動の区切りを破棄して、自動で分割し直します','Discard manual boundaries and split automatically');
      reset.disabled=!s.manual;
      reset.onclick=()=>{s.breaks=splitDiscord(s.raw,s.limit).slice(0,-1).map(p=>p.to);s.manual=false;s.picked=null;this.render(doc,limit);};
      toolbar.append(reset);this.list.append(toolbar);
      const instructions=element('p','chunk-instructions',tr('文章をクリックして「ここで分割」。区切りマークはドラッグして移動できます。','Click the text and choose Split here. Drag markers to move boundaries.'));
      this.list.append(instructions);
      parts.forEach((part,i)=>{
        const card=element('section','chunk'+(part.over?' chunk-over':''));
        const head=element('div','chunk-head');
        const label=element('strong','',`${i+1} / ${parts.length}`);
        const count=element('small','',tr(`${part.count.toLocaleString()} / ${limit.toLocaleString()}字${part.over?' · 上限超過':''}`,`${part.count.toLocaleString()} / ${limit.toLocaleString()} characters${part.over?' · over limit':''}`));
        const copy=element('button','secondary',tr('コピー','Copy'));copy.type='button';
        copy.onclick=async()=>{try{await this.copy(part.text);copy.textContent=tr('✓ コピー済み','✓ Copied');card.classList.add('copied');}catch(e){this.notify(e.message||String(e),true);}};
        head.append(label,count,copy);
        const pre=element('pre','chunk-text');pre.title=tr('区切りたい位置をクリック','Click where you want to split');
        const prefix=element('span','chunk-extra',part.prefix),body=element('span','chunk-body'),suffix=element('span','chunk-extra',part.suffix);
        const chosen=s.picked!=null&&s.picked>part.from&&s.picked<part.to?s.picked-part.from:null;
        if(chosen!=null){body.append(document.createTextNode(part.body.slice(0,chosen)));const cursor=element('span','chunk-insertion-point');cursor.setAttribute('aria-hidden','true');body.append(cursor,document.createTextNode(part.body.slice(chosen)));}
        else body.textContent=part.body;
        pre.append(prefix,body,suffix);
        const actions=element('div','chunk-select-actions');
        const selection=element('span','chunk-selected',chosen==null?tr('文章をクリックして位置を指定','Click the text to select a position'):tr(`区切り位置: ${chosen.toLocaleString()}字目`,`Split position: character ${chosen.toLocaleString()}`));
        const add=element('button','secondary chunk-add',tr('ここで分割','Split here'));add.type='button';add.disabled=chosen==null;
        add.onclick=()=>{if(s.picked==null)return;const next=normalizeDiscordBreaks(s.raw,[...s.breaks,s.picked]);if(next.length===s.breaks.length){this.notify(tr('別の区切り位置を選んでください。','Choose another split position.'),true);return;}s.breaks=next;s.manual=true;s.picked=null;this.render(doc,limit);};
        actions.append(selection,add);
        pre.addEventListener('click',event=>{
          const point=pointInBody(event,body,part.from);if(point==null)return;
          const [safe]=normalizeDiscordBreaks(s.raw,[point]);
          if(safe==null||safe<=part.from||safe>=part.to){s.picked=null;this.notify(tr('文章の途中をクリックしてください。','Click inside the text.'));}
          else s.picked=safe;
          this.render(doc,limit);
        });
        pre.addEventListener('dragover',event=>{if(this.dragged==null)return;event.preventDefault();event.dataTransfer.dropEffect='move';pre.classList.add('chunk-drop-target');});
        pre.addEventListener('dragleave',()=>pre.classList.remove('chunk-drop-target'));
        pre.addEventListener('drop',event=>{if(this.dragged==null)return;event.preventDefault();pre.classList.remove('chunk-drop-target');const point=pointInBody(event,body,part.from);const index=this.dragged;this.dragged=null;if(point==null){this.notify(tr('文章の上に区切りを移動してください。','Move the boundary onto the text.'),true);return;}this.move(index,point,doc,limit);});
        card.append(head,pre,actions);this.list.append(card);
        if(i<parts.length-1)this.list.append(this.marker(i,doc,limit));
      });
    }catch(error){const p=element('p','error-text',error.message||String(error));this.list.append(p);}
    if(scroll!=null)this.list.closest('.chunks-panel').scrollTop=scroll;
    this.onRender();
  }
  startDrag(index,event){this.dragged=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','discord-split-boundary');}
  endDrag(){this.dragged=null;this.list.querySelectorAll('.chunk-drop-target').forEach(n=>n.classList.remove('chunk-drop-target'));}
  move(index,point,doc,limit){
    const s=this.state;if(!s||index<0||index>=s.breaks.length)return;
    const [safe]=normalizeDiscordBreaks(s.raw,[point]);
    if(safe==null||s.breaks.some((p,i)=>i!==index&&p===safe)){this.notify(tr('別の区切り位置を選んでください。','Choose another split position.'),true);return;}
    s.breaks[index]=safe;s.breaks.sort((a,b)=>a-b);s.manual=true;s.picked=null;this.render(doc,limit);
  }
  marker(index,doc,limit){
    const s=this.state,marker=element('div','chunk-boundary');
    const handle=element('button','chunk-drag',tr(`↕ 区切り ${index+1}`,`↕ Boundary ${index+1}`));handle.type='button';handle.draggable=true;
    handle.title=tr('ドラッグして文章上の位置へ移動（上下キーで行単位に移動）','Drag to move within the text (use Up/Down to move by line)');
    handle.setAttribute('aria-label',tr(`区切り ${index+1} を移動`,`Move boundary ${index+1}`));
    handle.addEventListener('dragstart',event=>{this.startDrag(index,event);marker.classList.add('dragging');});
    handle.addEventListener('dragend',()=>{this.endDrag();marker.classList.remove('dragging');});
    handle.addEventListener('keydown',event=>{
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove.click();return;}
      if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
      event.preventDefault();const at=s.breaks[index],points=discordBoundaries(s.raw).filter(p=>p>0&&p<s.raw.length);
      const linePoints=points.filter(p=>s.raw[p-1]==='\n');
      const target=event.key==='ArrowUp'?linePoints.filter(p=>p<at).at(-1)??points.filter(p=>p<at).at(-1):linePoints.find(p=>p>at)??points.find(p=>p>at);
      if(target!=null){this.move(index,target,doc,limit);this.list.querySelectorAll('.chunk-drag')[Math.min(index,s.breaks.length-1)]?.focus();}
    });
    const remove=element('button','chunk-remove','×');remove.type='button';remove.title=tr('この区切りを削除','Remove this boundary');remove.setAttribute('aria-label',tr(`区切り ${index+1} を削除`,`Remove boundary ${index+1}`));
    remove.onclick=()=>{s.breaks.splice(index,1);s.manual=true;s.picked=null;this.render(doc,limit);};
    marker.append(handle,remove);return marker;
  }
}
