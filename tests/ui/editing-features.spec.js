import {test,expect} from '@playwright/test';
import {checkTheme} from '../../scripts/check-theme.mjs';
test.beforeEach(async({page})=>{await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);});
const setText=(page,text)=>page.evaluate(text=>window.__mdSplit.setText(text),text);
const getText=page=>page.evaluate(()=>window.__mdSplit.getText());
const select=(page,from,to=from)=>page.evaluate(({from,to})=>window.__mdSplit.renderer.restoreSelection(from,to),{from,to});
const sourceSelect=(page,from,to=from)=>page.evaluate(({from,to})=>{const cm=window.__mdSplit.editor();cm.dispatch({selection:{anchor:from,head:to}});cm.focus();},{from,to});
const codeRange=page=>page.evaluate(()=>({...window.__mdSplit.renderer.codeBlocks[0]}));
const settings=async(page,change)=>{await page.getByRole('button',{name:'設定',exact:true}).click();await change();await page.getByRole('button',{name:'適用',exact:true}).click();await expect(page.locator('#modal')).not.toBeVisible();};

for(const [prefix,next] of [['- ','- '],['1. ','2. '],['- [x] ','- [ ] ']])test('right Enter continues and exits list: '+prefix,async({page})=>{
  const raw='__keep__  \r\n\r\n'+prefix+'first';await setText(page,raw);await select(page,raw.length);await page.keyboard.press('Enter');
  expect(await getText(page)).toBe(raw+'\r\n'+next);await expect(page.locator('#preview li')).toHaveCount(2);
  await page.keyboard.press('Enter');await page.keyboard.insertText('通常文');
  expect(await getText(page)).toBe(raw+'\r\n\r\n通常文');await expect(page.locator('#preview li')).toHaveCount(1);await expect(page.locator('#preview>p').last()).toHaveText('通常文');
});

test('source Enter exits a list and plain Tab remains an actual tab in both panes',async({page})=>{
  await setText(page,'- first');await sourceSelect(page,7);await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.insertText('ab');expect(await getText(page)).toBe('- first\n\nab');
  await sourceSelect(page,10);await page.keyboard.press('Tab');expect(await getText(page)).toBe('- first\n\na\tb');
  await select(page,11);await page.keyboard.press('Tab');expect(await getText(page)).toBe('- first\n\na\t\tb');
});

test('empty nested hyphen remains an editable bullet and Tab, Shift+Tab, Backspace change list level',async({page})=>{
  await setText(page,'- parent\n- ');await select(page,11);await page.keyboard.press('Tab');expect(await getText(page)).toBe('- parent\n  - ');await expect(page.locator('#preview>ul>li>ul>li')).toHaveCount(1);
  await page.keyboard.insertText('child');expect(await getText(page)).toBe('- parent\n  - child');
  await select(page,13);await page.keyboard.press('Shift+Tab');expect(await getText(page)).toBe('- parent\n- child');await page.keyboard.press('Tab');expect(await getText(page)).toBe('- parent\n  - child');
  await page.keyboard.press('Backspace');expect(await getText(page)).toBe('- parent\n- child');await page.keyboard.press('Backspace');expect(await getText(page)).toBe('- parent\n\nchild');
});

test('source list indentation carries nested items and works in Discord mode',async({page})=>{
  const raw='- parent\n- child\n  - nested\n- tail';await setText(page,raw);await page.getByRole('button',{name:'Discord表示',exact:true}).click();await sourceSelect(page,11);await page.keyboard.press('Tab');
  expect(await getText(page)).toBe('- parent\n  - child\n    - nested\n- tail');await expect(page.locator('#preview>ul>li>ul>li>ul>li')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');expect(await getText(page)).toBe(raw);
});

test('source single newlines are displayed as separate lines and exact right edits retain CRLF',async({page})=>{
  const raw='aa\r\naa\r\naa\r\n\r\nbb';await setText(page,raw);
  const ys=await page.evaluate(()=>{const leaf=window.__mdSplit.renderer.leaves[0];return [0,3,6].map(i=>{const r=document.createRange();r.setStart(leaf.node,i);r.setEnd(leaf.node,i+1);return r.getBoundingClientRect().top;});});expect(ys[1]).toBeGreaterThan(ys[0]+10);expect(ys[2]).toBeGreaterThan(ys[1]+10);
  await select(page,4,6);await page.keyboard.insertText('ab');expect(await getText(page)).toBe(raw.replace('aa\r\naa\r\n','aa\r\nab\r\n'));
});

test('new empty paragraph is a real caret target after Enter at the end of the document',async({page})=>{
  await setText(page,'aa');await select(page,2);await page.keyboard.press('Enter');await page.keyboard.insertText('ab');expect(await getText(page)).toBe('aa\n\nab');
});

test('a formatted list item can split in the middle and indent at its visible start',async({page})=>{
  await setText(page,'- parent\n- **abcd**');await select(page,15);await page.keyboard.press('Enter');expect(await getText(page)).toBe('- parent\n- **ab**\n- **cd**');await expect(page.locator('#preview strong')).toHaveCount(2);
  await select(page,21);await page.keyboard.press('Tab');expect(await getText(page)).toBe('- parent\n- **ab**\n  - **cd**');await page.keyboard.press('Backspace');expect(await getText(page)).toBe('- parent\n- **ab**\n- **cd**');
});

test('pasting rich HTML into code inserts its plain text and keeps literal Markdown characters',async({page})=>{
  await setText(page,'```html\nkeep\n```');const range=await codeRange(page);await select(page,range.contentFrom,range.contentTo);
  const text='<p>**text** `code`</p>\n<span>next</span>';
  await page.evaluate(text=>{const data=new DataTransfer();data.setData('text/plain',text);data.setData('text/html','<b>formatted paste</b>');document.querySelector('#preview').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},text);
  expect(await getText(page)).toBe('```html\n'+text+'\n```');await expect(page.locator('.code-content')).toHaveText(text);
});

test('Ctrl+Tab inserts a tab in a table while Tab continues to move between cells',async({page})=>{
  await setText(page,'| A | B |\n|---|---|\n|one|two|');const at=(await getText(page)).indexOf('one')+1;await select(page,at);await page.keyboard.press('Control+Tab');expect(await getText(page)).toContain('|o\tne|two|');
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>getSelection().focusNode.parentElement.closest('[data-cell]').dataset.col)).toBe('1');
});

test('tight empty code accepts HTML, Enter and Tab while closing fences and following details survive',async({page})=>{
  const suffix='\r\n\r\n<details>\r\n<summary>詳細</summary>\r\n\r\n本文\r\n\r\n</details>';await setText(page,'```html\r\n```'+suffix);let range=await codeRange(page);await select(page,range.contentFrom);await page.keyboard.insertText('<h1>aa</h1>');
  expect(await getText(page)).toBe('```html\r\n<h1>aa</h1>\r\n```'+suffix);await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.insertText('<p>bb</p>');
  expect(await getText(page)).toBe('```html\r\n<h1>aa</h1>\r\n\t<p>bb</p>\r\n```'+suffix);await expect(page.locator('#preview .code-block')).toHaveCount(1);await expect(page.locator('#preview details')).toHaveCount(1);await expect(page.locator('.code-content')).toHaveText('<h1>aa</h1>\n\t<p>bb</p>');
});

test('deleting all code keeps a block and literal pasted backticks expand the fence',async({page})=>{
  await setText(page,'```text\nhello\n```\n\n__keep__');let range=await codeRange(page);await select(page,range.contentFrom,range.contentTo);await page.keyboard.press('Backspace');expect(await getText(page)).toBe('```text\n\n```\n\n__keep__');
  await page.keyboard.insertText('```');expect(await getText(page)).toBe('````text\n```\n````\n\n__keep__');await expect(page.locator('#preview .code-block')).toHaveCount(1);await expect(page.locator('#preview strong')).toHaveText('keep');
});

test('HTML preset and later language changes provide syntax color in both editors without running HTML',async({page})=>{
  await setText(page,'');await page.getByRole('button',{name:'コードブロック',exact:true}).click();await page.locator('#code-preset').selectOption('html');await expect(page.locator('#code-preset-body')).toHaveValue(/<!doctype html>/);await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.locator('.code-content .tok-typeName').first()).toBeVisible();expect(await getText(page)).toContain('```html\n<!doctype html>');
  const colored=await page.evaluate(()=>{const body=getComputedStyle(document.querySelector('.cm-content')).color;return Array.from(document.querySelectorAll('.cm-content span')).some(n=>getComputedStyle(n).color!==body);});expect(colored).toBe(true);
  const before=await getText(page);await page.getByRole('combobox',{name:'コードブロックの言語',exact:true}).selectOption('javascript');
  expect(await getText(page)).toBe(before.replace('```html','```javascript'));
  const raw='```html\n<script>window._unsafeCode = true</script>\n<img src=x onerror="window._unsafeCode=true">\n```';await setText(page,raw);await expect(page.locator('.code-content')).toContainText('<script>');expect(await page.evaluate(()=>window._unsafeCode)).toBeUndefined();await expect(page.locator('#preview img')).toHaveCount(0);
});

test('whitespace marks in both panes do not enter the document or copied source',async({page})=>{
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);const raw='a \u3000\tb\nc';await setText(page,raw);
  await settings(page,async()=>{for(const id of ['line-breaks','wide-spaces','tabs','spaces'])await page.locator('#setting-'+id).check();});
  await expect(page.locator('#source .ws-wide-space')).toHaveCount(1);await expect(page.locator('#source .ws-tab')).toHaveCount(1);await expect(page.locator('#source .cm-eol-marker')).toHaveCount(1);await expect(page.locator('#preview .ws-wide-space')).toHaveCount(1);await expect(page.locator('#preview .ws-line-break')).toHaveCount(1);
  expect(await getText(page)).toBe(raw);await page.getByRole('button',{name:'全文をMarkdownでコピー',exact:true}).click();expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(raw);
  await select(page,4,5);await page.keyboard.insertText('B');expect(await getText(page)).toBe(raw.replace('b','B'));
  await settings(page,async()=>{for(const id of ['line-breaks','wide-spaces','tabs','spaces'])await page.locator('#setting-'+id).uncheck();});await expect(page.locator('#preview .visible-whitespace')).toHaveCount(0);expect(await getText(page)).toBe(raw.replace('b','B'));
});

test('all six themes keep text readable, preserve source, and save the selected palette',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const raw='# 色を選ぶ\n\n- リスト\n\n> 引用\n\n**太字** [リンク](https://example.com) `code`\n\n```html\n<h1 class="title">HTML</h1>\n```';await setText(page,raw);
  for(const palette of ['black','green','red','blue','parchment','parchment-texture']){
    await settings(page,async()=>{await page.locator('input[name="color-theme"][value="'+palette+'"]').check();if(!palette.startsWith('parchment'))await page.getByRole('radio',{name:'明るさ：ダーク',exact:true}).check();});
    await expect(page.locator(':root')).toHaveAttribute('data-palette',palette);await checkTheme(page,palette.startsWith('parchment')?'light':'dark');expect(await getText(page)).toBe(raw);await page.screenshot({path:'test-results/theme-'+palette+'.png'});
  }
  await page.reload();await page.waitForFunction(()=>window.__mdSplit);await expect(page.locator(':root')).toHaveAttribute('data-palette','parchment-texture');expect(errors).toEqual([]);
});
