import {test, expect} from '@playwright/test';

test('new CSV uses viewport alignment and keeps short values visible in a tall row', async ({page}) => {
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('mdsplit.settings', JSON.stringify({welcomeShown:true}));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit?.openDocument);
  const text='Name,Long\nAlice,"'+Array.from({length:140},(_,i)=>`Long line ${i}`).join('\n')+'"\nBob,last';
  await page.evaluate(text => window.__mdSplit.openDocument({name:'grid.csv',path:'C:\\synthetic\\grid.csv',text,savedText:text,encoding:'utf8',hasBom:false}), text);
  const cell=page.locator('#text-preview [data-cell-row="1"][data-cell-column="0"]');
  await expect(cell).toHaveClass(/csv-viewport-align/);
  await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定',exact:true});
  await expect(dialog.locator('#csv-vertical')).toHaveValue('viewport');
  await dialog.getByRole('button',{name:'キャンセル',exact:true}).click();
  const content=cell.locator('.csv-cell-content'),scroller=page.locator('#text-preview .text-preview-scroll');
  await scroller.evaluate(node=>{node.scrollTop=400;});
  await expect.poll(async()=>{const a=await content.boundingBox(),b=await scroller.boundingBox();return !!a&&!!b&&a.y>=b.y&&a.y+a.height<=b.y+b.height;}).toBe(true);
  expect(await page.evaluate(()=>window.__mdSplit.getText())).toBe(text);
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});
