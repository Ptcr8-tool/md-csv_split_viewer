// A detached pane shares its owner's DocumentModel, including undo and save state.
// Only windows explicitly opened here can attach; Markdown never supplies this API.
export function paneSide(url=location.href){
  const u=new URL(url);return u.search==='?pane=source'?'source':u.search==='?pane=preview'?'preview':null;
}

export function createPaneHub(api){
  const peers=new Map();
  const alive=entry=>api.documents().some(d=>d.id===entry.id);
  const lockedFor=w=>api.locked()||Array.from(peers.entries()).some(([other,p])=>other!==w&&p.dialogOpen);
  const prune=()=>{for(const [w,p] of peers)if(w.closed||!alive(p)){const d=api.documents().find(d=>d.id===p.id);if(d?.componentEditing===w)d.componentEditing=null;if(d?.compositionOwner===w){d.composing=false;d.compositionOwner=null;}try{w.close();}catch{}peers.delete(w);}};
  function refresh(){
    prune();for(const [w,p] of peers){try{p.callbacks?.refresh({settings:api.settings(p.id),mode:api.mode(),locked:lockedFor(w)});}catch{if(w.closed)peers.delete(w);}}
  }
  const publicApi={
    attach(w,callbacks){
      const p=peers.get(w);
      if(!p||w.opener!==window||w.location.origin!==location.origin||w.location.pathname!==new URL('index.html',location.href).pathname||paneSide(w.location.href)!==p.side||!alive(p))throw new Error('この表示ウィンドウには接続できません。');
      p.callbacks=callbacks;
      const doc=api.documents().find(d=>d.id===p.id);
      const requireOpen=()=>{if(w.closed||!peers.has(w)||!alive(p))throw new Error('元の文書は閉じられています。');};
      return {
        document:doc,side:p.side,settings:api.settings(p.id),mode:api.mode(),locked:lockedFor(w),
        isLocked(){return lockedFor(w);},
        setDialogOpen(open){requireOpen();p.dialogOpen=!!open;refresh();},
        changed(){requireOpen();api.changed(p.id);refresh();},
        position(at){requireOpen();api.position(p.id,at);for(const [other,peer] of peers)if(other!==w&&peer.id===p.id)peer.callbacks?.position(at);},
        scroll(anchor){requireOpen();if(!api.settings(p.id).sync)return;api.followScroll(p.id,anchor);for(const [other,peer] of peers)if(other!==w&&peer.id===p.id)peer.callbacks?.followScroll(anchor);},
        async save(saveAs){requireOpen();if(lockedFor(w))return false;const result=await api.save(doc,saveAs);refresh();return result;},
        async csvSidecar(action,view){requireOpen();if(lockedFor(w))return null;return api.csvSidecar(action,p.id,view);},
        async setSettings(change){requireOpen();await api.setSettings(change);refresh();},
        setMode(value){requireOpen();api.setMode(value);refresh();},
        focusOwner(){requireOpen();return api.focusOwner();},
        search(replace,selected){requireOpen();return api.search(p.id,replace,selected);},
        detach(){peers.delete(w);},
      };
    }
  };
  Object.defineProperty(window,'__mdSplitPanes',{value:publicApi,configurable:true});
  const observer=new MutationObserver(refresh);observer.observe(document.querySelector('#app'),{attributes:true,attributeFilter:['inert']});
  observer.observe(document.querySelector('#modal'),{attributes:true,attributeFilter:['open']});
  const closeAll=()=>{for(const w of peers.keys())try{w.close();}catch{}peers.clear();};
  window.addEventListener('pagehide',closeAll);
  return {
    open(side){
      if(!['source','preview'].includes(side)||api.locked())return;
      prune();const d=api.current();for(const [w,p] of peers)if(p.id===d.id&&p.side===side){w.focus();return;}
      const url=new URL('index.html',location.href);url.search='?pane='+side;
      const w=window.open(url.href,'_blank','popup,width=960,height=800');
      if(!w){api.notify('表示ウィンドウを開けませんでした。');return;}
      peers.set(w,{id:d.id,side,callbacks:null});
    },
    refresh,
    childDialogOpen(){return Array.from(peers.values()).some(p=>p.dialogOpen);},
    position(id,at){prune();for(const p of peers.values())if(p.id===id)p.callbacks?.position(at);},
    scroll(id,anchor){prune();if(api.settings(id).sync)for(const p of peers.values())if(p.id===id)p.callbacks?.followScroll(anchor);},
    closeDocument(id){for(const [w,p] of peers)if(p.id===id){try{w.close();}catch{}peers.delete(w);}},
    closeAll,
  };
}

export function setupViewControls({settings,isPopup}){
  return ()=>{
    const s=settings(),mode=['source','preview'].includes(s.viewMode)?s.viewMode:'split';
    document.querySelector('.editor-panes').dataset.view=mode;
    for(const value of ['split','source','preview']){
      const button=document.querySelector('[data-cmd="view-'+value+'"]');
      button.classList.toggle('selected',value===mode);
      button.setAttribute('aria-pressed',String(value===mode));
      button.disabled=!!isPopup;
    }
    const outline=document.querySelector('[data-cmd="outline"]');
    outline.classList.toggle('selected',s.outlineVisible!==false);
    outline.setAttribute('aria-pressed',String(s.outlineVisible!==false));
    if(isPopup){document.documentElement.dataset.paneWindow=isPopup;document.querySelector('#outline-panel').hidden=true;}
  };
}
