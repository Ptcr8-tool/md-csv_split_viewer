import {test,expect} from '@playwright/test';

const cell=(page,row,column)=>page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${column}"]`);
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  const text='A,B,C\n1,2,3\n4,5,6\n7,8,9';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'grid.csv',path:'C:\\synthetic\\grid.csv',text,savedText:text,encoding:'utf8',hasBom:false}),text);
});
async function preferences(page,direction,striped='off'){
  await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定'});
  await dialog.locator('#csv-enter-direction').selectOption(direction);
  await dialog.locator('#csv-striped-rows').selectOption(striped);
  await dialog.getByRole('button',{name:'適用',exact:true}).click();
}
for(const [direction,from,to] of [['down',[1,1],[2,1]],['up',[2,1],[1,1]],['left',[1,1],[1,0]],['right',[1,1],[1,2]]]){
  test(`Enter moves ${direction} for editing and selection`,async({page})=>{
    await preferences(page,direction);
    await cell(page,...from).dblclick();await cell(page,...from).locator('textarea').press('Enter');
    await expect(cell(page,...to).locator('textarea')).toBeFocused();
    await cell(page,...to).locator('textarea').press('Escape');
    await cell(page,...from).click();await cell(page,...from).press('Enter');
    await expect(cell(page,...to)).toBeFocused();await expect(cell(page,...to)).toHaveClass(/csv-selected/);
  });
}
test('no movement ends editing, stripes are view-only and retained across tabs',async({page})=>{
  await preferences(page,'none','on');
  const table=page.locator('#text-preview table');await expect(table).toHaveClass(/csv-striped/);
  const one=cell(page,1,0),two=cell(page,2,0);
  await expect.poll(async()=>await one.evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe(await two.evaluate(n=>getComputedStyle(n).backgroundColor));
  await one.dblclick();await one.locator('textarea').press('Enter');await expect(one).toBeFocused();
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'other.txt',path:'C:\\synthetic\\other.txt',text:'other',encoding:'utf8',hasBom:false}));
  await page.locator('.tab-name[title$="grid.csv"]').click();await expect(table).toHaveClass(/csv-striped/);
  await page.getByRole('button',{name:'表示設定',exact:true}).click();const dialog=page.getByRole('dialog',{name:'CSVの表示設定'});
  await expect(dialog.locator('#csv-enter-direction')).toHaveValue('none');await expect(dialog.locator('#csv-striped-rows')).toHaveValue('on');
});
test('Enter skips hidden columns',async({page})=>{
  await preferences(page,'right');await page.locator('#text-preview thead [data-select-column="1"]').click();
  await page.getByRole('button',{name:'選択を非表示',exact:true}).click();
  await cell(page,1,0).dblclick();await cell(page,1,0).locator('textarea').press('Enter');
  await expect(cell(page,1,2).locator('textarea')).toBeFocused();
});
test('Enter skips rows hidden by a filter',async({page})=>{
  const text='A,B\nkeep,one\nskip,two\nkeep,three';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'filter.csv',path:'C:\\synthetic\\filter.csv',text,savedText:text,encoding:'utf8',hasBom:false}),text);
  await page.getByRole('button',{name:'絞り込み',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'列で絞り込み'});
  await dialog.getByRole('textbox',{name:'絞り込む文字'}).fill('keep');
  await dialog.getByRole('button',{name:'適用',exact:true}).click();
  await cell(page,1,1).dblclick();await cell(page,1,1).locator('textarea').press('Enter');
  await expect(cell(page,3,1).locator('textarea')).toBeFocused();
});
