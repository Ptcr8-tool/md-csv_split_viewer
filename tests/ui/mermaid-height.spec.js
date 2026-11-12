import {test,expect} from '@playwright/test';
import {settleScroll} from './scroll-test-helpers.js';

test('diagram editing, invalid code and resize release reserved height',async({page})=>{
 await page.setViewportSize({width:1500,height:750});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
 const doc=['# Test','', '```mermaid','flowchart TD','A --> B','```','','Text after diagram','','Other text'].join('\n');
 await page.evaluate(value=>window.__mdSplit.setText(value),doc);
 const stage=page.locator('.mermaid-stage').first();await expect(stage.locator('svg')).toBeVisible({timeout:30000});
 await page.locator('.mermaid-block button').first().click();
 const editor=page.locator('.diagram-code').first();await expect(editor).toBeVisible();
 await editor.fill('flowchart TD\nA --> B\nB --> C\nC --> D');await expect.poll(()=>stage.locator('svg').count(),{timeout:30000}).toBe(1);
 await editor.blur();await expect(page.locator('.mermaid-stage svg')).toHaveCount(1,{timeout:30000});
 const edited=await page.evaluate(()=>window.__mdSplit.editor().state.doc.toString());expect(edited).toContain('C --> D');
 await page.evaluate(()=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf('Text after diagram');cm.dispatch({selection:{anchor:at},scrollIntoView:true});cm.focus();});
 await page.keyboard.insertText('x');await expect(page.locator('.mermaid-stage svg')).toHaveCount(1,{timeout:30000});
 await expect.poll(()=>page.locator('.mermaid-stage').first().evaluate(n=>n.style.minHeight),{timeout:30000}).toBe('');
 await page.setViewportSize({width:900,height:750});await page.keyboard.insertText('y');
 await expect(page.locator('.mermaid-stage svg')).toHaveCount(1,{timeout:30000});
 await expect.poll(()=>page.locator('.mermaid-stage').first().evaluate(n=>n.style.minHeight),{timeout:30000}).toBe('');
 await page.locator('.mermaid-block button').first().click();const newEditor=page.locator('.diagram-code').first();await newEditor.fill('invalid ! syntax !');await newEditor.blur();
 await expect(page.locator('.diagram-error').first()).toBeVisible({timeout:30000});
 await expect.poll(()=>page.locator('.mermaid-stage').first().evaluate(n=>n.style.minHeight),{timeout:30000}).toBe('');
 await page.locator('.mermaid-block button').first().click();const recovery=page.locator('.diagram-code').first();await recovery.fill('flowchart TD\nA --> B');await recovery.blur();
 await expect(page.locator('.mermaid-stage svg')).toHaveCount(1,{timeout:30000});
 await expect.poll(()=>page.locator('.mermaid-stage').first().evaluate(n=>n.style.minHeight),{timeout:30000}).toBe('');
});

test('identical diagrams in different widths retain their own rendered heights',async({page})=>{
 await page.setViewportSize({width:1500,height:750});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
 const chart=['```mermaid','flowchart TD','A[First long node] --> B[Second long node]','B --> C[Third node]','```'];
 const doc=['# Test','',...chart,'','> '+chart.join('\n> '),'','Text after diagrams'].join('\n');
 await page.evaluate(value=>window.__mdSplit.setText(value),doc);
 await expect(page.locator('.mermaid-stage svg')).toHaveCount(2,{timeout:30000});
 const before=await page.locator('.mermaid-stage').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));expect(before.every(h=>h>80)).toBe(true);
 await page.evaluate(()=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf('Text after diagrams');cm.dispatch({selection:{anchor:at},scrollIntoView:true});cm.focus();});
 await settleScroll(page);await page.keyboard.insertText('x');
 await expect(page.locator('.mermaid-stage svg')).toHaveCount(2,{timeout:30000});
 const after=await page.locator('.mermaid-stage').evaluateAll(es=>es.map(e=>({h:e.getBoundingClientRect().height,min:e.style.minHeight})));
 for(let i=0;i<2;i++){expect(Math.abs(after[i].h-before[i])).toBeLessThan(2);expect(after[i].min).toBe('');}
});
