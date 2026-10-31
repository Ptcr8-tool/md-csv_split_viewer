import {test,expect} from '@playwright/test';
import {checkTheme} from '../../scripts/check-theme.mjs';

test('Markdown symbols stay readable in neutral dark and light themes without editing source',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const raw='# Markdownの記号を読みやすく\r\n\r\n- 箇条書きのハイフン\r\n* 別のリスト記号\r\n+ もうひとつの記号\r\n\r\n1. 番号付きリスト\r\n\r\n> 引用した文章\r\n\r\n**太字** と _斜体_、[リンク](https://example.com)、`inline code`\r\n\r\n---\r\n\r\n```js\r\nconst message = "コードも読みやすく";\r\n```\r\n\r\n<!-- コメント -->';
  await page.evaluate(text=>window.__mdSplit.setText(text),raw);
  await expect(page.locator(':root')).toHaveAttribute('data-theme','dark');
  const results=[await checkTheme(page,'dark')];
  await page.screenshot({path:'test-results/editor-dark.png'});
  for(const theme of ['light','dark','system']){
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await page.getByRole('radio',{name:'明るさ：'+({light:'ライト',dark:'ダーク',system:'システムに合わせる'}[theme]),exact:true}).check();
    await page.getByRole('button',{name:'適用',exact:true}).click();
    const expected=theme==='system'?'dark':theme;
    await expect(page.locator(':root')).toHaveAttribute('data-theme',expected);
    results.push(await checkTheme(page,expected));
    expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(raw);
  }
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator(':root')).toHaveAttribute('data-theme','light');
  results.push(await checkTheme(page,'light'));
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(raw);
  console.log('Rendered theme contrast:',JSON.stringify(results));
});
