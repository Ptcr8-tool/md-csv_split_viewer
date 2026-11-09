import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true,updateCheckDays:-1})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
});

test('dragging a tab reorders it without changing text or the active document',async({page})=>{
  await page.evaluate(()=>{
    window.__mdSplit.openDocument({name:'one.md',text:'最初',needsInitialSave:false});
    window.__mdSplit.openDocument({name:'two.md',text:'次の文章',needsInitialSave:false});
    window.__mdSplit.openDocument({name:'three.md',text:'最後の文章',needsInitialSave:false});
  });
  const one=page.locator('.tab').filter({has:page.locator('.tab-name[title="one.md"]')});
  const three=page.locator('.tab').filter({has:page.locator('.tab-name[title="three.md"]')});
  await expect(one).toBeVisible();const box=await three.boundingBox();await one.dragTo(three,{targetPosition:{x:box.width-6,y:box.height/2}});
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name))).toEqual(['無題.md','two.md','three.md','one.md']);
  expect(await page.evaluate(()=>window.__mdSplit.model().name)).toBe('three.md');
  expect(await page.evaluate(()=>window.__mdSplit.model().raw)).toBe('最後の文章');
});

test('file drag does not become a tab reorder',async({page})=>{
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'one.md',text:'維持',needsInitialSave:false}));
  const before=await page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name));
  const events=await page.locator('.tabbar').evaluate(node=>{
    const transfer=new DataTransfer();transfer.items.add(new File(['sample'],'external.txt',{type:'text/plain'}));
    const event=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});node.dispatchEvent(event);return event.defaultPrevented;
  });
  expect(events).toBe(true);expect(await page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name))).toEqual(before);
});

test('native file opens wait until a tab drag is cancelled, then replay in order',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window._emit=event=>listeners.forEach(fn=>fn({data:event}));window._nativeCalls=[];
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      window._nativeCalls.push({method:message.method,args:message.args});
      const reply=result=>setTimeout(()=>window._emit({replyTo:message.id,result}),0);
      if(message.method==='bootstrap')reply({settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'元.md',text:'元の内容',savedText:'元の内容',needsInitialSave:false}]});
      else if(message.method==='tab.prepare'){window._lastPrepared=message.args;window._finishPrepare=()=>reply({token:message.args.token});}
      else if(message.method==='tab.can-detach')reply(false);else if(message.method==='tab.cancel')reply('cancelled');else reply(true);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit?.model()?.name==='元.md');
  const openTabs=page.getByRole('button',{name:'タブを展開',exact:true});if(await openTabs.isVisible())await openTabs.click();
  await page.locator('.tab').first().evaluate(node=>{window._tabDrag=new DataTransfer();node.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:window._tabDrag}));});
  await page.waitForFunction(()=>typeof window._finishPrepare==='function');
  await page.evaluate(()=>{
    window._emit({type:'files-opened',documents:[{id:'22222222-2222-4222-8222-222222222222',name:'後から.md',text:'開いた内容',savedText:'開いた内容',needsInitialSave:false}]});
    window._emit({type:'new-document',document:{id:'33333333-3333-4333-8333-333333333333',name:'新規.md',text:'',needsInitialSave:false}});
    window._emit({type:'activate-document',id:'22222222-2222-4222-8222-222222222222'});
  });
  expect(await page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name))).toEqual(['元.md']);
  await page.evaluate(()=>{window._finishPrepare();document.querySelector('.tab').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window._tabDrag,screenX:100,screenY:100}));});
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name))).toEqual(['元.md','後から.md','新規.md']);
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('後から.md');
  expect(await page.evaluate(()=>window.__mdSplit.documents()[0].raw)).toBe('元の内容');
  // A deferred native file-open already owns a native registration. Moving it
  // after cancellation must not replace that registration with an empty one.
  expect(await page.evaluate(()=>window._nativeCalls.filter(c=>c.method==='document.register'&&c.args.id==='22222222-2222-4222-8222-222222222222'))).toEqual([]);
  await page.evaluate(()=>{window._lastPrepared=null;window._tabDrag=new DataTransfer();document.querySelector('[data-tab-id="22222222-2222-4222-8222-222222222222"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:window._tabDrag}));});
  await page.waitForFunction(()=>window._lastPrepared?.document?.id==='22222222-2222-4222-8222-222222222222');
  expect(await page.evaluate(()=>window._lastPrepared.document.text)).toBe('開いた内容');
  await page.evaluate(()=>{window._finishPrepare();document.querySelector('[data-tab-id="22222222-2222-4222-8222-222222222222"]').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window._tabDrag,screenX:100,screenY:100}));});
  await expect.poll(()=>page.evaluate(()=>window._nativeCalls.filter(c=>c.method==='tab.cancel').length)).toBe(2);
});

test('a busy destination rejects the incoming tab transfer immediately',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window._transferRequests=[];
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      if(message.method.startsWith('tab.'))window._transferRequests.push({method:message.method,args:message.args});
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'移動先.md',text:'維持',needsInitialSave:false}]}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit?.model()?.name==='移動先.md');
  await page.evaluate(()=>{
    document.querySelector('#app').inert=true;
    const transfer=new DataTransfer();transfer.setData('application/x-md-split-tab',JSON.stringify({token:'22222222-2222-4222-8222-222222222222',instance:'another-window',id:'33333333-3333-4333-8333-333333333333'}));
    document.querySelector('.tabbar').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect.poll(()=>page.evaluate(()=>window._transferRequests)).toEqual([{method:'tab.reject',args:{token:'22222222-2222-4222-8222-222222222222'}}]);
  expect(await page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name))).toEqual(['移動先.md']);
});

test('a lost completion notification is resolved from the native committed status',async({page})=>{
  await page.addInitScript(()=>{
    const originalSetTimeout=window.setTimeout.bind(window);
    window.setTimeout=(fn,delay,...args)=>originalSetTimeout(fn,delay===30000?100:delay,...args);
    const listeners=[];window._nativeCalls=[];
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      window._nativeCalls.push({method:message.method,args:message.args});
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1},activeId:'11111111-1111-4111-8111-111111111111',documents:[
        {id:'11111111-1111-4111-8111-111111111111',name:'移動.md',text:'未保存の内容',savedText:'保存済み',needsInitialSave:false},
        {id:'22222222-2222-4222-8222-222222222222',name:'残す.md',text:'残す内容',savedText:'残す内容',needsInitialSave:false}
      ]}:message.method==='tab.cancel'?'committed':true;
      originalSetTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit?.model()?.name==='移動.md');
  await page.evaluate(()=>{
    const transfer=new DataTransfer();Object.defineProperty(transfer,'dropEffect',{value:'move',configurable:true});
    const tab=document.querySelector('[data-tab-id="11111111-1111-4111-8111-111111111111"]');
    tab.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    tab.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer,screenX:100,screenY:100}));
  });
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents().map(d=>d.name))).toEqual(['残す.md']);
  expect(await page.evaluate(()=>window.__mdSplit.model().raw)).toBe('残す内容');
  await expect.poll(()=>page.evaluate(()=>window._nativeCalls.some(c=>c.method==='tab.finalized'))).toBe(true);
  const calls=await page.evaluate(()=>window._nativeCalls);
  expect(calls.find(c=>c.method==='tab.prepare').args.document.text).toBe('未保存の内容');
  expect(calls.filter(c=>c.method==='tab.cancel')).toHaveLength(1);
});

test('an unconfirmed cancellation keeps unsaved content locked until native confirms',async({page})=>{
  await page.addInitScript(()=>{
    const originalSetTimeout=window.setTimeout.bind(window);
    window.setTimeout=(fn,delay,...args)=>originalSetTimeout(fn,delay===30000||delay===1000?50:delay,...args);
    const listeners=[];window._cancelCount=0;window._emit=event=>listeners.forEach(fn=>fn({data:event}));
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      const reply=result=>originalSetTimeout(()=>window._emit({replyTo:message.id,result}),0);
      if(message.method==='bootstrap')reply({settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'未保存.md',text:'編集中の内容',savedText:'元の内容',needsInitialSave:false}]});
      else if(message.method==='tab.cancel'){window._cancelCount++;if(window._cancelCount<3)reply('unavailable');else window._confirmCancel=()=>reply('cancelled');}
      else if(message.method==='tab.can-detach')reply(false);else reply(true);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit?.model()?.name==='未保存.md');
  await page.evaluate(()=>{
    const transfer=new DataTransfer(),tab=document.querySelector('.tab');
    tab.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    tab.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer,screenX:100,screenY:100}));
  });
  await page.waitForFunction(()=>typeof window._confirmCancel==='function');
  await page.evaluate(()=>window._emit({type:'new-document',document:{id:'22222222-2222-4222-8222-222222222222',name:'保留.md',text:'保留',needsInitialSave:false}}));
  expect(await page.evaluate(()=>window.__mdSplit.documents().map(d=>[d.name,d.raw]))).toEqual([['未保存.md','編集中の内容']]);
  await page.evaluate(()=>window._confirmCancel());
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents().map(d=>[d.name,d.raw]))).toEqual([['未保存.md','編集中の内容'],['保留.md','保留']]);
});
