import {test,expect} from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit?.openDocument);
});

test('HTML beyond 512 KiB previews automatically without allowing scripts or remote resources',async({page})=>{
  test.setTimeout(90000);
  const external=[];
  page.on('request',request=>{if(request.url().startsWith('https://large-preview.invalid/'))external.push(request.url());});
  const raw='<h1>安全な表示</h1><p>'+('x'.repeat(530000))+'</p><script>parent.largePreviewExecuted=true</script><img src="https://large-preview.invalid/image.png">';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'large.html',text,encoding:'utf8',hasBom:false}),raw);
  const frame=page.locator('#text-preview iframe');
  await expect(frame).toHaveAttribute('sandbox','');
  await expect(page.frameLocator('#text-preview iframe').getByRole('heading',{name:'安全な表示'})).toBeVisible();
  expect(await page.evaluate(()=>window.__mdSplit.getText().length)).toBe(raw.length);
  expect(await frame.evaluate(node=>{const doc=new DOMParser().parseFromString(node.getAttribute('srcdoc'),'text/html');return doc.querySelectorAll('script,img[src]').length;})).toBe(0);
  expect(await page.evaluate(()=>window.largePreviewExecuted)).toBeUndefined();
  expect(external).toEqual([]);
});

test('very large HTML is available on demand and keeps the previous safe preview while editing',async({page})=>{
  test.setTimeout(120000);
  const raw='<p id="sample">old'+('x'.repeat(2*1024*1024))+'</p><script>parent.largePreviewExecuted=true</script>';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'very-large.html',text,encoding:'utf8',hasBom:false}),raw);
  const container=page.locator('#text-preview');
  await expect(container.getByText(/大きなHTML/)).toBeVisible();
  await expect(container.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__mdSplit.getText().length)).toBe(raw.length);
  await container.getByRole('button',{name:'プレビューを表示'}).click();
  const frame=container.locator('iframe');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('sandbox','');
  await expect(page.frameLocator('#text-preview iframe').locator('p')).toHaveCount(1);
  await frame.evaluate(node=>{node.dataset.held='yes';});
  const changed=raw.replace('old','new');
  await page.evaluate(text=>window.__mdSplit.setText(text),changed);
  await expect(container.getByRole('button',{name:'プレビューを更新'})).toBeVisible();
  await expect(frame).toHaveAttribute('data-held','yes');
  expect(await page.frameLocator('#text-preview iframe').locator('p').evaluate(node=>node.textContent.startsWith('old'))).toBe(true);
  await container.getByRole('button',{name:'プレビューを更新'}).click();
  await expect.poll(async()=>{
    try{return await page.frameLocator('#text-preview iframe').locator('p').evaluate(node=>node.textContent.startsWith('new'));}
    catch{return false;}
  },{timeout:30000}).toBe(true);
  expect(await page.evaluate(()=>window.largePreviewExecuted)).toBeUndefined();
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'other.html',text:'<p>別の文書</p>',encoding:'utf8',hasBom:false}));
  await expect(page.frameLocator('#text-preview iframe').getByText('別の文書')).toBeVisible();
  await expect(container.locator('iframe')).toHaveCount(1);
});
