import {test,expect} from '@playwright/test';

const docs=[
  {id:'11111111-1111-4111-8111-111111111111',name:'one.md',path:'C:\\notes\\one.md',text:'one',savedText:'one',encoding:'utf8'},
  {id:'22222222-2222-4222-8222-222222222222',name:'two.txt',path:'C:\\notes\\two.txt',text:'two',savedText:'two',encoding:'utf8'}
];
async function desktop(page){
  await page.addInitScript(docs=>{
    const listeners=[];window._calls=[];
    window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      window._calls.push(message);let result=true;
      if(message.method==='bootstrap')result={settings:{welcomeShown:true,startupFormat:'csv',updateCheckDays:-1},documents:docs,activeId:docs[1].id};
      if(message.method==='file.save')result=null;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  },docs);await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
}
async function action(page,name){await page.getByLabel('ファイルメニュー').click();await page.locator(`[data-file-action="${name}"]`).click();}
async function edit(page,name,text){await page.locator('.tab-name').filter({hasText:name}).click();await page.locator('.cm-content').click();await page.keyboard.press('End');await page.keyboard.insertText(text);}

test('file menu calls existing save and save as actions and preserves toolbar buttons',async({page})=>{
  await desktop(page);
  await action(page,'save');await expect.poll(()=>page.evaluate(()=>window._calls.filter(c=>c.method==='file.save').length)).toBe(1);
  await action(page,'saveas');await expect.poll(()=>page.evaluate(()=>window._calls.filter(c=>c.method==='file.save').length)).toBe(2);
  const saves=await page.evaluate(()=>window._calls.filter(c=>c.method==='file.save').map(c=>c.args.saveAs));expect(saves).toEqual([false,true]);
  await expect(page.locator('.file-actions [data-cmd="save"]')).toBeVisible();await expect(page.locator('.file-actions [data-cmd="saveas"]')).toBeVisible();
});
test('closing the current tab through the menu keeps the other tab',async({page})=>{
  await desktop(page);await action(page,'closetab');await expect(page.locator('.tab-name')).toHaveCount(1);await expect(page.locator('.tab-name')).toContainText('one.md');
  expect(await page.evaluate(()=>window._calls.filter(c=>c.method==='document.close').map(c=>c.args.id))).toEqual([docs[1].id]);
});
test('cancel during close all retains every tab including an earlier discarded confirmation',async({page})=>{
  await desktop(page);await edit(page,'one.md',' x');await edit(page,'two.txt',' y');await action(page,'closeall');
  await expect(page.locator('#close-file-name')).toHaveText('one.md');await page.getByRole('button',{name:'保存せずに閉じる'}).click();
  await expect(page.locator('#close-file-name')).toHaveText('two.txt');await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  await expect(page.locator('.tab-name')).toHaveCount(2);await expect(page.locator('.tab.active .tab-name')).toContainText('two.txt');
  expect(await page.evaluate(()=>window._calls.filter(c=>c.method==='document.close'))).toHaveLength(0);
  expect(await page.evaluate(()=>window.__mdSplit.documents().map(d=>d.raw))).toEqual(['one x','two y']);
});
test('close all confirms unsaved content and opens a new tab in the configured format',async({page})=>{
  await desktop(page);await edit(page,'one.md',' x');await action(page,'closeall');await page.getByRole('button',{name:'保存せずに閉じる'}).click();
  await expect(page.locator('.tab-name')).toHaveCount(1);await expect(page.locator('.tab-name')).toHaveText('無題.csv');
  expect(await page.evaluate(()=>window._calls.filter(c=>c.method==='document.close').map(c=>c.args.id))).toEqual(docs.map(d=>d.id));
});
