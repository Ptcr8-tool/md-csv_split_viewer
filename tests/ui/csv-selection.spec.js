import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => { if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})); });
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit?.openDocument);
  await page.evaluate(() => {
    const text='Name,Details\nAlice,"line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight"\nBob,Hello\n';
    window.__mdSplit.openDocument({name:'selection.csv',path:'C:\\synthetic\\selection.csv',text,savedText:text,encoding:'utf8',hasBom:false});
  });
});
const cell=(page,row,column)=>page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${column}"]`);

test('corner and Ctrl+A select the whole grid without changing the document',async({page})=>{
  await page.locator('#text-preview [data-select-all]').click();
  await expect(cell(page,1,0)).toHaveClass(/csv-selected/);
  await expect(cell(page,2,1)).toHaveClass(/csv-selected/);
  await cell(page,1,0).click();
  await expect(cell(page,2,1)).not.toHaveClass(/csv-selected/);
  await page.keyboard.press('Control+a');
  await expect(cell(page,1,0)).toHaveClass(/csv-selected/);
  await expect(cell(page,2,1)).toHaveClass(/csv-selected/);
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('Ctrl+A while editing selects text inside the cell instead of the table',async({page})=>{
  await cell(page,2,1).dblclick();
  const input=page.locator('#text-preview textarea');await expect(input).toBeVisible();
  await page.keyboard.press('Control+a');
  expect(await input.evaluate(n=>n.value.slice(n.selectionStart,n.selectionEnd))).toBe('Hello');
  await page.keyboard.insertText('Changed');
  await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toContain('Bob,Changed');
});

test('clicking the bottom of a tall row-number gutter selects that row',async({page})=>{
  const gutter=page.locator('#text-preview tbody tr[data-grid-row="1"] .text-preview-row-number');
  const box=await gutter.boundingBox();expect(box.height).toBeGreaterThan(100);
  await page.mouse.click(box.x+box.width/2,box.y+box.height-20);
  await expect(cell(page,1,0)).toHaveClass(/csv-selected/);
  await expect(cell(page,1,1)).toHaveClass(/csv-selected/);
  await expect(cell(page,2,0)).not.toHaveClass(/csv-selected/);
});
