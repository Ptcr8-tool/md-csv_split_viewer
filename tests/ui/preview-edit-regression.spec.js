import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);});
const setText=(page,text)=>page.evaluate(text=>window.__mdSplit.setText(text),text);
const getText=page=>page.evaluate(()=>window.__mdSplit.getText());
const select=(page,at)=>page.evaluate(at=>window.__mdSplit.renderer.restoreSelection(at),at);

test('typing at the end keeps the space, caret and next character in order',async({page})=>{
  await setText(page,'abc');await select(page,3);await page.keyboard.press('Space');await page.keyboard.insertText('x');
  expect(await getText(page)).toBe('abc x');await expect(page.locator('#preview')).toContainText('abc x');
  expect(await page.evaluate(()=>window.__mdSplit.renderer.selection())).toEqual({from:5,to:5});
  await page.keyboard.press('Control+z');expect(await getText(page)).toBe('abc');
});

test('typing after bold preserves the formatting and keeps the space',async({page})=>{
  await setText(page,'**abc**');await select(page,5);await page.keyboard.press('Space');await page.keyboard.insertText('x');
  expect(await getText(page)).toBe('**abc** x');await expect(page.locator('#preview strong')).toHaveText('abc');await expect(page.locator('#preview')).toContainText('abc x');
});

test('Enter splits a quote at the caret without ending the quote',async({page})=>{
  await setText(page,'> abcd');await select(page,4);await page.keyboard.press('Enter');await page.keyboard.insertText('X');
  expect(await getText(page)).toBe('> ab\n> Xcd');await expect(page.locator('#preview blockquote')).toHaveCount(1);
});

test('Shift+Enter creates a hard break and retains quote prefixes and CRLF',async({page})=>{
  await setText(page,'> abcd\r\n\r\n後');await select(page,4);await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('X');
  expect(await getText(page)).toBe('> ab  \r\n> Xcd\r\n\r\n後');await expect(page.locator('#preview blockquote br')).toHaveCount(1);
});
