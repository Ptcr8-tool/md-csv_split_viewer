import {test,expect} from '@playwright/test';

test('file menu groups actions and nests the one-time exit choices',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const menu=page.locator('.session-menu'),summary=page.getByText('ファイル',{exact:true}).first();
  await summary.click();await expect(menu).toHaveAttribute('open','');
  await expect(menu.getByText('新規・開く',{exact:true})).toBeVisible();
  await expect(menu.getByText('保存',{exact:true})).toBeVisible();
  await expect(menu.getByText('タブ',{exact:true})).toBeVisible();
  const exit=menu.locator('.session-menu-exit'),exitSummary=exit.locator('summary');
  await expect(exit.getByRole('button',{name:'次回は新規ファイルで開始',includeHidden:true})).toBeHidden();
  await exitSummary.click();await expect(exit).toHaveAttribute('open','');
  await expect(menu.getByRole('button',{name:'次回は新規ファイルで開始'})).toBeVisible();
  await expect(menu.getByRole('button',{name:'全タブを次回開く'})).toBeVisible();
  await expect(menu.getByRole('button',{name:'表示中のタブだけを次回開く'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(exit).not.toHaveAttribute('open');await expect(menu).toHaveAttribute('open','');await expect(exitSummary).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();
  await summary.click();await page.locator('.statusbar').click({position:{x:5,y:5}});await expect(menu).not.toHaveAttribute('open');
});

test('file menu remains visible and fits the narrow window',async({page})=>{
  await page.setViewportSize({width:400,height:700});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const summary=page.getByText('ファイル',{exact:true}).first();await summary.click();
  const box=await page.locator('.session-menu-list').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(400);
  expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(700);
});
