import {test,expect} from '@playwright/test';

test('source wrap choices retain settings and do not alter text',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const raw='a'.repeat(220)+'\n日本語\t末尾';
  await page.evaluate(text=>window.__mdSplit.setText(text),raw);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.locator('#setting-wrap-mode')).toHaveValue('window');
  await page.locator('#setting-wrap-mode').selectOption('column');
  await page.locator('#setting-wrap-column').fill('40');
  await page.getByRole('button',{name:'適用',exact:true}).click();
  const quick=page.getByRole('combobox',{name:'原文の折り返し方法'});await expect(quick).toHaveValue('column');
  await quick.selectOption('none');await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).wrapMode)).toBe('none');
  await quick.selectOption('column');
  const content=page.locator('.cm-content');
  await expect.poll(()=>content.evaluate(n=>getComputedStyle(n).width)).not.toBe('auto');
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(raw);
  const dimensions=await content.evaluate(n=>({width:n.clientWidth,line:n.querySelector('.cm-line').clientHeight,base:parseFloat(getComputedStyle(n.querySelector('.cm-line')).lineHeight)}));
  expect(dimensions.line).toBeGreaterThan(dimensions.base*2);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+Alt+x');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).wrapMode)).toBe('none');
  expect(await content.evaluate(n=>n.querySelector('.cm-line').clientHeight)).toBeLessThan(dimensions.line);
  await page.keyboard.press('Control+Alt+s');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).wrapMode)).toBe('column');
  await page.keyboard.press('Control+Alt+w');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).wrapMode)).toBe('window');
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(raw);
  await page.reload();await page.waitForFunction(()=>window.__mdSplit);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.locator('#setting-wrap-mode')).toHaveValue('window');
  await expect(page.locator('#setting-wrap-column')).toHaveValue('40');
});

test('old no-wrap preference survives upgrade',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({wrap:false,welcomeShown:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.locator('#setting-wrap-mode')).toHaveValue('none');
});

test('quick wrap control stays inside a narrow source header',async({page})=>{
  await page.setViewportSize({width:700,height:800});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const bounds=await page.evaluate(()=>{
    const header=document.querySelector('.source-pane .pane-heading').getBoundingClientRect();
    const controls=[...document.querySelectorAll('.source-pane .pane-heading select,.source-pane .pane-heading button')].map(n=>n.getBoundingClientRect());
    return controls.map(b=>({left:b.left-header.left,right:header.right-b.right,width:b.width}));
  });
  expect(bounds.every(b=>b.left>=-1&&b.right>=-1&&b.width>10)).toBe(true);
});
