import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());});
const setText=(page,text)=>page.evaluate(t=>window.__mdSplit.setText(t),text);
const selectSource=(page,from,to)=>page.evaluate(({from,to})=>{const cm=window.__mdSplit.editor();cm.focus();cm.dispatch({selection:{anchor:from,head:to}});},{from,to});
const openSearch=page=>page.getByRole('button',{name:'検索・置換 · Ctrl+F',exact:true}).click();
test('source selection opens as a literal search via button and Ctrl+F',async({page})=>{
  await setText(page,'a.b a.b');await page.keyboard.press('Control+f');await page.locator('#find-regex').check();await page.getByRole('button',{name:'検索を閉じる',exact:true}).click();
  await selectSource(page,0,3);await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('a.b');await expect(page.locator('#find-regex')).not.toBeChecked();
  await page.getByRole('button',{name:'検索を閉じる',exact:true}).click();await selectSource(page,4,7);await page.keyboard.press('Control+f');await expect(page.locator('#find-text')).toHaveValue('a.b');
});
test('rendered selection uses visible text and warns if source differs',async({page})=>{
  await setText(page,'before **bold** after');await page.evaluate(()=>{const p=document.querySelector('#preview');p.focus();const r=document.createRange();const bold=p.querySelector('strong');const node=document.createTreeWalker(bold,NodeFilter.SHOW_TEXT).nextNode();r.setStart(node,0);r.setEnd(node,4);const s=getSelection();s.removeAllRanges();s.addRange(r);});
  await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('bold');
  await page.getByRole('button',{name:'検索を閉じる',exact:true}).click();
  await page.evaluate(()=>{const p=document.querySelector('#preview');p.focus();const r=document.createRange();const line=p.querySelector('p');const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);r.setStart(nodes[0],0);r.setEnd(nodes.at(-1),nodes.at(-1).length);const s=getSelection();s.removeAllRanges();s.addRange(r);});
  await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('before bold after');await expect(page.locator('#search-message')).toContainText('書式記号');
});
test('multiline selection is not silently truncated and empty selection preserves query',async({page})=>{
  await setText(page,'one\ntwo');await page.keyboard.press('Control+f');await page.locator('#find-text').fill('previous');await page.getByRole('button',{name:'検索を閉じる',exact:true}).click();
  await selectSource(page,0,7);await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('previous');await expect(page.locator('#search-message')).toContainText('複数行');
  await page.getByRole('button',{name:'検索を閉じる',exact:true}).click();await selectSource(page,0,0);await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('previous');
});
test('selected text in a CSV cell is captured before editor is finalized',async({page})=>{
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'test.csv',text:'a,b\nfirst,second\n',savedText:'a,b\nfirst,second\n',encoding:'utf8',hasBom:false}));
  await page.locator('#text-preview [data-cell-row="1"][data-cell-column="1"]').dblclick();const cell=page.locator('#text-preview textarea.text-preview-cell-input');await cell.focus();await cell.evaluate(n=>n.setSelectionRange(0,3));await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('sec');
});
test('CSV detached preview forwards selected text to its owning search',async({page})=>{
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'test.csv',text:'a,b\nfirst,second\n',savedText:'a,b\nfirst,second\n',encoding:'utf8',hasBom:false}));
  const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'展開表示を別ウィンドウで開く',exact:true}).click();const child=await opened;await child.waitForFunction(()=>window.__mdSplit?.editor());
  await child.locator('#text-preview [data-cell-row="1"][data-cell-column="1"]').dblclick();const input=child.locator('#text-preview textarea.text-preview-cell-input');await input.focus();await input.evaluate(n=>n.setSelectionRange(0,3));await child.getByRole('button',{name:'検索・置換 · Ctrl+F',exact:true}).click();await expect(page.locator('#search-panel')).toBeVisible();await expect(page.locator('#find-text')).toHaveValue('sec');await child.close();
});
test('visible text selected inside a CSV cell is copied into search',async({page})=>{
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'test.csv',text:'a,b\nfirst,second\n',savedText:'a,b\nfirst,second\n',encoding:'utf8',hasBom:false}));
  const cell=page.locator('#text-preview [data-cell-row="1"][data-cell-column="1"]');await cell.click();await cell.evaluate(n=>{const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),node=w.nextNode(),r=document.createRange();r.setStart(node,0);r.setEnd(node,3);const s=getSelection();s.removeAllRanges();s.addRange(r);});await openSearch(page);await expect(page.locator('#find-text')).toHaveValue('sec');
});
