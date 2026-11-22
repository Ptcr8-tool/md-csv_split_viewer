import { test, expect } from '@playwright/test';

const text = ['Name,Value', ...Array.from({ length: 230 }, (_, index) => `row${index + 1},value`)].join('\n');
const rows = page => page.locator('#text-preview tbody tr');
const cell = (page, row) => page.locator(`#text-preview [data-cell-row="${row}"][data-cell-column="0"]`);
const range = page => page.locator('#text-preview .text-preview-pagination');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mdsplit.settings', JSON.stringify({ welcomeShown: true })));
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit?.openDocument);
  await page.evaluate(text => window.__mdSplit.openDocument({ name: 'paging.csv', text, encoding: 'utf8', hasBom: false }), text);
  await expect(rows(page)).toHaveCount(100);
  await expect(range(page)).toContainText('表示行 1–100 / 230');
});

function visibleRow(scroller, scrollToBottom) {
  if (scrollToBottom) scroller.scrollTop = scroller.scrollHeight;
  const header = scroller.querySelector('thead');
  const top = scroller.getBoundingClientRect().top + header.getBoundingClientRect().height + 1;
  const row = [...scroller.querySelectorAll('tbody tr')].find(row => row.getBoundingClientRect().bottom > top);
  return { index: Number(row.dataset.gridRow), offset: row.getBoundingClientRect().top - top };
}

test('scrolling to the bottom loads one overlapping set of rows and preserves the viewport and selection', async ({ page }) => {
  const scroller = page.locator('#text-preview .text-preview-scroll');
  const selected = cell(page, 70);
  await selected.click();
  await expect(selected).toHaveClass(/csv-selected/);
  const anchor = await scroller.evaluate(visibleRow, true);
  expect(anchor.index).toBeGreaterThan(50);

  await expect(range(page)).toContainText('表示行 51–150 / 230');
  await expect(rows(page)).toHaveCount(100);
  const restored = await scroller.evaluate(visibleRow, false);
  expect(restored.index).toBe(anchor.index);
  expect(Math.abs(restored.offset - anchor.offset)).toBeLessThanOrEqual(1);
  await expect(selected).toHaveClass(/csv-selected/);
  await expect(selected).toBeFocused();
  expect(await scroller.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeGreaterThan(1);

  await range(page).getByRole('button', { name: '前の行', exact: true }).click();
  await expect(range(page)).toContainText('表示行 1–100 / 230');
  await expect(selected).toHaveClass(/csv-selected/);
  expect(await page.evaluate(() => window.__mdSplit.getText())).toBe(text);
});

test('changing the displayed row count also changes manual paging and keyboard navigation', async ({ page }) => {
  await page.getByRole('button', { name: '表示設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'CSVの表示設定', exact: true });
  await dialog.locator('#csv-page-rows').fill('40');
  await dialog.getByRole('button', { name: '適用', exact: true }).click();
  await expect(rows(page)).toHaveCount(40);
  await expect(range(page)).toContainText('表示行 1–40 / 230');

  await range(page).getByRole('button', { name: '次の行', exact: true }).click();
  await expect(range(page)).toContainText('表示行 21–60 / 230');
  await range(page).getByRole('button', { name: '前の行', exact: true }).click();
  await expect(range(page)).toContainText('表示行 1–40 / 230');

  await cell(page, 40).evaluate(node => node.focus({ preventScroll: true }));
  await page.keyboard.press('ArrowDown');
  await expect(range(page)).toContainText('表示行 21–60 / 230');
  await expect(cell(page, 41)).toBeFocused();
  await expect(cell(page, 41)).toHaveClass(/csv-selected/);
  expect(await page.evaluate(() => window.__mdSplit.getText())).toBe(text);
});
