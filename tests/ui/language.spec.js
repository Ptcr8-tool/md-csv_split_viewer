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

test('switching language updates the open CSV toolbar and preserves cell edits',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true,language:'ja'})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  const original='名前,状態\n日本語,作成中';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'sample.csv',text,savedText:text,encoding:'utf8'}),original);
  const toolbar=page.locator('.text-preview-toolbar');
  await expect(toolbar).toContainText('区切り文字');
  await page.locator('[data-cmd="settings"]').click();
  await page.locator('#setting-language').selectOption('en');
  await page.locator('#modal button[value="ok"]').click();
  await expect(toolbar).toContainText('Delimiter');
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(original);
  await page.locator('[data-cell-row="1"][data-cell-column="1"]').dblclick();
  await page.locator('.text-preview-scroll textarea').fill('編集中');
  await page.locator('[data-cmd="settings"]').click();
  await page.locator('#setting-language').selectOption('ja');
  await page.locator('#modal button[value="ok"]').click();
  await expect(toolbar).toContainText('区切り文字');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toContain('編集中');
});
