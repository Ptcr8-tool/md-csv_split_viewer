import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{await context.grantPermissions(['clipboard-read','clipboard-write']);await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);});
const cell=(page,r,c)=>page.locator(`#text-preview [data-cell-row="${r}"][data-cell-column="${c}"]`);
const raw=page=>page.evaluate(()=>window.__mdSplit.getText());
const open=async page=>page.evaluate(()=>window.__mdSplit.openDocument({name:'test.csv',text:'a,b,c\nｶﾞ,hello,x\nかな,world,y\n',savedText:'a,b,c\nｶﾞ,hello,x\nかな,world,y\n',encoding:'utf8',hasBom:false}));
const action=async(page,r,c,label)=>{await cell(page,r,c).click({button:'right'});await page.getByRole('menuitem',{name:label,exact:true}).click();};

test('context menu converts selected cells and supports undo',async({page})=>{
  await open(page);await cell(page,1,0).click();await action(page,1,0,'半角カタカナをひらがなに');await expect.poll(()=>raw(page)).toBe('a,b,c\nが,hello,x\nかな,world,y\n');
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('a,b,c\nｶﾞ,hello,x\nかな,world,y\n');
  await action(page,2,0,'ひらがなを半角カタカナに');await expect.poll(()=>raw(page)).toBe('a,b,c\nｶﾞ,hello,x\nｶﾅ,world,y\n');
});
test('context paste transposes and removes line breaks only when requested',async({page})=>{
  await open(page);await page.evaluate(()=>navigator.clipboard.writeText('one\ttwo\nthree\tfour'));await action(page,1,0,'縦横を入れ替えて貼り付け');await expect.poll(()=>raw(page)).toBe('a,b,c\none,three,x\ntwo,four,y\n');
  await page.evaluate(()=>navigator.clipboard.writeText('left\nright'));await action(page,1,2,'改行を除いて貼り付け');await expect.poll(()=>raw(page)).toBe('a,b,c\none,three,leftright\ntwo,four,y\n');
  await page.evaluate(()=>navigator.clipboard.writeText('first\t'));await action(page,1,0,'縦横を入れ替えて貼り付け');await expect.poll(()=>raw(page)).toBe('a,b,c\nfirst,three,leftright\n,four,y\n');
});
test('copy preserves the clipboard on sparse selection',async({page})=>{
  await open(page);await page.evaluate(()=>navigator.clipboard.writeText('keep'));await cell(page,1,0).click();await cell(page,2,1).click({modifiers:['Control']});await action(page,1,0,'コピー');await expect(page.locator('#text-preview .text-preview-status')).toContainText('連続した範囲');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('keep');
});
test('does not paste if document changes while clipboard access is pending',async({page})=>{
  await open(page);await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>new Promise(resolve=>window.__finishClipboard=resolve)});});
  await action(page,1,0,'貼り付け');await page.waitForFunction(()=>typeof window.__finishClipboard==='function');
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'other.csv',text:'x,y\n1,2\n',savedText:'x,y\n1,2\n',encoding:'utf8',hasBom:false}));
  await page.evaluate(()=>window.__finishClipboard('danger'));await expect(page.locator('#text-preview .text-preview-status')).toContainText('中止');expect(await raw(page)).toBe('x,y\n1,2\n');
});
