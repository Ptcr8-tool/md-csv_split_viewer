// Native opens can arrive while a drag is active. Do not rebuild the source
// tab strip until the handoff finishes; keep these events in arrival order.
const deferred=new Set(['files-opened','new-document','activate-document','settings-changed','new-in-directory','file-changed','large-file-changed','encoding-open-existing','pane-window-closed','pane-window-error']);
export function createTabHostQueue({locked,receiving,dispatch,onError=()=>{}}){
  const events=[];let draining=false;
  async function handle(event){
    if((locked()||draining||events.length)&&deferred.has(event.type)){
      // The receiving window must register the transferred document before it
      // can persist and acknowledge it. Other opens remain queued.
      if(locked()&&event.type==='files-opened'&&receiving()&&Array.isArray(event.documents)){
        const id=receiving().id,own=event.documents.filter(d=>d.id===id),rest=event.documents.filter(d=>d.id!==id);
        if(rest.length)events.push({...event,documents:rest});
        if(own.length)return dispatch({...event,documents:own});
        return;
      }
      // The native watcher rechecks the moved document after commit/abort.
      if(event.type==='file-changed'&&event.document?.id===locked()?.id)return;
      events.push(event);if(!locked())void flush();return;
    }
    return dispatch(event);
  }
  async function flush(){
    if(draining)return;draining=true;
    try{while(events.length&&!locked()){const event=events.shift();try{await dispatch(event);}catch(error){onError(error);}}}
    finally{draining=false;}
  }
  const hasPendingOpen=()=>events.some(e=>['files-opened','new-document','new-in-directory'].includes(e.type));
  return {handle,flush,hasPendingOpen};
}
