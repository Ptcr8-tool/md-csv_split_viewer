import {test,expect} from '@playwright/test';
import {settleScroll,waitForScrollReady} from './scroll-test-helpers.js';
for(const sync of [true,false])for(const kind of ['plain','list'])test(`source editing does not move preview viewport ${sync?'sync on':'sync off'} ${kind}`,async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const lines=Array.from({length:220},(_,i)=>kind==='list'?`- Row ${i} lorem ipsum`:`Row ${i} lorem ipsum\n`);
  await page.evaluate(text=>window.__mdSplit.setText(text),lines.join('\n'));
  if(!sync)await page.locator('#sync-toggle').click();
  await page.evaluate(()=>{const cm=window.__mdSplit.editor();const at=cm.state.doc.toString().indexOf('Row 80');cm.dispatch({selection:{anchor:at+6}});cm.focus();});
  await page.locator('.cm-scroller').evaluate(n=>{n.scrollTop=n.scrollHeight*.35;});
  await settleScroll(page);await waitForScrollReady(page);
  await page.locator('#preview').evaluate(n=>{n.scrollTop=n.scrollHeight*.33;});
  await settleScroll(page);await waitForScrollReady(page);
  const before=await page.locator('#preview').evaluate(n=>n.scrollTop);
  for(let i=0;i<5;i++){await page.keyboard.press('Enter');await page.keyboard.insertText('x');await page.waitForTimeout(100);}
  await settleScroll(page);
  const after=await page.locator('#preview').evaluate(n=>n.scrollTop);
  expect(Math.abs(after-before)).toBeLessThan(80);
});
