import {test,expect} from '@playwright/test';

async function open(page,name,text){
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  await page.evaluate(({name,text})=>window.__mdSplit.openDocument({name,text,savedText:text,encoding:'utf8',hasBom:false}),{name,text});
}
const raw=page=>page.evaluate(()=>window.__mdSplit.getText());
test('mixed line endings can be converted and undone without changing other endings',async({page})=>{
  const original='one\r\ntwo\nthree\rfour';await open(page,'mixed.txt',original);
  await page.locator('#line-endings').click();
  await expect(page.locator('#line-ending-counts')).toContainText('CRLF: 1件 / LF: 1件 / CR: 1件');
  await page.locator('#line-ending-from').selectOption('CRLF');await page.locator('#line-ending-to').selectOption('LF');
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect.poll(()=>raw(page)).toBe('one\ntwo\nthree\rfour');
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe(original);
  await page.keyboard.press('Control+y');await expect.poll(()=>raw(page)).toBe('one\ntwo\nthree\rfour');
});
test('deleting one kind explains that lines join and cancel preserves the original',async({page})=>{
  const original='a\r\nb\nc\rd';await open(page,'notes.txt',original);
  await page.locator('#line-endings').click();await page.locator('#line-ending-from').selectOption('CR');await page.locator('#line-ending-to').selectOption('remove');
  await expect(page.locator('#line-ending-summary')).toContainText('行をつなぎます');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();expect(await raw(page)).toBe(original);
  await page.locator('#line-endings').click();await page.locator('#line-ending-from').selectOption('CR');await page.locator('#line-ending-to').selectOption('remove');
  await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>raw(page)).toBe('a\r\nb\ncd');
  await page.keyboard.press('Control+z');await expect.poll(()=>raw(page)).toBe(original);
});
