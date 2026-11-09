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
