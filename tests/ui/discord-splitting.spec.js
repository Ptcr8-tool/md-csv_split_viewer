import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true,updateCheckDays:-1})));await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);});
const open=async(page,text)=>{await page.evaluate(t=>window.__mdSplit.setText(t),text);await page.getByRole('button',{name:'Discord表示',exact:true}).click();await page.locator('#show-chunks').click();};
const bodyPoint=async(locator,offset)=>locator.evaluate((el,offset)=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,left=offset;
  while((n=walker.nextNode())){if(left<=n.length){const r=document.createRange();r.setStart(n,left);r.setEnd(n,Math.min(n.length,left+1));const rect=r.getBoundingClientRect();return {x:rect.left+Math.min(rect.width/2,2),y:rect.top+rect.height/2};}left-=n.length;}
},offset);

test('a message under the limit is one card, even with multiple paragraphs',async({page})=>{
  const text='見出し\n\n'+'あ'.repeat(1900)+'\n\n末尾';await open(page,text);
  await page.locator('#limit').selectOption('4000');await expect(page.locator('.chunk')).toHaveCount(1);
  await expect(page.locator('.chunk-text')).toHaveText(text);
});

test('add, drag and delete boundaries without editing the document, and reset on close',async({page})=>{
  const text='はじめの文章です。\n\n次の文章です。\n\n最後の文章です。';await open(page,text);
  const body=page.locator('.chunk-body').first();const point=await bodyPoint(body,6);await page.mouse.click(point.x,point.y);
  await expect(page.locator('.chunk-add')).toBeEnabled();await page.locator('.chunk-add').click();
  await expect(page.locator('.chunk')).toHaveCount(2);await expect(page.locator('.chunk-boundary')).toHaveCount(1);
  const before=await page.locator('.chunk-body').first().innerText();
  const dest=await bodyPoint(page.locator('.chunk-body').last(),3);
  const source=await page.locator('.chunk-drag').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
  await page.mouse.move(dest.x,dest.y,{steps:15});await page.mouse.up();
  await expect.poll(()=>page.locator('.chunk-body').first().innerText()).not.toBe(before);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  await page.getByRole('button',{name:'区切り 1 を削除'}).click();await expect(page.locator('.chunk')).toHaveCount(1);
  await page.locator('#close-chunks').click();await page.locator('#show-chunks').click();await expect(page.locator('.chunk')).toHaveCount(1);
});

test('removing a boundary can exceed the limit and displays a red warning',async({page})=>{
  const text='あ'.repeat(2150);await open(page,text);
  await expect(page.locator('.chunk')).toHaveCount(2);await page.getByRole('button',{name:'区切り 1 を削除'}).click();
  await expect(page.locator('.chunk-over')).toHaveCount(1);await expect(page.locator('.chunk-head')).toContainText('上限超過');
  await expect(page.locator('.chunk-head button')).toBeEnabled();
  await page.getByRole('button',{name:'自動分割に戻す'}).click();await expect(page.locator('.chunk')).toHaveCount(2);await expect(page.locator('.chunk-over')).toHaveCount(0);
});

test('manual points track edits while the panel is open',async({page})=>{
  const text='最初の文章です。\n\n次の文章です。';await open(page,text);
  const p=await bodyPoint(page.locator('.chunk-body').first(),5);await page.mouse.click(p.x,p.y);await page.locator('.chunk-add').click();
  const first=await page.locator('.chunk-body').first().innerText();
  await page.evaluate(()=>{const cm=window.__mdSplit.editor();cm.dispatch({changes:{from:0,insert:'追記'}});});
  await expect(page.locator('.chunk')).toHaveCount(2);await expect(page.locator('.chunk-body').first()).toHaveText('追記'+first);
});

test('copies each manually split part with its Markdown formatting balanced',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const text='**あいうえお**';await open(page,text);
  const p=await bodyPoint(page.locator('.chunk-body').first(),4);await page.mouse.click(p.x,p.y);await page.locator('.chunk-add').click();
  await page.locator('.chunk-head button').first().click();
  const first=await page.evaluate(()=>navigator.clipboard.readText());
  await page.locator('.chunk-head button').last().click();
  const second=await page.evaluate(()=>navigator.clipboard.readText());
  expect(first).toMatch(/^\*\*.+\*\*$/);expect(second).toMatch(/^\*\*.+\*\*$/);
  expect(first.slice(2,-2)+second.slice(2,-2)).toBe('あいうえお');
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
});

test('switching documents does not reuse the other document\'s split points',async({page})=>{
  const original='一つめの文章です。続きがあります。';await open(page,original);
  const p=await bodyPoint(page.locator('.chunk-body').first(),5);await page.mouse.click(p.x,p.y);await page.locator('.chunk-add').click();
  await expect(page.locator('.chunk')).toHaveCount(2);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'other.md',text:'別の短い文章'}));
  await expect(page.locator('.chunk')).toHaveCount(1);await expect(page.locator('.chunk-body')).toHaveText('別の短い文章');
  await page.locator('.tab-name').first().click();await expect(page.locator('.chunk')).toHaveCount(2);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(original);
});

test('shows the split point beside the Discord document and drags it on the document',async({page})=>{
  const text='はじめの文章です。続きの文章です。最後の文章です。';await open(page,text);
  const p=await bodyPoint(page.locator('.chunk-body').first(),6);await page.mouse.click(p.x,p.y);await page.locator('.chunk-add').click();
  const handle=page.getByRole('button',{name:'本文の区切り 1 を移動'});await expect(handle).toBeVisible();
  const before=await page.locator('.chunk-body').first().innerText();
  const target=await bodyPoint(page.locator('#preview .md-leaf').first(),14);
  const from=await handle.boundingBox();await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:15});await page.mouse.up();
  await expect.poll(()=>page.locator('.chunk-body').first().innerText()).not.toBe(before);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  await page.locator('#close-chunks').click();await expect(page.locator('.discord-preview-boundary')).toHaveCount(0);
});

test('TXT supports split, source marker dragging, copying and red overflow without editing the file',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const text='最初の文章です。続きの文章です。\r\n次の行です。';
  await page.evaluate(t=>window.__mdSplit.openDocument({name:'sample.txt',text:t}),text);
  await expect(page.locator('#show-chunks')).toBeVisible();await expect(page.locator('.render-toggle')).toBeHidden();
  await page.locator('#show-chunks').click();await expect(page.locator('.chunk')).toHaveCount(1);
  const point=await bodyPoint(page.locator('.chunk-body').first(),6);await page.mouse.click(point.x,point.y);await page.locator('.chunk-add').click();
  await expect(page.locator('.chunk')).toHaveCount(2);
  const marker=page.getByRole('button',{name:'テキストの区切り 1 を移動'});await expect(marker).toBeVisible();
  const first=await page.locator('.chunk-body').first().textContent();
  const target=await page.evaluate(()=>{const r=window.__mdSplit.editor().coordsAtPos(13);return{x:r.left,y:(r.top+r.bottom)/2};});
  const from=await marker.boundingBox();await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:15});await page.mouse.up();
  await expect.poll(()=>page.locator('.chunk-body').first().textContent()).not.toBe(first);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  await page.locator('.chunk-head button').first().click();const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(text.startsWith(copied)).toBe(true);
  await page.getByRole('button',{name:'区切り 1 を削除'}).click();await expect(page.locator('.chunk')).toHaveCount(1);
  await page.evaluate(()=>window.__mdSplit.setText('あ'.repeat(2050)));await expect(page.locator('.chunk')).toHaveCount(1);
  await expect(page.locator('.chunk-over')).toHaveCount(1);
  await page.getByRole('button',{name:'自動分割に戻す'}).click();await expect(page.locator('.chunk')).toHaveCount(2);
  await page.locator('#close-chunks').click();await expect(page.locator('.discord-source-overlay button')).toHaveCount(0);
});

test('TXT split points remain separate from Markdown and CSV hides split controls',async({page})=>{
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'notes.txt',text:'これはテキストの文章です。'}));await page.locator('#show-chunks').click();
  const point=await bodyPoint(page.locator('.chunk-body').first(),5);await page.mouse.click(point.x,point.y);await page.locator('.chunk-add').click();await expect(page.locator('.chunk')).toHaveCount(2);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'other.txt',text:'別の文書'}));await expect(page.locator('.chunk')).toHaveCount(1);
  await page.locator('.tab-name').filter({hasText:'notes.txt'}).click();await expect(page.locator('.chunk')).toHaveCount(2);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'rows.csv',text:'a,b\n1,2'}));await expect(page.locator('#show-chunks')).toBeHidden();await expect(page.locator('.chunks-panel')).toBeHidden();
});
