import {test,expect} from '@playwright/test';

test('file menu exposes the one-time exit choices and closes with Escape',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const menu=page.locator('.session-menu'),summary=page.getByText('ファイル',{exact:true}).first();
  await summary.click();await expect(menu).toHaveAttribute('open','');
  await expect(menu.getByRole('button',{name:'次回は新規ファイルで開始'})).toBeVisible();
  await expect(menu.getByRole('button',{name:'全タブを次回開く'})).toBeVisible();
  await expect(menu.getByRole('button',{name:'表示中のタブだけを次回開く'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(menu).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();
  await summary.click();await page.locator('.statusbar').click({position:{x:5,y:5}});await expect(menu).not.toHaveAttribute('open');
});

test('file menu remains visible and fits the narrow window',async({page})=>{
  await page.setViewportSize({width:400,height:700});await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  const summary=page.getByText('ファイル',{exact:true}).first();await summary.click();
  const box=await page.locator('.session-menu-list').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(400);
});
