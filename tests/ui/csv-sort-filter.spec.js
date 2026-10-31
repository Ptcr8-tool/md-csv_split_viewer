import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{await context.grantPermissions(['clipboard-read','clipboard-write']);await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);});
const open=(page,text)=>page.evaluate(text=>window.__mdSplit.openDocument({name:'table.csv',text,savedText:text,encoding:'utf8',hasBom:false}),text);
const raw=page=>page.evaluate(()=>window.__mdSplit.getText());
const cell=(page,row,col)=>page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${col}"]`);
test('sorts complete rows by selected column and supports undo',async({page})=>{
  await open(page,'name,num\r\n"c\nvalue",10\r\na,2\r\nb,1');await page.locator('#text-preview [data-select-column="1"]').click();
  await page.getByRole('button',{name:'並べ替え・列移動'}).click();const dialog=page.getByRole('dialog',{name:'並べ替え・列移動'});await expect(dialog.getByLabel('並べ替える列')).toHaveValue('1');await dialog.getByRole('button',{name:'実行'}).click();
  await expect.poll(()=>raw(page)).toBe('name,num\r\nb,1\r\na,2\r\n"c\nvalue",10');await cell(page,1,0).click();await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('name,num\r\n"c\nvalue",10\r\na,2\r\nb,1');
});
test('filter only affects visible rows and blocks hidden-range changes',async({page})=>{
  const source='name,value\nApple,1\nBanana,2\nApricot,3\n';await open(page,source);
  await page.getByRole('button',{name:'絞り込み',exact:true}).click();const dialog=page.getByRole('dialog',{name:'列で絞り込み'});await dialog.getByLabel('絞り込む文字').fill('ap');await dialog.getByRole('button',{name:'適用'}).click();
  await expect(cell(page,1,0)).toBeVisible();await expect(cell(page,2,0)).toHaveCount(0);await expect(cell(page,3,0)).toBeVisible();expect(await raw(page)).toBe(source);
  await cell(page,1,0).click();await cell(page,3,0).click({modifiers:['Shift']});await page.evaluate(()=>navigator.clipboard.writeText('unchanged'));await page.keyboard.press('Control+c');await expect(page.locator('.text-preview-status')).toContainText('非表示');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('unchanged');
  await page.getByRole('button',{name:'絞り込み解除'}).click();await expect(cell(page,2,0)).toBeVisible();expect(await raw(page)).toBe(source);
});
test('moves selected columns while preserving rows and undo',async({page})=>{
  await open(page,'a,b,c\n1,2,3\n');await page.locator('#text-preview [data-select-column="1"]').click();await page.getByRole('button',{name:'並べ替え・列移動'}).click();const dialog=page.getByRole('dialog',{name:'並べ替え・列移動'});await dialog.getByLabel('並べ替えの操作').selectOption('right');await dialog.getByRole('button',{name:'実行'}).click();await expect.poll(()=>raw(page)).toBe('a,c,b\n1,3,2\n');await cell(page,1,0).click();await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('a,b,c\n1,2,3\n');
});
