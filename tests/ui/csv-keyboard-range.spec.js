import {test, expect} from '@playwright/test';

const source = 'Name,Value,Note\r\nAlice,"Hello, world",first\r\nBob,World,second\r\nCarol,Third,last\r\n';
const cell = (page, row, column) => page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="${column}"]`);
const raw = page => page.evaluate(() => window.__mdSplit.getText());

async function drag(page, rowA, colA, rowB, colB) {
  const a = await cell(page, rowA, colA).locator('.csv-cell-content').boundingBox();
  const b = await cell(page, rowB, colB).locator('.csv-cell-content').boundingBox();
  expect(a).toBeTruthy(); expect(b).toBeTruthy();
  await page.mouse.move(a.x + 4, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 4, b.y + b.height / 2, {steps: 8});
  await page.mouse.up();
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('mdsplit.settings', JSON.stringify({welcomeShown: true})); });
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit?.openDocument);
  await page.evaluate(value => window.__mdSplit.openDocument({name:'keyboard.csv',path:'C:\\synthetic\\keyboard.csv',text:value,savedText:value,encoding:'utf8',hasBom:false}), source);
});

test('arrow keys move the selected cell up, down, left and right without modifying CSV', async ({page}) => {
  await cell(page, 2, 1).click();
  for (const [key, row, col] of [['ArrowUp', 1, 1], ['ArrowRight', 1, 2], ['ArrowDown', 2, 2], ['ArrowLeft', 2, 1]]) {
    await page.keyboard.press(key);
    await expect(cell(page, row, col)).toBeFocused();
    await expect(cell(page, row, col)).toHaveClass(/csv-selected/);
    await expect(page.locator('#text-preview [data-cell-row][data-cell-column].csv-selected')).toHaveCount(1);
  }
  expect(await raw(page)).toBe(source);
  expect(await page.evaluate(() => window.__mdSplit.model().dirty)).toBe(false);
});

test('arrow navigation stops at the table edges', async ({page}) => {
  await cell(page, 3, 2).click();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 3, 2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 3, 2)).toBeFocused();
  await cell(page, 1, 0).click();
  await page.keyboard.press('ArrowLeft');
  await expect(cell(page, 1, 0)).toBeFocused();
  expect(await raw(page)).toBe(source);
});

test('arrow navigation skips hidden rows and columns', async ({page}) => {
  const hide = page.getByRole('button', {name:'\u9078\u629e\u3092\u975e\u8868\u793a', exact:true});
  await page.locator('#text-preview [data-select-row="2"]').click();
  await hide.click();
  await expect(cell(page, 2, 0)).toHaveCount(0);
  await page.locator('#text-preview thead [data-select-column="1"]').click();
  await hide.click();
  await expect(cell(page, 1, 1)).toHaveCount(0);
  await cell(page, 1, 0).click();
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 3, 0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 3, 2)).toBeFocused();
  expect(await raw(page)).toBe(source);
});

test('arrow keys and Backspace edit text inside an open cell instead of navigating the grid', async ({page}) => {
  await cell(page, 2, 1).dblclick();
  const editor = cell(page, 2, 1).locator('textarea');
  await expect(editor).toBeFocused();
  await editor.evaluate(n => n.setSelectionRange(n.value.length, n.value.length));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveValue('Word');
  await expect(editor).toBeFocused();
  await editor.press('Tab');
  await expect.poll(() => raw(page)).toContain('Bob,Word,second');
});

for (const key of ['Delete', 'Backspace']) {
  test(`${key} clears only a dragged vertical selection and undo restores exact source`, async ({page}) => {
    await drag(page, 1, 1, 2, 1);
    await expect(cell(page, 1, 1)).toHaveClass(/csv-selected/);
    await expect(cell(page, 2, 1)).toHaveClass(/csv-selected/);
    await page.keyboard.press(key);
    await expect.poll(() => cell(page, 1, 1).locator('.csv-cell-content').textContent()).toBe('');
    await expect(cell(page, 2, 1).locator('.csv-cell-content')).toHaveText('');
    await expect(cell(page, 1, 0)).toContainText('Alice');
    await expect(cell(page, 1, 2)).toContainText('first');
    await expect(cell(page, 2, 0)).toContainText('Bob');
    await expect(cell(page, 2, 2)).toContainText('second');
    await expect(cell(page, 3, 1)).toContainText('Third');
    const changed = await raw(page);
    expect(changed).toContain('Carol,Third,last\r\n');
    expect(changed).not.toContain('Hello, world');
    expect(changed).not.toContain('Bob,World');
    await page.keyboard.press('Control+z');
    await expect.poll(() => raw(page)).toBe(source);
  });
}

test('Delete clears a dragged rectangle without touching its adjacent cells', async ({page}) => {
  await drag(page, 1, 0, 2, 1);
  await page.keyboard.press('Delete');
  for (const [row, col] of [[1,0], [1,1], [2,0], [2,1]])
    await expect(cell(page, row, col).locator('.csv-cell-content')).toHaveText('');
  await expect(cell(page, 1, 2)).toContainText('first');
  await expect(cell(page, 2, 2)).toContainText('second');
  await expect(cell(page, 3, 0)).toContainText('Carol');
  await page.keyboard.press('Control+z');
  await expect.poll(() => raw(page)).toBe(source);
});

test('Shift and arrow keys extend a selected range without modifying data', async ({page}) => {
  await cell(page, 1, 0).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  for (const [row, col] of [[1,0], [1,1], [2,0], [2,1]])
    await expect(cell(page, row, col)).toHaveClass(/csv-selected/);
  await expect(cell(page, 1, 2)).not.toHaveClass(/csv-selected/);
  await expect(cell(page, 3, 0)).not.toHaveClass(/csv-selected/);
  expect(await raw(page)).toBe(source);
});

test('Delete on nonadjacent selected cells does not clear cells between them', async ({page}) => {
  await cell(page, 1, 1).click();
  await cell(page, 3, 1).click({modifiers:['Control']});
  await expect(cell(page, 1, 1)).toHaveClass(/csv-selected/);
  await expect(cell(page, 3, 1)).toHaveClass(/csv-selected/);
  await expect(cell(page, 2, 1)).not.toHaveClass(/csv-selected/);
  await page.keyboard.press('Delete');
  await expect(cell(page, 1, 1).locator('.csv-cell-content')).toHaveText('');
  await expect(cell(page, 3, 1).locator('.csv-cell-content')).toHaveText('');
  await expect(cell(page, 2, 1)).toContainText('World');
  await page.keyboard.press('Control+z');
  await expect.poll(() => raw(page)).toBe(source);
});

test('clearing a range containing a missing field does not invent extra delimiters', async ({page}) => {
  const ragged='A,B,C\r\nalpha,beta\r\ngamma,delta,epsilon\r\n';
  await page.evaluate(value => window.__mdSplit.openDocument({name:'ragged.csv',path:'C:\\synthetic\\ragged.csv',text:value,savedText:value,encoding:'utf8',hasBom:false}), ragged);
  await drag(page, 1, 2, 2, 2);
  await page.keyboard.press('Delete');
  await expect.poll(() => raw(page)).toBe('A,B,C\r\nalpha,beta\r\ngamma,delta,\r\n');
  await page.keyboard.press('Control+z');
  await expect.poll(() => raw(page)).toBe(ragged);
});

test('clearing a drag across a hidden row leaves its original data intact', async ({page}) => {
  await page.locator('#text-preview [data-select-row="2"]').click();
  await page.getByRole('button', {name:'\u9078\u629e\u3092\u975e\u8868\u793a', exact:true}).click();
  await expect(cell(page, 2, 1)).toHaveCount(0);
  await drag(page, 1, 1, 3, 1);
  await page.keyboard.press('Delete');
  await expect(cell(page, 1, 1).locator('.csv-cell-content')).toHaveText('');
  await expect(cell(page, 3, 1).locator('.csv-cell-content')).toHaveText('');
  expect(await raw(page)).toContain('Bob,World,second\r\n');
  await page.keyboard.press('Control+z');
  await expect.poll(() => raw(page)).toBe(source);
});
