import {test, expect} from '@playwright/test';

const source = 'Name,Value,Note\nAlice,Hello,first\nBob,World,second\nCarol,Third,last';
const cell = (page, row, column) => page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${column}"]`);
const text = page => page.evaluate(() => window.__mdSplit.getText());

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('mdsplit.settings', JSON.stringify({welcomeShown:true})); });
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit?.openDocument);
  await page.evaluate(value => window.__mdSplit.openDocument({name:'direct.csv',path:'C:\\synthetic\\direct.csv',text:value,savedText:value,encoding:'utf8',hasBom:false}), source);
});

test('typing on a selected cell replaces its value, without changing surrounding cells', async ({page}) => {
  await cell(page, 1, 1).click();
  await page.keyboard.type('x');
  const editor = cell(page, 1, 1).locator('textarea');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('x');
  await editor.press('Tab');
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,x,first'));
});

for (const key of ['Delete', 'Backspace']) {
  test(`${key} clears the selected cell only`, async ({page}) => {
    await cell(page, 1, 1).click();
    await page.keyboard.press(key);
    await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,,first'));
    await expect(cell(page, 1, 0)).toContainText('Alice');
    await expect(cell(page, 2, 1)).toContainText('World');
  });
}

test('drag selects exactly a rectangular grid range and does not select page text', async ({page}) => {
  const start = await cell(page, 1, 0).locator('.csv-cell-content').boundingBox();
  const end = await cell(page, 2, 1).locator('.csv-cell-content').boundingBox();
  expect(start).toBeTruthy(); expect(end).toBeTruthy();
  await page.mouse.move(start.x + 3, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 3, end.y + end.height / 2, {steps: 12});
  await page.mouse.up();
  for (const [row, column] of [[1,0], [1,1], [2,0], [2,1]]) await expect(cell(page, row, column)).toHaveClass(/csv-selected/);
  for (const [row, column] of [[1,2], [2,2], [3,0], [3,1]]) await expect(cell(page, row, column)).not.toHaveClass(/csv-selected/);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  expect(await text(page)).toBe(source);
  expect(await page.evaluate(() => window.__mdSplit.model().dirty)).toBe(false);
});

test('cell editing still permits selecting and replacing part of its text', async ({page}) => {
  await cell(page, 1, 1).dblclick();
  const editor = cell(page, 1, 1).locator('textarea');
  await expect(editor).toBeFocused();
  await editor.press('Home');
  await editor.press('Shift+ArrowRight');
  await editor.press('Shift+ArrowRight');
  expect(await editor.evaluate(n => n.value.slice(n.selectionStart, n.selectionEnd))).toBe('He');
  await page.keyboard.insertText('Ye');
  await expect(editor).toHaveValue('Yello');
  await editor.press('Tab');
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,Yello,first'));
});

test('composition within an editor is committed once and Enter during composition does not move', async ({page}) => {
  await cell(page, 1, 1).dblclick();
  const editor = cell(page, 1, 1).locator('textarea');
  await expect(editor).toBeFocused();
  await editor.evaluate(n => {
    n.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true, data:''}));
    n.value = '日本';
    n.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertCompositionText', data:'日本', isComposing:true}));
    n.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true, cancelable:true, key:'Enter', isComposing:true}));
  });
  await expect(editor).toBeFocused();
  expect(await text(page)).toBe(source);
  await editor.evaluate(n => n.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data:'日本'})));
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,日本,first'));
  await editor.press('Tab');
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,日本,first'));
});
