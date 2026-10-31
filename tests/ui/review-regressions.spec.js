import {test,expect} from '@playwright/test';

test('Enter in the preview preserves only leading whitespace in fenced code',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  for(const [line,expected] of [['test();','test();\n'],['\ttest();','\ttest();\n\t'],['  test();','  test();\n  ']]){
    const raw='```js\n'+line+'\n```';
    await page.evaluate(text=>window.__mdSplit.setText(text),raw);
    const at=raw.indexOf(line)+line.length;
    await page.evaluate(at=>window.__mdSplit.renderer.restoreSelection(at,at),at);
    await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe('```js\n'+expected+'\n```');
  }
});

test('detached panes attach under a non-root deployment path',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/nested/index.html');await page.waitForFunction(()=>window.__mdSplit);
  const opened=page.waitForEvent('popup');
  await page.locator('[data-cmd="popout-source"]').click();
  const child=await opened;await child.waitForFunction(()=>window.__mdSplit);
  expect(new URL(child.url()).pathname).toBe('/nested/index.html');
  await expect(child.locator('.source-pane')).toBeVisible();
});
