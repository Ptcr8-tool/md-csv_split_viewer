import './tab-drag.css';

// Tab transfers use an opaque token only. Never put the document text, path,
// or other private content in the OS drag data.
export const TAB_DRAG_TYPE='application/x-md-split-tab';
export function installTabDrag({bar,canStart=()=>true,onMove,onStart=()=>{},onAccept=()=>{},onEnd=()=>{}}){
  const instance=crypto.randomUUID();let dragging=null;
  const tabFor=e=>e.target instanceof Element?e.target.closest('.tab[data-tab-id]'):null;
  const targetFor=e=>e.target instanceof Element?e.target.closest('.tabbar,.tabbar-row,[data-fold-toggle="tabs"]'):null;
  const clear=()=>document.querySelectorAll('.tab-drop-before,.tab-drop-after,.tab-dragging,.tab-drop-zone').forEach(n=>n.classList.remove('tab-drop-before','tab-drop-after','tab-dragging','tab-drop-zone'));
  const contains=e=>Array.from(e.dataTransfer?.types||[]).includes(TAB_DRAG_TYPE);
  bar.addEventListener('dragstart',e=>{
    const tab=tabFor(e);if(!tab||!bar.contains(tab)||e.target.closest('.tab-close')||!canStart(tab.dataset.tabId)){e.preventDefault();return;}
    const token=crypto.randomUUID();dragging={id:tab.dataset.tabId,token,instance};
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData(TAB_DRAG_TYPE,JSON.stringify({token,instance,id:dragging.id}));tab.classList.add('tab-dragging');
    try{onStart(dragging);}catch{dragging=null;clear();e.preventDefault();}
  });
  document.addEventListener('dragover',e=>{
    if(!contains(e)||!targetFor(e))return;
    e.preventDefault();e.dataTransfer.dropEffect='move';clear();
    const tab=tabFor(e);if(tab&&bar.contains(tab)){const r=tab.getBoundingClientRect();tab.classList.add(e.clientX<r.left+r.width/2?'tab-drop-before':'tab-drop-after');}else targetFor(e).classList.add('tab-drop-zone');
  },true);
  document.addEventListener('drop',e=>{
    if(!contains(e)||!targetFor(e))return;
    e.preventDefault();e.stopPropagation();clear();let payload;
    try{payload=JSON.parse(e.dataTransfer.getData(TAB_DRAG_TYPE));}catch{return;}
    if(!payload||typeof payload.token!=='string'||typeof payload.instance!=='string'||typeof payload.id!=='string')return;
    const target=tabFor(e);const rect=target?.getBoundingClientRect();const after=!!(rect&&e.clientX>=rect.left+rect.width/2);
    if(payload.instance===instance){if(dragging?.token===payload.token)onMove(payload.id,target?.dataset.tabId??null,after);}
    else onAccept(payload);
  },true);
  bar.addEventListener('dragend',e=>{const item=dragging;dragging=null;clear();if(item)onEnd(item,e);});
}
