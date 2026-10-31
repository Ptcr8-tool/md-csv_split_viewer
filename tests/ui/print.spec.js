import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));window.print=()=>{window.__printed=(window.__printed||0)+1;};});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);});
const open=(page,name,text)=>page.evaluate(({name,text})=>window.__mdSplit.openDocument({name,text,savedText:text,encoding:'utf8'}),{name,text});
const print=async(page,side)=>{await page.locator(`[data-cmd="print-${side}"]`).click();await expect(page.locator('#modal')).toBeVisible();await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBeTruthy();};

test('原文と展開表示をそれぞれ文書全体から作り、編集内容を変更しない',async({page})=>{
 const text='# Head\n\n**bold**\n\n最後';await open(page,'print.md',text);await print(page,'source');await expect(page.locator('#print-root pre')).toHaveText(text);await expect(page.locator('#print-root')).toBeHidden();
 await page.locator('[data-cmd="print-preview"]').click();await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(2);
 await expect(page.locator('#print-root h1')).toContainText('Head');await expect(page.locator('#print-root strong')).toHaveText('bold');expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
 await page.emulateMedia({media:'print'});await expect(page.locator('#print-root')).toBeVisible();await expect(page.locator('#app')).toBeHidden();
});
test('CSV印刷は表示対象または全列を選び、入力をHTMLとして実行しない',async({page})=>{
 const text='name,value,note\nA,2,<script>bad()</script>\nB,3,last';await open(page,'test.csv',text);
 await page.locator('#text-preview [data-select-column="1"]').click();await page.getByRole('button',{name:'選択を非表示'}).click();await page.locator('[data-cmd="print-preview"]').click();await expect(page.locator('#print-scope')).toHaveValue('visible');await page.getByRole('button',{name:'適用',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(1);await expect(page.locator('#print-root tr')).toHaveCount(3);await expect(page.locator('#print-root tr').nth(1).locator('td')).toHaveText(['A','<script>bad()</script>']);await expect(page.locator('#print-root script')).toHaveCount(0);
 await page.locator('[data-cmd="print-preview"]').click();await page.locator('#print-scope').selectOption('all');await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(2);await expect(page.locator('#print-root tr').nth(1).locator('td')).toHaveText(['A','2','<script>bad()</script>']);expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
});
test('HTMLの印刷で危険なタグと外部資源が無効',async({page})=>{
 const requests=[];page.on('request',r=>{if(r.url().includes('print-test.invalid'))requests.push(r.url());});
 await open(page,'test.html','<style>p{color:red}</style><h1>見出し</h1><img src="https://print-test.invalid/a.png"><script>window.bad=true</script><p>本文</p>');
 await page.locator('[data-cmd="print-preview"]').click();await expect(page.locator('#dialog-body')).toContainText('スタイルシートを除く');await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(1);
 await expect(page.locator('#print-root h1')).toHaveText('見出し');await expect(page.locator('#print-root script,#print-root style')).toHaveCount(0);expect(await page.evaluate(()=>window.bad)).toBeUndefined();expect(requests).toEqual([]);
});

test('Mermaid 図の印刷は SVG の描画が完了してから開く',async({page})=>{
 await open(page,'diagram.md','# 図\n\n```mermaid\nflowchart TD\n  A[開始] --> B[終了]\n```');
 await page.locator('[data-cmd="print-preview"]').click();await page.getByRole('button',{name:'適用',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__printed),{timeout:20000}).toBe(1);
 await expect(page.locator('#print-root .mermaid-stage svg')).toHaveCount(1);
 await expect(page.locator('#print-root .mermaid-stage')).not.toContainText('描画しています');
});

test('狭い表示でも印刷ボタンにアクセスできる',async({page})=>{
 await page.setViewportSize({width:800,height:800});await open(page,'small.md','test');
 for(const side of ['source','preview']){
   const result=await page.locator(`[data-cmd="print-${side}"]`).evaluate(node=>{const n=node.getBoundingClientRect(),parent=node.closest('.pane').getBoundingClientRect();return {left:n.left,right:n.right,paneLeft:parent.left,paneRight:parent.right};});
   expect(result.left).toBeGreaterThanOrEqual(result.paneLeft);expect(result.right).toBeLessThanOrEqual(result.paneRight);
 }
});

test('展開印刷の画像はローカルや埋め込みを保持し外部URLを除く',async({page})=>{
 const result=await page.evaluate(async()=>{
   const {buildPrintContent}=await import('/src/print.js');const preview=document.createElement('div');
   for(const src of ['https://assets.mdsplit.local/id/picture.png','data:image/png;base64,aGVsbG8=','https://print-test.invalid/external.png']){const img=document.createElement('img');img.setAttribute('src',src);preview.append(img);}
   return [...buildPrintContent({side:'preview',raw:'',kind:'markdown',preview}).querySelectorAll('img')].map(node=>node.getAttribute('src'));
 });
 expect(result).toEqual(['https://assets.mdsplit.local/id/picture.png','data:image/png;base64,aGVsbG8=',null]);
});

test('CSV の絞り込みは表示対象の印刷だけに反映',async({page})=>{
 await open(page,'filter.csv','name,value\nApple,1\nBanana,2\nApricot,3');
 await page.getByRole('button',{name:'絞り込み',exact:true}).click();const filter=page.getByRole('dialog',{name:'列で絞り込み'});await filter.getByLabel('絞り込む文字').fill('ap');await filter.getByRole('button',{name:'適用'}).click();
 await print(page,'preview');await expect(page.locator('#print-root tr')).toHaveCount(3);await expect(page.locator('#print-root')).not.toContainText('Banana');
 await page.locator('[data-cmd="print-preview"]').click();await page.locator('#print-scope').selectOption('all');await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(2);await expect(page.locator('#print-root tr')).toHaveCount(4);await expect(page.locator('#print-root')).toContainText('Banana');
});
