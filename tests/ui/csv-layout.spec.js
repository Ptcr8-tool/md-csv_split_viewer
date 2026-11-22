import {test, expect} from '@playwright/test';

const fixture = {
  name: 'layout.csv',
  path: 'C:\\synthetic\\layout.csv',
  encoding: 'utf8',
  hasBom: false,
};
const row = (page, index) => page.locator(`#text-preview tr[data-grid-row="${index}"]`);
const number = (page, index) => row(page, index).locator('[data-select-row]');
const cell = (page, index, column) => row(page, index).locator(`[data-cell-column="${column}"]`);
const height = async locator => Math.round((await locator.boundingBox())?.height ?? 0);

async function openCsv(page, text) {
  await page.evaluate(document => window.__mdSplit.openDocument(document), {...fixture, text, savedText: text});
  await expect(row(page, 1)).toBeVisible();
}

async function chooseContextItem(page, target, name) {
  await target.click({button: 'right'});
  await page.getByRole('menuitem', {name, exact: true}).click();
}

async function applyHeight(page, selectedRow, pixels) {
  await chooseContextItem(page, number(page, selectedRow), '行の高さを指定');
  const dialog = page.getByRole('dialog', {name: '行の高さを指定', exact: true});
  await dialog.locator('#csv-selected-row-height').fill(String(pixels));
  await dialog.getByRole('button', {name: '適用', exact: true}).click();
  await expect(dialog).toBeHidden();
}

async function assertClean(page, text) {
  expect(await page.evaluate(() => window.__mdSplit.getText())).toBe(text);
  expect(await page.evaluate(() => window.__mdSplit.model().dirty)).toBe(false);
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('mdsplit.settings', JSON.stringify({welcomeShown: true, language: 'ja'}));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit?.openDocument);
});

test('row menu sets multiple heights and supports automatic height and the document default', async ({page}) => {
  const text = 'Name,Note\nAlice,First\nBob,Second\nCarol,Third';
  await openCsv(page, text);

  await page.getByRole('button', {name: '表示設定', exact: true}).click();
  const settings = page.getByRole('dialog', {name: 'CSVの表示設定', exact: true});
  await settings.locator('#csv-row-height').fill('85');
  await settings.getByRole('button', {name: '適用', exact: true}).click();
  await expect.poll(() => height(row(page, 2))).toBe(85);

  await number(page, 1).click();
  await number(page, 3).click({modifiers: ['Control']});
  await applyHeight(page, 1, 42);
  await expect.poll(async () => Promise.all([1, 2, 3].map(index => height(row(page, index))))).toEqual([42, 85, 42]);

  await chooseContextItem(page, number(page, 1), '行の高さを自動調整');
  await expect.poll(() => height(row(page, 1))).toBeLessThan(85);
  await expect.poll(() => height(row(page, 3))).toBeLessThan(85);

  await chooseContextItem(page, number(page, 1), '行の高さを既定に戻す');
  await expect.poll(async () => Promise.all([1, 3].map(index => height(row(page, index))))).toEqual([85, 85]);
  await assertClean(page, text);
});

test('a header with multiline content can be resized to exactly 20 px', async ({page}) => {
  const text = '"Name\nHeading",Note\nAlice,First';
  await openCsv(page, text);

  await number(page, 0).click();
  await applyHeight(page, 0, 20);
  await expect.poll(() => height(row(page, 0))).toBe(20);
  await number(page, 0).click();
  await expect(number(page, 0)).toHaveClass(/csv-selected/);
  await expect(cell(page, 0, 0)).toContainText('Name');
  await expect(cell(page, 0, 0)).toContainText('Heading');
  await assertClean(page, text);
});

test('folding and expanding a multiline cell only changes its own display', async ({page}) => {
  const multiline = Array.from({length: 13}, (_, index) => `Line ${index + 1}`).join('\n');
  const text = `Name,Note,Other\nAlice,"${multiline}","Unchanged\nSecond line"\nBob,Next,Last`;
  await openCsv(page, text);
  const target = cell(page, 1, 1);
  const sibling = cell(page, 1, 2);
  const fullHeight = await height(row(page, 1));

  await chooseContextItem(page, target, '折りたたむ');
  await expect(target).toHaveClass(/csv-cell-folded/);
  await expect(sibling).not.toHaveClass(/csv-cell-folded|csv-cell-expanded/);
  await expect.poll(() => height(row(page, 1))).toBeLessThan(fullHeight);

  await chooseContextItem(page, target, '折りたたまない');
  await expect(target).toHaveClass(/csv-cell-expanded/);
  await expect.poll(() => height(row(page, 1))).toBe(fullHeight);

  await chooseContextItem(page, target, '折りたたみを既定に戻す');
  await expect(target).not.toHaveClass(/csv-cell-folded|csv-cell-expanded/);
  await assertClean(page, text);
});
