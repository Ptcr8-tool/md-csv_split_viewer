import {test,expect} from '@playwright/test';
import {waitForScrollReady,settleScroll} from './scroll-test-helpers.js';

const ready=page=>page.waitForFunction(()=>window.__mdSplit?.openDocument);
const sourceTop=page=>page.evaluate(()=>window.__mdSplit.editor().scrollDOM.scrollTop);
const tableTop=page=>page.locator('#text-preview .text-preview-scroll').evaluate(node=>node.scrollTop);
async function openPopup(page,side){const opened=page.waitForEvent('popup');await page.locator(`[data-cmd="popout-${side}"]`).click();const child=await opened;await ready(child);return child;}
async function sourceScroll(page,needle){await waitForScrollReady(page);await page.evaluate(needle=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf(needle);document.querySelector('#source').dispatchEvent(new WheelEvent('wheel',{bubbles:true}));cm.scrollDOM.scrollTop=cm.lineBlockAt(at).top;},needle);}
async function tableScroll(page,index){await waitForScrollReady(page);await page.locator('#text-preview').evaluate((node,index)=>{node.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));const scroll=node.querySelector('.text-preview-scroll'),row=scroll.querySelector(`tr[data-grid-row="${index}"]`),top=parseFloat(scroll.querySelector('table').style.getPropertyValue('--csv-sticky-top'))||0;scroll.scrollTop+=row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-top;},index);}

test('CSV popup sync uses its own file kind while owner displays Markdown with different sync',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');await ready(page);
  const text='Name,Value\n'+Array.from({length:350},(_,index)=>`record${String(index).padStart(3,'0')},value`).join('\n');
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'independent.csv',path:'C:\\synthetic\\independent.csv',text,savedText:text,needsInitialSave:false}),text);
  const source=await openPopup(page,'source'),preview=await openPopup(page,'preview');
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'owner.md',path:'C:\\synthetic\\owner.md',text:'# Owner\n\nunchanged',savedText:'# Owner\n\nunchanged',needsInitialSave:false}));
  await page.locator('[data-cmd="sync"]').click();await expect(page.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','false');
  await expect(source.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','true');await expect(preview.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','true');
  const ownerTop=await sourceTop(page);
  await sourceScroll(source,'record060');await expect.poll(()=>tableTop(preview)).toBeGreaterThan(500);
  await tableScroll(preview,141);await expect.poll(()=>sourceTop(source)).toBeGreaterThan(2000);expect(await sourceTop(page)).toBe(ownerTop);
  await page.getByRole('button',{name:'設定',exact:true}).click();await page.locator('#setting-file-kind').selectOption('csv');await page.locator('#setting-sync').uncheck();await page.getByRole('button',{name:'適用',exact:true}).click();await expect(preview.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','false');
  await waitForScrollReady(page);const stoppedSource=await sourceTop(source),previousTable=await tableTop(preview);await tableScroll(preview,221);await expect.poll(()=>tableTop(preview)).not.toBe(previousTable);await settleScroll(preview);await settleScroll(source);expect(await sourceTop(source)).toBe(stoppedSource);
  await page.locator('[data-cmd="sync"]').click();await expect(page.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','true');await expect(source.locator('[data-cmd="sync"]')).toHaveAttribute('aria-pressed','false');
  await waitForScrollReady(page);const stoppedPreview=await tableTop(preview),previousSource=await sourceTop(source);await sourceScroll(source,'record280');await expect.poll(()=>sourceTop(source)).not.toBe(previousSource);await settleScroll(source);await settleScroll(preview);expect(await tableTop(preview)).toBe(stoppedPreview);
  expect(await source.evaluate(()=>window.__mdSplit.getText())).toBe(text);expect(await preview.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe('# Owner\n\nunchanged');
  await source.close();await preview.close();
});
