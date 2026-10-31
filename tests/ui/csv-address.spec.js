import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'address.csv',path:'C:\\synthetic\\address.csv',text:'A,B,C\n1,2,3\n4,5,6\n7,8,9',savedText:'A,B,C\n1,2,3\n4,5,6\n7,8,9',encoding:'utf8',hasBom:false}));
});
const cell=(page,r,c)=>page.locator(`#text-preview [data-cell-row="${r}"][data-cell-column="${c}"]`);
const address=page=>page.locator('#text-preview .csv-address');
test('address follows cells and distinct selected ranges without changing content',async({page})=>{
  await cell(page,1,0).click();await expect(address(page)).toHaveText('2A');
  await cell(page,2,1).click({modifiers:['Shift']});await expect(address(page)).toHaveText('2A:3B');
  await cell(page,3,2).click({modifiers:['Control']});await expect(address(page)).toHaveText('2A:4C（複数範囲）');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});
test('numeric column style disambiguates row and column addresses',async({page})=>{
  await cell(page,1,0).click();
  await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定'});
  await dialog.locator('#csv-column-label').selectOption('numbers');
  await dialog.getByRole('button',{name:'適用',exact:true}).click();
  await expect(address(page)).toHaveText('2-1');
  await cell(page,2,1).click({modifiers:['Shift']});await expect(address(page)).toHaveText('2-1:3-2');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});
