import {test,expect} from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
});
async function openHtml(page,text){await page.evaluate(text=>window.__mdSplit.openDocument({name:'outline.html',text,encoding:'utf8',hasBom:false}),text);}

test('HTML outline uses real headings, preserves source offsets and jumps to duplicate headings safely',async({page})=>{
  const requests=[];page.on('request',r=>{if(r.url().startsWith('https://outline-test.invalid/'))requests.push(r.url());});
  const raw='<!doctype html>\r\n<html><head><style>.x{color:red} /* <h1>fake style</h1> */</style><script>window.bad=1;"<h1>fake script</h1>"</script></head><body><!-- <h1>fake comment</h1> --><h1 data-test="a > b">A &amp; B</h1><div style="height:1600px">one</div><h2>同じ見出し</h2><div style="height:1600px">two</div><h2>同じ見出し</h2><img src="https://outline-test.invalid/a.png"></body></html>';
  await openHtml(page,raw);
  await expect(page.locator('#outline-panel')).toBeVisible();
  await expect(page.locator('.outline-jump')).toHaveText(['A & B','同じ見出し','同じ見出し']);
  const frame=page.locator('iframe.text-preview-html');await expect(frame).toHaveAttribute('sandbox','');
  const targets=frame.contentFrame().locator('h2');await expect(targets).toHaveCount(2);
  await page.locator('.outline-jump').nth(2).click();
  const expected=raw.slice(0,raw.lastIndexOf('<h2>同じ見出し')).replace(/\r\n/g,'\n').length;
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.editor().state.selection.main.from)).toBe(expected);
  await expect.poll(()=>targets.nth(1).evaluate(e=>e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().bottom > 0 && scrollY > 1000)).toBe(true);
  expect(await page.evaluate(()=>window.bad)).toBeUndefined();expect(requests).toEqual([]);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(raw);
  await page.getByRole('button',{name:'展開のみ',exact:true}).click();
  await page.locator('.outline-jump').first().click();
  await expect(page.locator('.source-pane')).toBeHidden();
  await expect(page.locator('.preview-pane')).toBeVisible();
});

test('HTML outline expands or collapses hierarchy and narrow layout can reopen it',async({page})=>{
  await page.setViewportSize({width:600,height:800});
  await openHtml(page,'<h1>親</h1><p>text</p><h2>子</h2><p>more</p><h1>次</h1>');
  await expect(page.locator('#outline-panel')).toBeHidden();
  await page.getByRole('button',{name:'見出しナビを開く',exact:true}).click();
  await expect(page.locator('.outline-jump')).toHaveText(['親','子','次']);
  await page.getByRole('button',{name:'折りたたむ: 親',exact:true}).click();
  await expect(page.getByRole('button',{name:'子',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'開く: 親',exact:true}).click();
  await expect(page.getByRole('button',{name:'子',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'見出しナビを隠す',exact:true}).click();
  await expect(page.locator('#outline-panel')).toBeHidden();
});

test('large HTML outline does not auto-generate a preview before explicit confirmation',async({page})=>{
  const raw='<h1>先頭</h1>'+('x'.repeat(2*1024*1024+1))+'<h2>最後</h2>';
  await openHtml(page,raw);
  await expect(page.getByRole('button',{name:'見出しを表示',exact:true})).toBeVisible();
  await expect(page.locator('iframe.text-preview-html')).toHaveCount(0);
  await page.getByRole('button',{name:'見出しを表示',exact:true}).click();
  await expect(page.locator('.outline-jump')).toHaveText(['先頭','最後'],{timeout:30000});
  await page.getByRole('button',{name:'最後',exact:true}).click();
  await expect(page.locator('iframe.text-preview-html')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'プレビューを表示',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(raw);
  await page.evaluate(text=>window.__mdSplit.setText(text),raw+'<h2>追加</h2>');
  await expect(page.getByRole('button',{name:'見出しを更新',exact:true})).toBeVisible();
  await expect(page.locator('.outline-jump')).toHaveCount(0);
  await page.getByRole('button',{name:'見出しを更新',exact:true}).click();
  await expect(page.locator('.outline-jump')).toHaveText(['先頭','最後','追加'],{timeout:30000});
});
