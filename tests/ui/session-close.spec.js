import {test,expect} from '@playwright/test';

const docs=[
  {id:'11111111-1111-4111-8111-111111111111',name:'one.md',path:'C:\\notes\\one.md',text:'one',savedText:'one',encoding:'utf8'},
  {id:'22222222-2222-4222-8222-222222222222',name:'two.txt',path:'C:\\notes\\two.txt',text:'two',savedText:'two',encoding:'utf8'}
];
async function desktop(page,settings={}){
  await page.addInitScript(({docs,settings})=>{
    const listeners=[];window._sessionCalls=[];
    window._hostEvent=event=>listeners.forEach(fn=>fn({data:event}));
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      window._sessionCalls.push(message);
      let result=true;if(message.method==='bootstrap')result={settings:{welcomeShown:true,updateCheckDays:-1,...settings},documents:docs,activeId:docs[1].id};
      setTimeout(()=>window._hostEvent({replyTo:message.id,result}),0);
    }};
  },{docs,settings});
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
}
async function editFirst(page){
  await page.locator('.tab-name').filter({hasText:'one.md'}).click();
  await page.locator('.cm-content').click();await page.keyboard.press('End');await page.keyboard.insertText(' changed');
  await page.locator('.tab-name').filter({hasText:'two.txt'}).click();
}
test('canceling close keeps all tabs and never commits a session',async({page})=>{
  await desktop(page,{sessionPolicy:'all'});await editFirst(page);await page.evaluate(()=>window._hostEvent({type:'close-request'}));
  await expect(page.locator('#dialog-title')).toHaveText('変更を保存しますか？');await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  await expect(page.locator('.tab-name').filter({hasText:'one.md'})).toBeVisible();await expect(page.locator('.tab.active .tab-name')).toContainText('two.txt');
  expect(await page.evaluate(()=>window._sessionCalls.filter(c=>['session.save','window.close'].includes(c.method)))).toEqual([]);
});
test('discard preserves original active tab and records only trusted document IDs',async({page})=>{
  await desktop(page,{sessionPolicy:'all'});await editFirst(page);await page.evaluate(()=>window._hostEvent({type:'close-request'}));
  await page.getByRole('button',{name:'保存せずに閉じる'}).click();
  await expect.poll(()=>page.evaluate(()=>window._sessionCalls.some(c=>c.method==='window.close'))).toBe(true);
  const session=await page.evaluate(()=>window._sessionCalls.find(c=>c.method==='session.save').args);
  expect(session).toMatchObject({policy:'all',documentIds:docs.map(d=>d.id),activeId:docs[1].id});
  expect(session).not.toHaveProperty('documents');
});
test('the menu can override the default for this close without changing settings',async({page})=>{
  await desktop(page,{sessionPolicy:'all'});await page.getByText('ファイル',{exact:true}).first().click();await page.getByRole('button',{name:'表示中のタブだけを次回開く'}).click();
  await expect.poll(()=>page.evaluate(()=>window._sessionCalls.some(c=>c.method==='window.close'))).toBe(true);
  const calls=await page.evaluate(()=>window._sessionCalls);expect(calls.find(c=>c.method==='session.save').args.policy).toBe('active');expect(calls.filter(c=>c.method==='settings.set')).toHaveLength(0);
});

test('ordinary startup uses the chosen new file type after the first-run guide',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,startupFormat:'csv',updateCheckDays:-1},documents:[],showWelcome:false}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  });
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  await expect(page.locator('.tab.active .tab-name')).toHaveText('無題.csv');
});
