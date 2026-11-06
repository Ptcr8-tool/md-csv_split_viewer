import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit?.editor());
});

test('search icon, notation reference and examples are separate and readable',async({page})=>{
  const search=page.getByRole('button',{name:'検索・置換 · Ctrl+F',exact:true});
  await expect(search.locator('svg circle')).toHaveCount(1);
  await expect(search.locator('svg path')).toHaveCount(1);
  await search.click();
  await page.getByRole('button',{name:'正規表現の表記一覧',exact:true}).click();
  await expect(page.locator('#dialog-title')).toHaveText('正規表現の表記一覧');
  await expect(page.locator('#regex-reference')).toContainText('検索：Windows版で使える表記');
  await expect(page.locator('#regex-reference')).toContainText('置換欄で使える表記');
  await expect(page.locator('#regex-reference')).toContainText('CRLFは \\r\\n と入力します');
  await expect(page.locator('#regex-samples')).toHaveCount(0);
  await page.locator('#regex-reference-nav').getByRole('button',{name:'置換欄',exact:true}).click();
  await expect(page.getByRole('heading',{name:'置換欄で使える表記'})).toBeInViewport();
  await expect(page.locator('#modal .dialog-actions .primary')).toBeInViewport();
  await page.locator('#modal .dialog-actions .primary').click();
  await page.getByRole('button',{name:'正規表現のサンプル',exact:true}).click();
  await expect(page.locator('#dialog-title')).toHaveText('正規表現のサンプル');
  await expect(page.locator('#regex-reference')).toHaveCount(0);
  const example=page.locator('.regex-sample').filter({hasText:'連続する改行を1つに'});
  await expect(example).toContainText('検索');
  await expect(example).toContainText('置換');
  await expect(example).toContainText('$1');
});

test('the line-break example preserves each first line ending and supports undo',async({page})=>{
  const before='a\r\nb\r\n\r\nc\n\n\nd\re\r\rf';
  const after='a\r\nb\r\nc\nd\re\rf';
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'notes.txt',text,savedText:text,needsInitialSave:false}),before);
  await page.keyboard.press('Control+h');
  await page.getByRole('button',{name:'正規表現のサンプル',exact:true}).click();
  await page.locator('.regex-sample').filter({hasText:'連続する改行を1つに'}).click();
  await expect(page.locator('#find-regex')).toBeChecked();
  await expect(page.locator('#replace-text')).toHaveValue('$1');
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(before);
  await page.getByRole('button',{name:'すべて置換',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe(after);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe(before);
});
