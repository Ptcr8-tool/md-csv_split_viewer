import {test,expect} from '@playwright/test';

test('English editing dialogs keep unsaved text intact when cancelled',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true,language:'en'})));
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit?.editor());
  const original='日本語の内容\r\nsecond line\nthird line';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'sample.md',text,savedText:'',encoding:'utf8',hasBom:false}),original);
  await page.locator('#encoding').click();
  await expect(page.locator('#dialog-title')).toHaveText('Encoding');
  await expect(page.locator('#encoding-action option[value="reopen"]')).toHaveText('Reopen the original file with this encoding');
  await page.locator('#modal [value="cancel"]').first().click();
  await page.locator('#line-endings').click();
  await expect(page.locator('#dialog-title')).toHaveText('Convert line endings');
  await page.locator('#line-ending-to').selectOption('remove');
  await expect(page.locator('#line-ending-summary')).toContainText('join the lines');
  await page.locator('#modal [value="cancel"]').first().click();
  await page.locator('[data-cmd="code"]').click();
  await expect(page.locator('#dialog-title')).toHaveText('Insert code block');
  await expect(page.locator('#dialog-body')).toContainText('Existing code is preserved');
  await page.locator('#modal [value="cancel"]').first().click();
  await page.locator('[data-cmd="print-source"]').click();
  await expect(page.locator('#dialog-title')).toHaveText('Print source / export PDF');
  await expect(page.locator('#dialog-body')).toContainText('Choose paper size');
  await page.locator('#modal [value="cancel"]').first().click();
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(original);
});
