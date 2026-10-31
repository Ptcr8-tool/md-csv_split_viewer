import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const ready = page => page.waitForFunction(() => window.__mdSplit?.openDocument);
const rawText = page => page.evaluate(() => window.__mdSplit.getText());
const openCsv = (page, text='Name,Value,Note\r\nAlice,1,first\r\nBob,2,second\r\nCarol,3,last\r\n') => page.evaluate(text => {
  window.__mdSplit.openDocument({name:'grid.csv',path:'C:\\synthetic\\grid.csv',text,savedText:text,encoding:'utf8',hasBom:false});
}, text);
const cell = (page,row,column) => page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${column}"]`);
const rowSelector = (page,index) => page.locator(`#text-preview [data-select-row="${index}"]`);
const columnSelector = (page,index) => page.locator(`#text-preview thead [data-select-column="${index}"]`);
async function settings(page,values={}) {
  await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定',exact:true});await expect(dialog).toBeVisible();
  for(const [id,value] of Object.entries(values)) {
    const field=dialog.locator('#'+id);
    if(await field.evaluate(node=>node.tagName==='SELECT'))await field.selectOption(String(value));else await field.fill(String(value));
  }
  await dialog.getByRole('button',{name:'適用',exact:true}).click();await expect(dialog).toBeHidden();
}
async function confirmDelete(page) {
  await page.getByRole('button',{name:'行・列を削除',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'選択した行・列を削除',exact:true});
  await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'削除',exact:true}).click();await expect(dialog).toBeHidden();
}
async function dragHandle(page,handle,dx,dy) {
  await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();expect(box).toBeTruthy();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));
  });
  await page.goto('/');
  await ready(page);
});

for(const target of ['header','.tabbar','#text-preview']) {
  test(`file drop on ${target} opens a clean document and closes without a save prompt`, async ({page}) => {
    await openCsv(page);
    const accepted=await page.locator(target).evaluate(node => {
      const transfer=new DataTransfer();
      transfer.items.add(new File(['Title,Value\r\nUnicode,😀\r\n'],'dropped.csv',{type:'text/csv'}));
      const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer});
      node.dispatchEvent(over);
      const drop=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer});node.dispatchEvent(drop);
      return {dragover:over.defaultPrevented,drop:drop.defaultPrevented};
    });
    expect(accepted).toEqual({dragover:true,drop:true});
    await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('dropped.csv');
    expect(await rawText(page)).toBe('Title,Value\r\nUnicode,😀\r\n');
    expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
    await page.getByRole('button',{name:'dropped.csvを閉じる',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents().some(d=>d.name==='dropped.csv'))).toBe(false);
    expect(await page.locator('#modal').evaluate(node=>node.open)).toBe(false);
  });
}

test('opening an existing browser file stays clean, and editing then undoing restores that state',async({page})=>{
  const text='Name,Value\r\nAlice,1\r\n';
  await page.locator('#file-input').setInputFiles({name:'clean.csv',mimeType:'text/csv',buffer:Buffer.from(text)});
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('clean.csv');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  const source=page.locator('#source .cm-content');await source.click();await page.keyboard.press('Control+End');await page.keyboard.insertText('change');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>rawText(page)).toBe(text);
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('column widths and row heights can be set in pixels and resized by dragging without editing CSV',async({page})=>{
  const text='Name,Value,Note\r\nAlice,1,first\r\nBob,2,second\r\n';await openCsv(page,text);
  await columnSelector(page,0).click();await settings(page,{'csv-column-width':240});
  await expect.poll(async()=>Math.round((await cell(page,1,0).boundingBox())?.width ?? 0)).toBe(240);
  await rowSelector(page,1).click();await settings(page,{'csv-row-height':88});
  await expect.poll(async()=>Math.round((await page.locator('#text-preview tr[data-grid-row="1"]').boundingBox())?.height ?? 0)).toBe(88);
  await dragHandle(page,page.locator('#text-preview [data-resize-column="0"]'),60,0);
  await expect.poll(async()=>Math.round((await cell(page,1,0).boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(295);
  await dragHandle(page,page.locator('#text-preview [data-resize-row="1"]'),0,35);
  await expect.poll(async()=>Math.round((await page.locator('#text-preview tr[data-grid-row="1"]').boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(118);
  await rowSelector(page,1).click();await settings(page,{'csv-row-height':20});
  await expect.poll(async()=>Math.round((await page.locator('#text-preview tr[data-grid-row="1"]').boundingBox())?.height ?? 0)).toBe(20);
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('wrapping and display settings survive tab changes but do not make a document dirty',async({page})=>{
  const text='Name,Note\nAlice,"long words across the cell\nnext line"';await openCsv(page,text);
  await columnSelector(page,1).click();await settings(page,{'csv-column-width':270});
  await page.getByRole('checkbox',{name:'セル内で折り返す',exact:true}).uncheck();
  await expect(cell(page,1,1).locator('.csv-cell-content')).toHaveCSS('white-space','pre');
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'other.txt',path:'C:\\synthetic\\other.txt',text:'other',encoding:'utf8',hasBom:false}));
  await page.locator('.tab-name[title$="grid.csv"]').click();
  await expect(page.getByRole('checkbox',{name:'セル内で折り返す',exact:true})).not.toBeChecked();
  await expect.poll(async()=>Math.round((await cell(page,1,1).boundingBox()).width)).toBe(270);
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  await page.getByRole('button',{name:'grid.csvを閉じる',exact:true}).click();await openCsv(page,text);
  await expect(page.getByRole('checkbox',{name:'セル内で折り返す',exact:true})).toBeChecked();
  await expect.poll(async()=>Math.round((await cell(page,1,1).boundingBox()).width)).toBe(180);
});

test('chosen leading rows and columns remain visible while the table scrolls',async({page})=>{
  const rows=[Array.from({length:12},(_,i)=>'H'+i),...Array.from({length:45},(_,r)=>Array.from({length:12},(_,c)=>`r${r}c${c}`))];
  const text=rows.map(row=>row.join(',')).join('\n');await openCsv(page,text);
  await settings(page,{'csv-column-width':150,'csv-row-height':38,'csv-freeze-rows':3,'csv-freeze-columns':2});
  const fixed=cell(page,1,0);await expect(fixed).toBeVisible();await expect(fixed).toHaveClass(/csv-frozen-row/);await expect(fixed).toHaveClass(/csv-frozen-column/);
  let before;await expect.poll(async()=>{before=await fixed.boundingBox();return !!before;}).toBe(true);
  await page.locator('#text-preview .text-preview-scroll').evaluate(node=>{node.scrollTop=400;node.scrollLeft=350;});
  await expect.poll(async()=>Math.round((await fixed.boundingBox())?.x??NaN)).toBe(Math.round(before.x));
  await expect.poll(async()=>Math.round((await fixed.boundingBox())?.y??NaN)).toBe(Math.round(before.y));
  expect(await rawText(page)).toBe(text);
});

test('nonadjacent rows and columns can be hidden and restored without changing data',async({page})=>{
  const text='Name,Value,Note\nAlice,1,first\nBob,2,second\nCarol,3,last';await openCsv(page,text);
  await rowSelector(page,1).click();await rowSelector(page,3).click({modifiers:['Control']});
  await page.getByRole('button',{name:'選択を非表示',exact:true}).click();
  await expect(rowSelector(page,1)).toHaveCount(0);await expect(rowSelector(page,3)).toHaveCount(0);await expect(cell(page,2,0)).toBeVisible();
  await columnSelector(page,0).click();await columnSelector(page,2).click({modifiers:['Control']});
  await page.getByRole('button',{name:'選択を非表示',exact:true}).click();
  await expect(cell(page,2,0)).toHaveCount(0);await expect(cell(page,2,2)).toHaveCount(0);await expect(cell(page,2,1)).toBeVisible();
  await page.getByRole('button',{name:'非表示をすべて解除',exact:true}).click();
  await expect(rowSelector(page,1)).toBeVisible();await expect(rowSelector(page,3)).toBeVisible();await expect(cell(page,2,0)).toBeVisible();await expect(cell(page,2,2)).toBeVisible();
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('Ctrl and Shift row deletion preserves untouched tokens and can be undone',async({page})=>{
  const text='"Name",Value,Note\r\n"Alice",1,"first"\r\nBob,2,"second"\r\n"Carol",3,last\r\n';await openCsv(page,text);
  await rowSelector(page,1).click();await rowSelector(page,3).click({modifiers:['Control']});await confirmDelete(page);
  await expect.poll(()=>rawText(page)).toBe('"Name",Value,Note\r\nBob,2,"second"\r\n');
  await page.getByRole('button',{name:'元に戻す · Ctrl+Z',exact:true}).click();await expect.poll(()=>rawText(page)).toBe(text);
  await rowSelector(page,1).click();await rowSelector(page,3).click({modifiers:['Shift']});await confirmDelete(page);
  await expect.poll(()=>rawText(page)).toBe('"Name",Value,Note\r\n');
  await page.getByRole('button',{name:'元に戻す · Ctrl+Z',exact:true}).click();await expect.poll(()=>rawText(page)).toBe(text);
});

test('column deletion keeps remaining CSV quoting and line endings intact and can be undone',async({page})=>{
  const text='"A",B,"C",D\r\n"x",1,"z",3\r\n"keep",2,"quoted ""value""",4\r\n';await openCsv(page,text);
  await columnSelector(page,1).click();await columnSelector(page,3).click({modifiers:['Control']});await confirmDelete(page);
  await expect.poll(()=>rawText(page)).toBe('"A","C"\r\n"x","z"\r\n"keep","quoted ""value"""\r\n');
  await page.getByRole('button',{name:'元に戻す · Ctrl+Z',exact:true}).click();await expect.poll(()=>rawText(page)).toBe(text);
  await columnSelector(page,1).click();await columnSelector(page,3).click({modifiers:['Shift']});await confirmDelete(page);
  await expect.poll(()=>rawText(page)).toBe('"A"\r\n"x"\r\n"keep"\r\n');
});

test('cell, row and column alignment change display while viewport alignment follows a tall row',async({page})=>{
  const text='Name,Value,Note\nAlice,1,"'+Array.from({length:140},(_,i)=>'Long line '+i).join('\n')+'"\nBob,2,last';await openCsv(page,text);
  await columnSelector(page,0).click();await settings(page,{'csv-horizontal':'right','csv-vertical':'bottom'});
  await expect(cell(page,2,0)).toHaveCSS('text-align','right');await expect(cell(page,2,0)).toHaveCSS('vertical-align','bottom');
  await rowSelector(page,2).click();await settings(page,{'csv-horizontal':'center','csv-vertical':'middle'});
  await expect(cell(page,2,1)).toHaveCSS('text-align','center');await expect(cell(page,2,1)).toHaveCSS('vertical-align','middle');
  await cell(page,1,0).click();await settings(page,{'csv-horizontal':'left','csv-vertical':'viewport'});
  const content=cell(page,1,0).locator('.csv-cell-content'),scroller=page.locator('#text-preview .text-preview-scroll');
  await scroller.evaluate(node=>{node.scrollTop=400;});
  await expect.poll(async()=>{const a=await content.boundingBox(),b=await scroller.boundingBox();return a.y>=b.y&&a.y+a.height<=b.y+b.height;}).toBe(true);
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('display settings can be saved and loaded as a sidecar without changing CSV or dirty state',async({page})=>{
  const text='Name,Value\r\nAlice,1\r\n';await openCsv(page,text);
  await columnSelector(page,0).click();await settings(page,{'csv-column-width':265,'csv-horizontal':'right'});
  await page.getByRole('checkbox',{name:'セル内で折り返す',exact:true}).uncheck();
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'表示設定を保存',exact:true}).click();
  const download=await waiting;expect(download.suggestedFilename()).toBe('grid.csv.mdsplit-view.json');
  const bytes=await readFile(await download.path()),data=JSON.parse(bytes.toString());
  expect(data.schema).toBe('md-split.csv-view');expect(data.version).toBe(1);expect(data.view.columnWidths['0']).toBe(265);expect(data.view.wrap).toBe(false);expect(data.view.columnAlignment['0'].horizontal).toBe('right');
  expect(bytes.toString()).not.toContain('Alice');
  await columnSelector(page,0).click();await settings(page,{'csv-column-width':180,'csv-horizontal':'left'});
  await page.getByRole('checkbox',{name:'セル内で折り返す',exact:true}).check();
  const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'表示設定を読込',exact:true}).click();
  await (await choosing).setFiles({name:'grid.csv.mdsplit-view.json',mimeType:'application/json',buffer:bytes});
  await expect(page.getByRole('checkbox',{name:'セル内で折り返す',exact:true})).not.toBeChecked();
  await expect.poll(async()=>Math.round((await cell(page,1,0).boundingBox()).width)).toBe(265);
  await expect(cell(page,1,0)).toHaveCSS('text-align','right');
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('an unrelated sidecar file is rejected while current display and CSV content are retained',async({page})=>{
  const text='Name,Value\nAlice,1';await openCsv(page,text);
  await columnSelector(page,0).click();await settings(page,{'csv-column-width':250});
  const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'表示設定を読込',exact:true}).click();
  await (await choosing).setFiles({name:'unrelated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'other',version:1,view:{defaultColumnWidth:900}}))});
  await expect(page.locator('#toast')).toContainText('MD-CSV Split Editorの表示設定ファイルではありません');
  await expect.poll(async()=>Math.round((await cell(page,1,0).boundingBox()).width)).toBe(250);
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('undoing a rapid row deletion keeps the immediately preceding cell edit',async({page})=>{
  const text='Name,Value\r\nAlice,1\r\nBob,2\r\nCarol,3\r\n';await openCsv(page,text);
  await cell(page,1,0).dblclick();await cell(page,1,0).locator('textarea').fill('Alicia');await cell(page,1,0).locator('textarea').press('Enter');
  await rowSelector(page,2).click();await confirmDelete(page);
  await expect.poll(()=>rawText(page)).toBe('Name,Value\r\nAlicia,1\r\nCarol,3\r\n');
  await page.getByRole('button',{name:'元に戻す · Ctrl+Z',exact:true}).click();
  await expect.poll(()=>rawText(page)).toBe(text.replace('Alice','Alicia'));
  await page.getByRole('button',{name:'元に戻す · Ctrl+Z',exact:true}).click();await expect.poll(()=>rawText(page)).toBe(text);
});
