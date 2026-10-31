import {test,expect} from '@playwright/test';

async function openEditor(page, width) {
  await page.setViewportSize({width,height:800});
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit);
  await page.evaluate(()=>window.__mdSplit.setText('# 見出し\n\n本文'));
  await expect(page.locator('.outline-jump')).toHaveText(['見出し']);
}

test('outline can be hidden from its header and reopened from the editor edge',async({page})=>{
  await openEditor(page,1400);
  const outline=page.locator('#outline-panel');
  const hide=page.getByRole('button',{name:'見出しナビを隠す',exact:true});
  const open=page.getByRole('button',{name:'見出しナビを開く',exact:true});
  await expect(outline).toBeVisible();
  await expect(hide).toBeVisible();
  await hide.click();
  await expect(outline).toBeHidden();
  await expect(open).toBeVisible();
  await open.click();
  await expect(outline).toBeVisible();
  await expect(page.locator('.outline-jump')).toHaveText(['見出し']);
});

test('a narrow window starts without the outline and the edge control opens and closes it',async({page})=>{
  await openEditor(page,600);
  const outline=page.locator('#outline-panel');
  const open=page.getByRole('button',{name:'見出しナビを開く',exact:true});
  await expect(outline).toBeHidden();
  await expect(open).toBeVisible();
  const label=await page.locator('.target-label').boundingBox();
  const handle=await open.boundingBox();
  expect(label).not.toBeNull();
  expect(handle).not.toBeNull();
  expect(handle.y).toBeGreaterThanOrEqual(label.y);
  expect(handle.x).toBeLessThan(90);
  await open.click();
  await expect(outline).toBeVisible();
  await expect(page.locator('.outline-jump')).toHaveText(['見出し']);
  await page.getByRole('button',{name:'見出しナビを隠す',exact:true}).click();
  await expect(outline).toBeHidden();
  await expect(open).toBeVisible();
});

test('the existing toolbar toggle keeps working with the new outline controls',async({page})=>{
  await openEditor(page,1400);
  const outline=page.locator('#outline-panel');
  const toolbar=page.getByRole('button',{name:'見出しナビゲーター',exact:true});
  await expect(outline).toBeVisible();
  await toolbar.click();
  await expect(outline).toBeHidden();
  await expect(page.getByRole('button',{name:'見出しナビを開く',exact:true})).toBeVisible();
  await toolbar.click();
  await expect(outline).toBeVisible();
});

test('the desktop outline preference remains saved across a reload',async({page})=>{
  await openEditor(page,1400);
  await page.getByRole('button',{name:'見出しナビを隠す',exact:true}).click();
  await expect(page.locator('#outline-panel')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')||'{}').fileTypeSettings?.markdown?.outlineVisible)).toBe(false);
  await page.reload();
  await page.waitForFunction(()=>window.__mdSplit);
  await expect(page.locator('#outline-panel')).toBeHidden();
  await page.getByRole('button',{name:'見出しナビを開く',exact:true}).click();
  await expect(page.locator('#outline-panel')).toBeVisible();
});

test('resizing only changes responsive visibility, not the saved outline preference',async({page})=>{
  await openEditor(page,1400);
  const outline=page.locator('#outline-panel');
  const preference=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')||'{}').fileTypeSettings?.markdown?.outlineVisible??null);
  await expect(outline).toBeVisible();
  const before=await preference();
  await page.setViewportSize({width:600,height:800});
  await expect(outline).toBeHidden();
  expect(await preference()).toBe(before);
  await expect(page.getByRole('button',{name:'見出しナビを開く',exact:true})).toBeVisible();
  await page.setViewportSize({width:1400,height:800});
  await expect(outline).toBeVisible();
  expect(await preference()).toBe(before);
});

test('plain text and CSV do not show the outline drawer control',async({page})=>{
  await openEditor(page,1400);
  for(const [name,text] of [['note.txt','# literal'],['table.csv','Name,Value\nA,1']]) {
    await page.evaluate(({name,text})=>window.__mdSplit.openDocument({encoding:'utf8',hasBom:false,name,text}),{name,text});
    await expect(page.locator('#outline-panel')).toBeHidden();
    await expect(page.getByRole('button',{name:'見出しナビを開く',exact:true})).toBeHidden();
  }
});

test('a detached source pane does not show an outline drawer',async({page})=>{
  await openEditor(page,1400);
  const opened=page.waitForEvent('popup');
  await page.getByRole('button',{name:'原文を別ウィンドウで開く',exact:true}).click();
  const child=await opened;
  await child.waitForFunction(()=>window.__mdSplit);
  await expect(child.locator('#outline-panel')).toBeHidden();
  await expect(child.getByRole('button',{name:'見出しナビを開く',exact:true})).toBeHidden();
});
