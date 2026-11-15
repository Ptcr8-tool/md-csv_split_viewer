import {test,expect} from '@playwright/test';
import {settleScroll} from './scroll-test-helpers.js';

test('source typing below an image preserves the preview position',async({page})=>{
 await page.setViewportSize({width:1500,height:750});
 let requests=0;
 await page.route('https://example.com/scroll-image.svg',async route=>{
   requests++;await new Promise(resolve=>setTimeout(resolve,150));
   await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#555"/></svg>'});
 });
 await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
 const text=['# Start','','![demo](https://example.com/scroll-image.svg)','',...Array.from({length:25},(_,i)=>`Paragraph ${i} text\n`),'## Target','','Editable text',...Array.from({length:80},(_,i)=>`More ${i} text\n`)].join('\n');
 await page.evaluate(text=>window.__mdSplit.setText(text),text);
 await page.waitForFunction(()=>{const img=document.querySelector('#preview img');return img?.complete&&img.naturalHeight>0;});
 await page.evaluate(()=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf('Editable text');cm.dispatch({selection:{anchor:at},scrollIntoView:true});cm.focus();});
 await settleScroll(page);await page.keyboard.insertText('z');await settleScroll(page);
 await page.evaluate(()=>{const p=document.querySelector('#preview'),h=[...p.querySelectorAll('h2')].find(n=>n.textContent.includes('Target'));p.scrollTop+=h.getBoundingClientRect().top-p.getBoundingClientRect().top-100;});
 await settleScroll(page);
 const sample=()=>page.evaluate(()=>{const p=document.querySelector('#preview'),h=[...p.querySelectorAll('h2')].find(n=>n.textContent.includes('Target'));return {scroll:p.scrollTop,top:h.getBoundingClientRect().top};});
 const before=await sample(),trace=[];for(let i=0;i<6;i++){await page.keyboard.insertText('x');await page.waitForTimeout(300);trace.push(await sample());}
 console.log('image-scroll',JSON.stringify({requests,before,trace}));
 for(const value of trace){expect(Math.abs(value.scroll-before.scroll)).toBeLessThan(30);expect(Math.abs(value.top-before.top)).toBeLessThan(30);}
});
