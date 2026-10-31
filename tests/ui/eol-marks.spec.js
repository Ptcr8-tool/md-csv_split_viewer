import {test,expect} from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true,showLineBreaks:true,distinguishLineBreaks:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
});
const marks=page=>page.locator('.cm-eol-marker');
test('mixed CRLF, LF and CR have distinct symbols and preserve original text',async({page})=>{
  const text='one\r\ntwo\nthree\rfour';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'mixed.txt',text,encoding:'utf8'}),text);
  await expect(marks(page)).toHaveCount(3);
  await expect(marks(page)).toHaveText(['↵','↓','←']);
  await expect(marks(page).nth(0)).toHaveAttribute('title',/CRLF/);
  await expect(marks(page).nth(1)).toHaveAttribute('title',/^LF/);
  await expect(marks(page).nth(2)).toHaveAttribute('title',/^CR（/);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  await page.evaluate(()=>{const e=window.__mdSplit.editor();e.dispatch({selection:{anchor:0}});e.focus();});
  await page.keyboard.type('x');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe('x'+text);
  await expect(marks(page)).toHaveText(['↵','↓','←']);
});

test('setting can choose a shared mark and mixed indicators return without editing content',async({page})=>{
  const text='a\r\nb\nc\rd';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'note.txt',text,encoding:'utf8'}),text);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.locator('#setting-distinguish-line-breaks').uncheck();
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect(marks(page)).toHaveText(['↵','↵','↵']);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.locator('#setting-distinguish-line-breaks').check();
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect(marks(page)).toHaveText(['↵','↓','←']);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
});

test('markers refresh when bulk conversion changes only line endings and undo restores them',async({page})=>{
  const text='a\r\nb\nc\rd';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'mixed.txt',text,savedText:text,encoding:'utf8'}),text);
  await expect(marks(page)).toHaveText(['↵','↓','←']);
  await page.locator('#line-endings').click();
  await page.locator('#line-ending-from').selectOption('CRLF');
  await page.locator('#line-ending-to').selectOption('LF');
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe('a\nb\nc\rd');
  await expect(marks(page)).toHaveText(['↓','↓','←']);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  await expect(marks(page)).toHaveText(['↵','↓','←']);
});

test('Markdown rendered inline line break markers use the corresponding raw ending',async({page})=>{
  const text='one\r\ntwo\nthree\rfour';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'mixed.md',text,savedText:text,encoding:'utf8'}),text);
  await expect(marks(page)).toHaveText(['↵','↓','←']);
  const rendered=page.locator('#preview .ws-line-break');
  await expect(rendered).toHaveCount(3);
  expect(await rendered.evaluateAll(nodes=>nodes.map(n=>n.dataset.mark))).toEqual(['↵','↓','←']);
});
