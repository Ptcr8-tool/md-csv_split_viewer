import {currentUiLanguage} from './i18n.js';
const tr=(ja,en)=>currentUiLanguage()==='en'?en:ja;
import {lfToRaw,rawToLf} from './document.js';

// Text documents have no rendered pane: draw boundary controls next to their source.
export class DiscordSplitSource {
  constructor(source,context){
    this.source=source;this.context=context;this.frame=0;
    this.overlay=document.createElement('div');this.overlay.className='discord-boundary-overlay discord-source-overlay';
    this.overlay.setAttribute('aria-label',tr('テキストの分割位置','Text split positions'));source.parentElement.append(this.overlay);
    window.addEventListener('resize',()=>this.schedule(),{passive:true});
    if(window.ResizeObserver)new ResizeObserver(()=>this.schedule()).observe(source);
    // Capture before CodeMirror's own drop handler so moving a marker never edits text.
    source.addEventListener('dragover',event=>{const {enabled,panel}=this.context();if(!enabled||panel.dragged==null)return;event.preventDefault();event.dataTransfer.dropEffect='move';source.classList.add('discord-boundary-drop');},{capture:true});
    source.addEventListener('dragleave',()=>source.classList.remove('discord-boundary-drop'),{capture:true});
    source.addEventListener('drop',event=>{
      const {enabled,panel,doc,limit,editor}=this.context();if(!enabled||panel.dragged==null||!editor)return;
      event.preventDefault();event.stopImmediatePropagation();source.classList.remove('discord-boundary-drop');
      const index=panel.dragged,at=editor.posAtCoords({x:event.clientX,y:event.clientY});panel.endDrag();
      if(at==null){panel.notify(tr('文章の上に区切りを移動してください。','Move the boundary onto the text.'),true);return;}
      panel.move(index,lfToRaw(doc.raw,at),doc,limit);
    },{capture:true});
  }
  clear(){this.overlay.replaceChildren();this.source.classList.remove('discord-boundary-drop');}
  schedule(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});}
  render(){
    const {enabled,doc,limit,panel,editor}=this.context();this.overlay.replaceChildren();
    this.overlay.setAttribute('aria-label',tr('テキストの分割位置','Text split positions'));
    if(!enabled||!doc||!editor||!panel.state||panel.state.id!==doc.id)return;
    const box=this.overlay.getBoundingClientRect();if(!box.width||!box.height)return;
    panel.state.breaks.forEach((point,index)=>{
      const rect=editor.coordsAtPos(rawToLf(doc.raw,point));if(!rect||rect.bottom<box.top||rect.top>box.bottom)return;
      const button=document.createElement('button');button.type='button';button.className='discord-preview-boundary';button.draggable=true;
      button.textContent=String(index+1);button.style.top=`${Math.max(0,Math.min(box.height-24,rect.top-box.top))}px`;
      button.title=tr(`区切り ${index+1}：ドラッグして移動`,`Boundary ${index+1}: drag to move`);button.setAttribute('aria-label',tr(`テキストの区切り ${index+1} を移動`,`Move text boundary ${index+1}`));
      button.addEventListener('dragstart',event=>panel.startDrag(index,event));
      button.addEventListener('dragend',()=>{panel.endDrag();this.source.classList.remove('discord-boundary-drop');});
      this.overlay.append(button);
    });
  }
}
