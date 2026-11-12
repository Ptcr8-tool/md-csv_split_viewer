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

for(const kind of ['plain','list'])test(`typing at viewport edge does not page preview unexpectedly: ${kind}`,async({page})=>{
  await page.setViewportSize({width:1500,height:540});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const text=Array.from({length:160},(_,i)=>kind==='list'?`- Row ${i} lorem ipsum text`:`Row ${i} lorem ipsum text\n`).join('\n');
  await page.evaluate(text=>window.__mdSplit.setText(text),text);
  await page.evaluate(()=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf('Row 50')+6;cm.dispatch({selection:{anchor:at}});cm.focus();cm.scrollDOM.scrollTop=cm.lineBlockAt(at).top-cm.scrollDOM.clientHeight+32;});
  await settleScroll(page);await waitForScrollReady(page);
  const trace=[],sample=()=>page.evaluate(()=>({source:window.__mdSplit.editor().scrollDOM.scrollTop,preview:document.querySelector('#preview').scrollTop}));trace.push(await sample());
  for(let i=0;i<10;i++){await page.keyboard.press('Enter');await page.keyboard.insertText('x');await page.waitForTimeout(180);trace.push(await sample());}
  console.log('edge-trace',kind,JSON.stringify(trace));let ds=Math.abs(trace.at(-1).source-trace[0].source),dp=Math.abs(trace.at(-1).preview-trace[0].preview);expect(dp).toBeLessThan(ds*3+120);
});

for(const sync of [true,false])test(`list editing followed by mouse-selected plain text stays in range, sync ${sync}`,async({page})=>{
 await page.setViewportSize({width:1668,height:700});await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({sync:true,softBreaks:true,showLineBreaks:true,showFullWidthSpaces:true,showTabs:true,showSpaces:true,wrap:true,viewMode:'split',defaultViewMode:'last',ratio:0.47,fontSize:15,welcomeShown:true,updateCheckDays:-1})));await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
 const raw=await (await import('node:fs/promises')).readFile('examples/Welcome.md','utf8');await page.evaluate(text=>window.__mdSplit.setText(text),raw);
 if(!sync)await page.locator('#sync-toggle').click();
 await page.evaluate(()=>{const cm=window.__mdSplit.editor(),p=cm.state.doc.toString().indexOf('野菜を買う')+5;cm.dispatch({selection:{anchor:p}});cm.focus();cm.scrollDOM.scrollTop=cm.lineBlockAt(p).top-100;});
 await settleScroll(page);await waitForScrollReady(page);
 for(let i=0;i<5;i++){await page.keyboard.press('Enter');await page.keyboard.insertText('a');await page.waitForTimeout(200);}
 const pos=await page.evaluate(()=>{const cm=window.__mdSplit.editor(),p=cm.state.doc.toString().indexOf('この段落を選んで')+3;cm.scrollDOM.scrollTop=cm.lineBlockAt(p).top-100;return p;});
 await settleScroll(page);await waitForScrollReady(page);
 const pt=await page.evaluate(p=>{const rect=window.__mdSplit.editor().coordsAtPos(p);return rect?{x:rect.left+1,y:(rect.top+rect.bottom)/2}:null;},pos);
 expect(pt).not.toBeNull();await page.mouse.click(pt.x,pt.y);
 await page.waitForTimeout(300);if(!sync)await page.locator('#preview').evaluate(n=>{n.scrollTop=700;});await settleScroll(page);const sample=()=>page.evaluate(()=>({source:window.__mdSplit.editor().scrollDOM.scrollTop,preview:document.querySelector('#preview').scrollTop,focus:document.activeElement?.className}));let trace=[await sample()];
 for(let i=0;i<10;i++){await page.keyboard.press('Enter');await page.keyboard.insertText('a');await page.waitForTimeout(250);trace.push(await sample());}
 console.log('sequence-trace',sync,JSON.stringify(trace));let ds=Math.abs(trace.at(-1).source-trace[0].source),dp=Math.abs(trace.at(-1).preview-trace[0].preview);expect(dp).toBeLessThan(ds*3+160);
});
