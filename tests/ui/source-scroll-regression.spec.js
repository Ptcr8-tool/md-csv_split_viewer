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

test('source typing in the actual guide does not page the preview',async({page})=>{
  await page.setViewportSize({width:1668,height:600});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const guide=await (await import('node:fs/promises')).readFile('examples/Welcome.md','utf8');
  await page.evaluate(text=>window.__mdSplit.setText(text),guide);
  await page.evaluate(()=>{const cm=window.__mdSplit.editor(),doc=cm.state.doc.toString(),at=doc.indexOf('引用のサンプルです。')-2;cm.dispatch({selection:{anchor:at}});cm.focus();cm.scrollDOM.scrollTop=cm.lineBlockAt(at).top-130;});
  await settleScroll(page);await waitForScrollReady(page);
  const trace=[];const sample=()=>page.evaluate(()=>({source:window.__mdSplit.editor().scrollDOM.scrollTop,preview:document.querySelector('#preview').scrollTop,sourceHeight:window.__mdSplit.editor().scrollDOM.scrollHeight,previewHeight:document.querySelector('#preview').scrollHeight}));
  trace.push(await sample());for(let i=0;i<7;i++){await page.keyboard.press('Enter');await page.keyboard.insertText('a');await page.waitForTimeout(150);trace.push(await sample());}
  console.log('guide-trace',JSON.stringify(trace));expect(Math.abs(trace.at(-1).preview-trace[0].preview)).toBeLessThan(100);
});
