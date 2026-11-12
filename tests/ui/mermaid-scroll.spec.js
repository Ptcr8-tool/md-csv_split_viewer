import {test,expect} from '@playwright/test';
import {settleScroll,waitForScrollReady} from './scroll-test-helpers.js';
for(const sync of [true,false])for(const location of ['middle','bottom'])test(`guide editing after diagrams remains stable, sync ${sync}, ${location}`,async({page})=>{
 await page.setViewportSize({width:1920,height:1012});await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({sync:true,softBreaks:true,showLineBreaks:true,showFullWidthSpaces:true,showTabs:true,showSpaces:true,wrap:true,viewMode:'split',ratio:0.47,fontSize:15,welcomeShown:true,updateCheckDays:-1})));await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
 const raw=await (await import('node:fs/promises')).readFile('examples/Welcome.md','utf8');await page.evaluate(text=>window.__mdSplit.setText(text),raw);
 if(!sync)await page.locator('#sync-toggle').click();
 await expect(page.locator('.mermaid-stage svg').first()).toBeVisible({timeout:30000});
 await page.evaluate(()=>{const cm=window.__mdSplit.editor(),p=cm.state.doc.toString().indexOf('現在行：');cm.dispatch({selection:{anchor:p},scrollIntoView:true});cm.focus();});
 await settleScroll(page);await waitForScrollReady(page);
 await page.keyboard.insertText('z');await settleScroll(page);await waitForScrollReady(page);
 await page.evaluate(location=>{const p=document.querySelector('#preview'),e=[...p.querySelectorAll('h2')].find(n=>n.textContent.includes('画面の配置'));if(location==='bottom')p.scrollTop=p.scrollHeight-p.clientHeight-30;else if(e)p.scrollTop+=e.getBoundingClientRect().top-p.getBoundingClientRect().top-150;},location);
 await settleScroll(page);await waitForScrollReady(page);
 const sample=()=>page.evaluate(()=>{const cm=window.__mdSplit.editor(),p=document.querySelector('#preview'),h=[...p.querySelectorAll('h2')].find(n=>n.textContent.includes('画面の配置')),stage=p.querySelector('.mermaid-stage');return {source:cm.scrollDOM.scrollTop,preview:p.scrollTop,heading:h?.getBoundingClientRect().top,stageHeight:stage?.getBoundingClientRect().height,previewHeight:p.scrollHeight};});
 const trace=[await sample()];
 for(let i=0;i<12;i++){await page.keyboard.insertText('a');await page.waitForTimeout(250);trace.push(await sample());}
 await page.waitForTimeout(1200);trace.push(await sample());console.log('diagram-trace',sync,JSON.stringify(trace));
 expect(Math.abs(trace.at(-1).preview-trace[0].preview)).toBeLessThan(30);expect(Math.abs(trace.at(-1).heading-trace[0].heading)).toBeLessThan(30);
});
