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

test('a nested quote keeps the insertion point after its entire prefix',async({page})=>{
  await setText(page,'> > > abcd');await select(page,8);await page.keyboard.press('Enter');await page.keyboard.insertText('X');
  expect(await getText(page)).toBe('> > > ab\n> > > Xcd');
});

test('repeated Enter at the end of a quote keeps an editable quoted line',async({page})=>{
  await setText(page,'> abc');await select(page,5);await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.insertText('X');
  expect(await getText(page)).toBe('> abc\n> \n> X');await expect(page.locator('#preview blockquote')).toContainText('X');
});

test('space before and inside bold retains the text and order',async({page})=>{
  await setText(page,'**abc**');await select(page,2);await page.keyboard.press('Space');await page.keyboard.insertText('x');expect(await getText(page)).toBe(' x**abc**');
  await setText(page,'**abcd**');await select(page,4);await page.keyboard.press('Space');await page.keyboard.insertText('x');expect(await getText(page)).toBe('**ab xcd**');
});

test('spaces remain distinct when soft-break display is disabled',async({page})=>{
  await page.getByRole('button',{name:'設定',exact:true}).click();await page.locator('#setting-soft-breaks').uncheck();await page.getByRole('button',{name:'適用',exact:true}).click();
  await setText(page,'a   b\nc');
  const result=await page.evaluate(()=>{
    const preview=document.querySelector('#preview');
    const leaf=window.__mdSplit.renderer.leaves.find(l=>l.node.data==='   ');
    const width=(start,end)=>{const range=document.createRange();range.setStart(leaf.node,start);range.setEnd(leaf.node,end);return range.getBoundingClientRect().width;};
    const y=(node,start,end)=>{const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);return range.getBoundingClientRect().top;};
    const b=window.__mdSplit.renderer.leaves.find(l=>l.node.data.includes('b')),c=window.__mdSplit.renderer.leaves.find(l=>l.node.data.includes('c'));
    return {preserving:preview.classList.contains('preserve-lines'),single:width(0,1),triple:width(0,3),bTop:y(b.node,b.node.data.indexOf('b'),b.node.data.indexOf('b')+1),cTop:y(c.node,c.node.data.indexOf('c'),c.node.data.indexOf('c')+1),source:window.__mdSplit.getText()};
  });
  expect(result.preserving).toBe(false);expect(result.triple).toBeGreaterThan(result.single*2.5);expect(result.cTop).toBeCloseTo(result.bTop,0);expect(result.source).toBe('a   b\nc');
  await select(page,4);await page.keyboard.insertText('X');expect(await getText(page)).toBe('a   Xb\nc');
});
