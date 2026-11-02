// Mark the same raw-text boundaries next to the rendered Discord document.
// The RichRenderer's source maps account for hidden Markdown syntax and entities.
export class DiscordSplitPreview {
  constructor(preview,rich,context){
    this.preview=preview;this.rich=rich;this.context=context;this.frame=0;
    this.overlay=document.createElement('div');this.overlay.className='discord-boundary-overlay';
    this.overlay.setAttribute('aria-label','Discordの分割位置');preview.parentElement.append(this.overlay);
    preview.addEventListener('scroll',()=>this.schedule(),{passive:true});
    window.addEventListener('resize',()=>this.schedule(),{passive:true});
    if(window.ResizeObserver)new ResizeObserver(()=>this.schedule()).observe(preview);
    preview.addEventListener('dragover',event=>{const {enabled,panel}=this.context();if(!enabled||panel.dragged==null)return;event.preventDefault();event.dataTransfer.dropEffect='move';preview.classList.add('discord-boundary-drop');});
    preview.addEventListener('dragleave',()=>preview.classList.remove('discord-boundary-drop'));
    preview.addEventListener('drop',event=>{
      const {enabled,panel,doc,limit}=this.context();if(!enabled||panel.dragged==null)return;
      event.preventDefault();event.stopPropagation();preview.classList.remove('discord-boundary-drop');
      const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
      let node=range?.startContainer,offset=range?.startOffset;
      if(!node&&document.caretPositionFromPoint){const point=document.caretPositionFromPoint(event.clientX,event.clientY);node=point?.offsetNode;offset=point?.offset;}
      const index=panel.dragged;panel.endDrag();
      if(!node||!preview.contains(node)){panel.notify('文章の上に区切りを移動してください。',true);return;}
      const point=rich.point(node,offset);
      if(point==null){panel.notify('文章の上に区切りを移動してください。',true);return;}
      panel.move(index,point,doc,limit);
    });
  }
  clear(){this.overlay.replaceChildren();this.preview.classList.remove('discord-boundary-drop');}
  schedule(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});}
  position(rawPosition){
    let best=null,distance=Infinity;
    for(const leaf of this.rich.leaves){
      if(!leaf.node.isConnected||!leaf.map.length)continue;
      const map=leaf.map;let low=0,high=map.length-1;
      while(low<high){const mid=(low+high)>>1;if(map[mid]<rawPosition)low=mid+1;else high=mid;}
      for(const at of [low,Math.max(0,low-1)]){const delta=Math.abs(map[at]-rawPosition);if(delta<distance){distance=delta;best={node:leaf.node,offset:at};}}
      if(distance===0)break;
    }
    if(!best)return null;
    const range=document.createRange(),length=best.node.length;
    const offset=Math.min(best.offset,length);range.setStart(best.node,offset);range.setEnd(best.node,Math.min(offset+1,length));
    let rect=range.getBoundingClientRect();
    if(!rect.height&&offset>0){range.setStart(best.node,offset-1);range.setEnd(best.node,offset);rect=range.getBoundingClientRect();}
    return rect.height?rect:null;
  }
  render(){
    const {enabled,doc,limit,panel}=this.context();this.overlay.replaceChildren();
    if(!enabled||!doc||!panel.state||panel.state.id!==doc.id||this.preview.hidden)return;
    const box=this.overlay.getBoundingClientRect();if(!box.width||!box.height)return;
    panel.state.breaks.forEach((point,index)=>{
      const rect=this.position(point);if(!rect||rect.bottom<box.top||rect.top>box.bottom)return;
      const button=document.createElement('button');button.type='button';button.className='discord-preview-boundary';button.draggable=true;
      button.textContent=String(index+1);button.style.top=`${Math.max(0,Math.min(box.height-24,rect.top-box.top))}px`;
      button.title=`区切り ${index+1}：ドラッグして移動`;button.setAttribute('aria-label',`本文の区切り ${index+1} を移動`);
      button.addEventListener('dragstart',event=>panel.startDrag(index,event));
      button.addEventListener('dragend',()=>{panel.endDrag();this.preview.classList.remove('discord-boundary-drop');});
      this.overlay.append(button);
    });
  }
}
