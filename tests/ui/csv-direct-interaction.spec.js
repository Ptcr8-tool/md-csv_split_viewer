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

for (const [name, fromRow, toRow] of [['down', 1, 3], ['up', 3, 1]]) {
  test(`vertical drag ${name} selects one column without highlighting other columns or page text`, async ({page}) => {
    const from = await cell(page, fromRow, 1).locator('.csv-cell-content').boundingBox();
    const to = await cell(page, toRow, 1).locator('.csv-cell-content').boundingBox();
    expect(from).toBeTruthy(); expect(to).toBeTruthy();
    await page.mouse.move(from.x + 5, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 5, to.y + to.height / 2, {steps:12});
    await page.mouse.up();
    for (const row of [1, 2, 3]) {
      await expect(cell(page, row, 1)).toHaveClass(/csv-selected/);
      await expect(cell(page, row, 0)).not.toHaveClass(/csv-selected/);
      await expect(cell(page, row, 2)).not.toHaveClass(/csv-selected/);
    }
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    expect(await text(page)).toBe(source);
    expect(await page.evaluate(() => window.__mdSplit.model().dirty)).toBe(false);
  });
}

test('Escape cancels typing that began from a selected cell', async ({page}) => {
  await cell(page, 1, 1).click();
  await page.keyboard.type('x');
  const editor = cell(page, 1, 1).locator('textarea');
  await expect(editor).toHaveValue('x');
  await editor.press('Escape');
  await expect(cell(page, 1, 1).locator('textarea')).toHaveCount(0);
  await expect.poll(() => text(page)).toBe(source);
  await expect(cell(page, 1, 1)).toContainText('Hello');
});

test('simulated IME start on a selected cell opens the editor and commits composed text', async ({page}) => {
  await cell(page, 1, 1).click();
  await cell(page, 1, 1).evaluate(n => n.dispatchEvent(new KeyboardEvent('keydown', {key:'Process', bubbles:true, cancelable:true})));
  const editor = cell(page, 1, 1).locator('textarea');
  await expect(editor).toBeFocused();
  expect(await editor.evaluate(n => n.value.slice(n.selectionStart,n.selectionEnd))).toBe('Hello');
  await editor.evaluate(n => {
    n.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true, data:''}));
    n.value = '\u65e5\u672c';
    n.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertCompositionText', data:'\u65e5\u672c', isComposing:true}));
  });
  expect(await text(page)).toBe(source);
  await editor.evaluate(n => n.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data:'\u65e5\u672c'})));
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,\u65e5\u672c,first'));
});

test('clicking another cell while editing commits the first and lets typing replace the second', async ({page}) => {
  await cell(page, 1, 1).dblclick();
  const editor = cell(page, 1, 1).locator('textarea');
  await editor.fill('edited');
  await cell(page, 2, 1).click();
  await page.keyboard.type('z');
  const nextEditor = cell(page, 2, 1).locator('textarea');
  await expect(nextEditor).toBeFocused();
  await expect(nextEditor).toHaveValue('z');
  await nextEditor.press('Tab');
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,edited,first').replace('Bob,World,second', 'Bob,z,second'));
});

test('after editing, dragging another range selects it and copy returns those cells', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await cell(page, 1, 1).dblclick();
  await cell(page, 1, 1).locator('textarea').fill('edited');
  const from = await cell(page, 2, 1).locator('.csv-cell-content').boundingBox();
  const to = await cell(page, 3, 1).locator('.csv-cell-content').boundingBox();
  expect(from).toBeTruthy(); expect(to).toBeTruthy();
  await page.mouse.move(from.x + 5, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 5, to.y + to.height / 2, {steps:10});
  await page.mouse.up();
  await expect(cell(page, 2, 1)).toHaveClass(/csv-selected/);
  await expect(cell(page, 3, 1)).toHaveClass(/csv-selected/);
  await expect(cell(page, 2, 0)).not.toHaveClass(/csv-selected/);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then(t => t.replace(/\r\n/g, '\n')))).toBe('World\nThird');
  expect(await text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,edited,first'));
});

test('after undo, direct typing into a selected cell still replaces its value', async ({page}) => {
  await cell(page, 1, 1).click();
  await page.keyboard.type('x');
  await cell(page, 2, 1).click();
  await expect.poll(() => text(page)).toBe(source.replace('Alice,Hello,first', 'Alice,x,first'));
  await page.keyboard.press('Control+z');
  await expect.poll(() => text(page)).toBe(source);
  // The previously selected cell must retain focus after undo: no extra click.
  await expect(cell(page, 2, 1)).toBeFocused();
  await page.keyboard.type('y');
  const editor = cell(page, 2, 1).locator('textarea');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('y');
  await editor.press('Tab');
  await expect.poll(() => text(page)).toBe(source.replace('Bob,World,second', 'Bob,y,second'));
});

test('dragging at the bottom edge scrolls a long CSV and extends the selected column', async ({page}) => {
  const longCsv = ['A,B,C', ...Array.from({length:80}, (_, i) => `row${i + 1},value${i + 1},note${i + 1}`)].join('\n');
  await page.evaluate(value => window.__mdSplit.openDocument({name:'long.csv',path:'C:\\synthetic\\long.csv',text:value,savedText:value,encoding:'utf8',hasBom:false}), longCsv);
  const scroller = page.locator('#text-preview .text-preview-scroll');
  const bounds = await scroller.boundingBox();
  const start = await cell(page, 1, 1).locator('.csv-cell-content').boundingBox();
  expect(bounds).toBeTruthy(); expect(start).toBeTruthy();
  const initialLastVisibleRow = await scroller.evaluate(n => {
    const box = n.getBoundingClientRect();
    return Math.max(...[...n.querySelectorAll('[data-cell-row][data-cell-column="1"]')]
      .filter(c => {const r = c.getBoundingClientRect(); return r.bottom <= box.bottom && r.top >= box.top;})
      .map(c => Number(c.dataset.cellRow)));
  });
  await page.mouse.move(start.x + 5, start.y + start.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + 5, bounds.y + bounds.height - 2, {steps:12});
    await expect.poll(() => scroller.evaluate(n => n.scrollTop)).toBeGreaterThan(100);
    await expect.poll(() => scroller.evaluate(n => Math.max(0, ...[...n.querySelectorAll('[data-cell-column="1"].csv-selected')].map(c => Number(c.dataset.cellRow))))).toBeGreaterThan(initialLastVisibleRow);
  } finally {
    await page.mouse.up();
  }
  expect(await scroller.locator('[data-cell-column="0"].csv-selected, [data-cell-column="2"].csv-selected').count()).toBe(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  expect(await text(page)).toBe(longCsv);
  expect(await page.evaluate(() => window.__mdSplit.model().dirty)).toBe(false);
});
