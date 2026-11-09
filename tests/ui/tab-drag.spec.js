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
    const listeners=[];window._emit=event=>listeners.forEach(fn=>fn({data:event}));
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      const reply=result=>setTimeout(()=>window._emit({replyTo:message.id,result}),0);
      if(message.method==='bootstrap')reply({settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'元.md',text:'元の内容',savedText:'元の内容',needsInitialSave:false}]});
      else if(message.method==='tab.prepare')window._finishPrepare=()=>reply({token:message.args.token});
      else if(message.method==='tab.can-detach')reply(false);else reply(true);
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
});
