import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
});
const open=async(page,name,text)=>page.evaluate(({name,text})=>window.__mdSplit.openDocument({name,text,savedText:text,encoding:'utf8',hasBom:false}),{name,text});
const cell=(page,row,col)=>page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${col}"]`);
const raw=page=>page.evaluate(()=>window.__mdSplit.getText());
const clipboard=page=>page.evaluate(()=>navigator.clipboard.readText());
const setClipboard=(page,text)=>page.evaluate(value=>navigator.clipboard.writeText(value),text);

test('copies a rectangular range and pastes into another CSV including quoted cells, undo and redo',async({page})=>{
  await open(page,'one.csv','h1,h2,h3\r\n"a,b","line 1\r\nline 2",x\r\n"say ""hi""",b,y\r\n');
  await cell(page,1,0).click();await cell(page,2,1).click({modifiers:['Shift']});await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('a,b\t"line 1\nline 2"\n"say ""hi"""\tb');
  await open(page,'two.csv','u,v,w\r\n1,2,3\r\n');await cell(page,1,1).click();await page.keyboard.press('Control+v');
  await expect.poll(()=>raw(page)).toBe('u,v,w\r\n1,"a,b","line 1\r\nline 2"\r\n,"say ""hi""",b\r\n');
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('u,v,w\r\n1,2,3\r\n');
  await page.keyboard.press('Control+y');await expect.poll(()=>raw(page)).toBe('u,v,w\r\n1,"a,b","line 1\r\nline 2"\r\n,"say ""hi""",b\r\n');
});

test('clicking row-number whitespace focuses the grid for copy and paste',async({page})=>{
  await open(page,'rows.csv','h1,h2\nfirst,"a,b"\nthird,old\n');
  const gutter=page.locator('#text-preview tbody tr[data-grid-row="1"] .text-preview-row-number');const box=await gutter.boundingBox();
  await page.locator('#source .cm-content').click();await page.mouse.click(box.x+5,box.y+box.height/2);
  await page.keyboard.press('Control+c');expect(await clipboard(page)).toBe('first\ta,b');
  await page.locator('#text-preview [data-select-row="2"]').click();await page.keyboard.press('Control+v');
  await expect.poll(()=>raw(page)).toBe('h1,h2\nfirst,"a,b"\nfirst,"a,b"\n');
});

test('copy column and all selections includes the header and paste targets an existing cell',async({page})=>{
  await open(page,'columns.csv','name,city\nAlice,Tokyo\nBob,Osaka\n');
  await page.locator('#text-preview [data-select-column="1"]').click();await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('city\nTokyo\nOsaka');
  await page.locator('#text-preview [data-select-all]').click();await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('name\tcity\nAlice\tTokyo\nBob\tOsaka');
  await cell(page,1,0).click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('name\tcity\nAlice\tTokyo\nBob\tOsaka');
  await cell(page,1,0).click();await page.keyboard.press('Control+v');await expect.poll(()=>raw(page)).toBe('name,city\nname,city\nAlice,Tokyo\nBob,Osaka\n');
});

test('single value fills selected cells, sparse selection is rejected, and cell editing keeps text clipboard behavior',async({page})=>{
  await open(page,'fill.csv','h1,h2\na,b\nc,d\n');
  await setClipboard(page,'X');await cell(page,1,0).click();await cell(page,2,1).click({modifiers:['Shift']});await page.keyboard.press('Control+v');
  await expect.poll(()=>raw(page)).toBe('h1,h2\nX,X\nX,X\n');
  await cell(page,1,0).click();await cell(page,2,1).click({modifiers:['Control']});await page.keyboard.press('Control+v');
  await expect(page.locator('#text-preview .text-preview-status')).toContainText('連続した範囲');expect(await raw(page)).toBe('h1,h2\nX,X\nX,X\n');
  await setClipboard(page,'保留中のクリップボード');await page.keyboard.press('Control+c');await expect(page.locator('#text-preview .text-preview-status')).toContainText('連続した範囲');expect(await clipboard(page)).toBe('保留中のクリップボード');
  await cell(page,1,0).dblclick();const input=page.locator('#text-preview textarea');await expect(input).toBeVisible();
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');expect(await clipboard(page)).toBe('X');
  await setClipboard(page,'"quoted"');await page.keyboard.press('Control+v');await expect(input).toHaveValue('"quoted"');
});

test('copy and paste refuse a selection spanning hidden rows or columns',async({page})=>{
  await open(page,'hidden.csv','a,b,c\n1,2,3\n4,5,6\n');
  await page.locator('#text-preview [data-select-column="1"]').click();await page.getByRole('button',{name:'選択を非表示'}).click();
  await cell(page,1,0).click();await cell(page,1,2).click({modifiers:['Shift']});await page.keyboard.press('Control+c');
  await expect(page.locator('#text-preview .text-preview-status')).toContainText('非表示の行または列');expect(await raw(page)).toBe('a,b,c\n1,2,3\n4,5,6\n');
});

test('pasting beyond the grid and undoing keeps existing column and row settings',async({page})=>{
  await open(page,'layout.csv','a,b\n1,2\n');
  await page.locator('#text-preview [data-select-column="0"]').click();await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定'});await dialog.locator('#csv-column-width').fill('240');await dialog.getByRole('button',{name:'適用',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().csvView?.columnWidths?.[0])).toBe(240);
  await setClipboard(page,'x\ty\tz\nnext\tlast\tend');await cell(page,1,1).click();await page.keyboard.press('Control+v');
  await expect.poll(()=>raw(page)).toBe('a,b\n1,x,y,z\n,next,last,end\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('a,b\n1,2\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
  await page.keyboard.press('Control+y');await expect.poll(()=>raw(page)).toBe('a,b\n1,x,y,z\n,next,last,end\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
});

test('after editing a cell, corner, row and column selection retain focus for copying',async({page})=>{
  await open(page,'commit-focus.csv','h1,h2\na,b\nc,d\n');
  await cell(page,1,0).dblclick();await page.keyboard.press('Control+a');await page.keyboard.insertText('edited');
  await page.locator('#text-preview [data-select-all]').click();await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('h1\th2\nedited\tb\nc\td');
  await cell(page,2,0).dblclick();await page.locator('#text-preview [data-select-row="1"]').click();await page.keyboard.press('Control+c');
  expect(await clipboard(page)).toBe('edited\tb');
  await cell(page,2,0).dblclick();await page.locator('#text-preview [data-select-column="1"]').click();await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('h2\nb\nd');
  await page.getByLabel('先頭行を見出しにする').uncheck();await cell(page,2,0).dblclick();
  await page.locator('#text-preview [data-select-column="1"]').click();await page.keyboard.press('Control+c');
  expect((await clipboard(page)).replace(/\r\n/g,'\n')).toBe('h2\nb\nd');
});

test('multiple expanding pastes retain column widths through multiple undo and redo',async({page})=>{
  await open(page,'layout-history.csv','a,b\n1,2\n');
  await page.locator('#text-preview [data-select-column="0"]').click();await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定'});await dialog.locator('#csv-column-width').fill('240');await dialog.getByRole('button',{name:'適用',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().csvView?.columnWidths?.[0])).toBe(240);
  await setClipboard(page,'x\ty');await cell(page,1,1).click();await page.keyboard.press('Control+v');await expect.poll(()=>raw(page)).toBe('a,b\n1,x,y\n');
  await setClipboard(page,'z\tq');await cell(page,1,2).click();await page.keyboard.press('Control+v');await expect.poll(()=>raw(page)).toBe('a,b\n1,x,z,q\n');
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('a,b\n1,x,y\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe('a,b\n1,2\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
  await page.keyboard.press('Control+y');await expect.poll(()=>raw(page)).toBe('a,b\n1,x,y\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
  await page.keyboard.press('Control+y');await expect.poll(()=>raw(page)).toBe('a,b\n1,x,z,q\n');expect(await page.evaluate(()=>window.__mdSplit.model().csvView.columnWidths[0])).toBe(240);
});
