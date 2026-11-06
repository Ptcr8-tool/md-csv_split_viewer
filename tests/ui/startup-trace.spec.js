import {test,expect} from '@playwright/test';

async function open(page,enabled){
  await page.addInitScript(enabled=>{
    const listeners=[];window._traceCalls=[];window.chrome=window.chrome||{};
    window.chrome.webview={addEventListener(type,fn){if(type==='message')listeners.push(fn);},postMessage(message){
      if(message.method.startsWith('startup.'))window._traceCalls.push({method:message.method,args:message.args});
      const result=message.method==='bootstrap'?{startupTraceEnabled:enabled,settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'notes.txt',text:'example',savedText:'example',needsInitialSave:false}]}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  },enabled);
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());
}

test('startup timing stays disabled unless the host requests it',async({page})=>{
  await open(page,false);await page.locator('.cm-content').click();await page.keyboard.insertText('ab');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toContain('ab');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>window._traceCalls)).toEqual([]);
});

test('opt-in timing reports first paint and first user edit without document contents',async({page})=>{
  await open(page,true);
  await expect.poll(()=>page.evaluate(()=>window._traceCalls.map(call=>call.method))).toContain('startup.ready');
  await page.locator('.cm-content').click();await page.keyboard.insertText('ab');await page.keyboard.insertText('cd');
  await expect.poll(()=>page.evaluate(()=>window._traceCalls.filter(call=>call.method==='startup.firstInput').length)).toBe(1);
  const calls=await page.evaluate(()=>window._traceCalls);
  expect(calls).toEqual([{method:'startup.ready',args:{}},{method:'startup.firstInput',args:{}}]);
});
