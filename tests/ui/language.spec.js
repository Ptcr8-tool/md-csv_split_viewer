import {test,expect} from '@playwright/test';

test('language follows system locale, persists a manual choice and does not alter document text',async({browser})=>{
  const context=await browser.newContext({locale:'fr-FR'});
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:4175/');await page.waitForFunction(()=>window.__mdSplit);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('.session-menu summary').first()).toHaveText('File');
  await page.evaluate(()=>window.__mdSplit.setText('ファイル\n保存\n設定'));
  await page.locator('[data-cmd="settings"]').click();
  await expect(page.locator('#setting-language')).toHaveValue('en');
  await page.locator('#setting-language').selectOption('ja');
  await page.locator('#modal button[value="ok"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await expect(page.locator('.session-menu summary').first()).toHaveText('ファイル');
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe('ファイル\n保存\n設定');
  await page.reload();await page.waitForFunction(()=>window.__mdSplit);
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await context.close();
});
