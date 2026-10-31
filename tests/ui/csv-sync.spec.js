import {test,expect} from '@playwright/test';
import {waitForScrollReady,settleScroll} from './scroll-test-helpers.js';

const ready=page=>page.waitForFunction(()=>window.__mdSplit?.openDocument);
const rawText=page=>page.evaluate(()=>window.__mdSplit.getText());
const open=async(page,name,text)=>{await page.evaluate(({name,text})=>window.__mdSplit.openDocument({name,path:'C:\\synthetic\\'+name,text,savedText:text,needsInitialSave:false}),{name,text});};
const sourceTop=page=>page.evaluate(()=>window.__mdSplit.editor().scrollDOM.scrollTop);
const tableTop=page=>page.locator('#text-preview .text-preview-scroll').evaluate(n=>n.scrollTop);
const setSourceTop=async(page,needle)=>{await waitForScrollReady(page);await page.evaluate(needle=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf(needle);document.querySelector('#source').dispatchEvent(new WheelEvent('wheel',{bubbles:true}));cm.scrollDOM.scrollTop=cm.lineBlockAt(at).top;},needle);};
const setPreviewTop=async(page,row)=>{await waitForScrollReady(page);await page.locator('#text-preview').evaluate((node,row)=>{node.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));const p=node.querySelector('.text-preview-scroll'),r=p.querySelector('tr[data-grid-row="'+row+'"]');p.scrollTop+=r.getBoundingClientRect().top-p.getBoundingClientRect().top-(parseFloat(p.querySelector('table').style.getPropertyValue('--csv-sticky-top'))||0);},row);};

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});
  await page.goto('/');await ready(page);
});

test('CSV source and grid scroll follow the same quoted record and can be unlinked',async({page})=>{
  const text='Name,Note\n'+Array.from({length:150},(_,i)=>`record${String(i).padStart(3,'0')},"first line\nsecond line"`).join('\n');await open(page,'sync.csv',text);
  await expect(page.locator('[data-cmd="sync"]')).toBeVisible();
  await setSourceTop(page,'record040');
  await expect.poll(()=>tableTop(page)).toBeGreaterThan(500);
  const delta=await page.locator('#text-preview').evaluate(node=>{const p=node.querySelector('.text-preview-scroll'),row=p.querySelector('tr[data-grid-row="41"]');return row.getBoundingClientRect().top-p.getBoundingClientRect().top;});expect(Math.abs(delta)).toBeLessThan(180);
  await setPreviewTop(page,81);
  // The previous row (record040) can already exceed 2000px. Wait for the
  // requested record itself, including its quoted multiline continuation.
  await expect.poll(()=>page.evaluate(()=>{
    const cm=window.__mdSplit.editor(),doc=cm.state.doc,line=doc.lineAt(cm.lineBlockAtHeight(cm.scrollDOM.scrollTop).from);
    const previous=line.number>1?doc.line(line.number-1).text:'';
    return line.text.startsWith('record080,')||(line.text.startsWith('second line')&&previous.startsWith('record080,'));
  })).toBe(true);
  await page.locator('[data-cmd="sync"]').click();await expect(page.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','false');
  const before=await tableTop(page),previousSource=await sourceTop(page);await setSourceTop(page,'record020');await expect.poll(()=>sourceTop(page)).not.toBe(previousSource);await settleScroll(page);expect(await tableTop(page)).toBe(before);
  const sourceBefore=await sourceTop(page),previousTable=await tableTop(page);await setPreviewTop(page,101);await expect.poll(()=>tableTop(page)).not.toBe(previousTable);await settleScroll(page);expect(await sourceTop(page)).toBe(sourceBefore);
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('CSV caret and grid clicks highlight linked rows without scrolling the other pane',async({page})=>{
  const text='Name\tNote\n'+Array.from({length:100},(_,i)=>`record${i}\t"first\nsecond"`).join('\n');await open(page,'linked.tsv',text);
  await setSourceTop(page,'record40');await expect.poll(()=>tableTop(page)).toBeGreaterThan(500);const before=await tableTop(page);
  await page.evaluate(()=>{const cm=window.__mdSplit.editor();cm.dispatch({selection:{anchor:cm.state.doc.toString().indexOf('record45')}});});
  await expect(page.locator('#text-preview tr[data-grid-row="46"]')).toHaveClass(/csv-active-row/);expect(await tableTop(page)).toBe(before);
  await page.locator('#text-preview [data-cell-row="41"][data-cell-column="0"]').click();const sourceBefore=await sourceTop(page);
  await expect(page.locator('#source .cm-linked-activeLine')).toContainText('record40');await settleScroll(page);expect(await sourceTop(page)).toBe(sourceBefore);
  expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('CSV source scroll follows pages while keeping frozen and hidden rows',async({page})=>{
  const text=Array.from({length:1101},(_,i)=>`record${String(i).padStart(4,'0')},value`).join('\n');await open(page,'paged.csv',text);await page.getByRole('button',{name:'表示する',exact:true}).click();
  await page.getByRole('button',{name:'次の行',exact:true}).click();await expect.poll(()=>sourceTop(page)).toBeGreaterThan(1000);await page.getByRole('button',{name:'前の行',exact:true}).click();await expect.poll(()=>sourceTop(page)).toBeLessThan(500);
  await page.locator('#text-preview [data-select-row="10"]').click();await page.getByRole('button',{name:'選択を非表示',exact:true}).click();
  await page.getByRole('button',{name:'表示設定',exact:true}).click();const dialog=page.getByRole('dialog',{name:'CSVの表示設定',exact:true});await dialog.locator('#csv-freeze-rows').fill('2');await dialog.getByRole('button',{name:'適用',exact:true}).click();
  await setSourceTop(page,'record0650');await expect(page.locator('#text-preview tr[data-grid-row="650"]')).toBeVisible();await expect(page.locator('#text-preview tr[data-grid-row="1"] .csv-frozen-row').first()).toBeVisible();await expect(page.locator('#text-preview tr[data-grid-row="10"]')).toHaveCount(0);
  await expect(page.locator('#text-preview .csv-selection-status')).toContainText('セル・行・列をクリックして選択');expect(await rawText(page)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});


test('CSV preview popup follows source scrolling and sends grid scrolling back',async({page})=>{
  const text='Name,Note\n'+Array.from({length:180},(_,i)=>`record${String(i).padStart(3,'0')},value`).join('\n');await open(page,'popup.csv',text);
  const opened=page.waitForEvent('popup');await page.locator('[data-cmd="popout-preview"]').click();const child=await opened;await ready(child);
  await setSourceTop(page,'record050');await expect.poll(()=>tableTop(child)).toBeGreaterThan(500);
  await setPreviewTop(child,101);await expect.poll(()=>sourceTop(page)).toBeGreaterThan(2000);
  expect(await rawText(page)).toBe(text);expect(await rawText(child)).toBe(text);expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);await child.close();
});
