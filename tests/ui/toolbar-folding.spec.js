import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit);
});

test('toolbar sections can be folded and restored without losing tabs or actions', async ({page}) => {
  await page.getByRole('button', {name: '新規作成 · Ctrl+N', exact: true}).click();
  await expect(page.locator('.tabbar .tab')).toHaveCount(2);

  const actions = page.getByRole('button', {name: '操作を折りたたむ'});
  await actions.click();
  await expect(page.getByRole('button', {name: '操作を展開'})).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-cmd="open"]')).toBeHidden();
  await page.getByRole('button', {name: '操作を展開'}).click();
  await expect(page.locator('[data-cmd="open"]')).toBeVisible();

  await page.getByRole('button', {name: '書式を折りたたむ'}).click();
  await expect(page.locator('.formatbar')).toBeHidden();
  await expect(page.locator('.formatbar [data-cmd="bold"]')).toBeHidden();
  await page.getByRole('button', {name: '書式を展開'}).click();
  await expect(page.locator('.formatbar [data-cmd="bold"]')).toBeVisible();

  await page.getByRole('button', {name: 'タブを折りたたむ'}).click();
  await expect(page.locator('.tabbar')).toBeHidden();
  await page.getByRole('button', {name: 'タブを展開'}).click();
  await expect(page.locator('.tabbar .tab')).toHaveCount(2);
  await expect(page.locator('.tabbar')).toBeVisible();
});

test('folded sections release their full height and restore controls stay accessible', async ({page}) => {
  for (const width of [400, 700, 1280]) {
    await page.setViewportSize({width, height: 800});
    const workspace = page.locator('.workspace');
    for (const [label, section] of [['タブ','.tabbar-row'], ['書式','.formatbar']]) {
      const before=await workspace.boundingBox();
      const sectionBefore=await page.locator(section).boundingBox();
      await page.getByRole('button',{name:`${label}を折りたたむ`}).click();
      await expect(page.locator(section)).toBeHidden();
      const after=await workspace.boundingBox();
      // The collapsed row has no box. On narrow screens the adjacent toolbar
      // can reflow slightly as it makes room for the overlaid drawer.
      expect(await page.locator(section).boundingBox()).toBeNull();
      expect(before.y-after.y).toBeGreaterThan(0);
      expect(after.height-before.height).toBeGreaterThan(0);
      expect(before.y-after.y).toBeGreaterThanOrEqual(sectionBefore.height-10);
      const restore=page.getByRole('button',{name:`${label}を展開`});
      await expect(restore).toBeVisible();
      await restore.click();
      await expect(page.locator(section)).toBeVisible();
    }
    const before=await workspace.boundingBox();
    await page.getByRole('button',{name:'操作を折りたたむ'}).click();
    const after=await workspace.boundingBox();
    // At widths where controls wrapped onto additional rows the workspace grows.
    expect(after.height).toBeGreaterThanOrEqual(before.height);
    if(width<=1280) expect(after.height).toBeGreaterThan(before.height);
    await page.getByRole('button',{name:'操作を展開'}).click();
  }
});

test('section toggles remain keyboard accessible at narrow widths', async ({page}) => {
  await page.setViewportSize({width: 700, height: 800});
  const toggle = page.getByRole('button', {name: '書式を折りたたむ'});
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: '書式を展開'})).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', {name: '書式を展開'}).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', {name: '書式を折りたたむ'})).toHaveAttribute('aria-expanded', 'true');
});

test('all sections can be folded at once and restored independently', async ({page}) => {
  await page.setViewportSize({width:700,height:800});
  const initial=await page.locator('.workspace').boundingBox();
  for(const label of ['タブ','書式','操作']) await page.getByRole('button',{name:`${label}を折りたたむ`}).click();
  await expect(page.locator('.tabbar-row')).toBeHidden();
  await expect(page.locator('.formatbar')).toBeHidden();
  const folded=await page.locator('.workspace').boundingBox();
  expect(folded.height).toBeGreaterThan(initial.height+80);
  for(const label of ['書式','タブ','操作']){
    await page.getByRole('button',{name:`${label}を展開`}).click();
    await expect(page.getByRole('button',{name:`${label}を折りたたむ`})).toBeVisible();
  }
});

test('collapsed drawers stay at their original boundaries and do not block pane controls', async ({page}) => {
  await page.setViewportSize({width:1280,height:800});
  for (const label of ['タブ','書式','操作']) await page.getByRole('button',{name:`${label}を折りたたむ`}).click();
  await page.waitForFunction(() => document.querySelector('.workspace').hasAttribute('data-fold-reserved'));
  const drawers=page.locator('.fold-edge:not([hidden])');
  await expect(drawers).toHaveCount(3);
  const geometry=await drawers.evaluateAll(nodes => nodes.map(node => {
    const anchor=node.getBoundingClientRect(), button=node.firstElementChild.getBoundingClientRect();
    return {anchor:anchor.toJSON(),button:button.toJSON()};
  }));
  for (const {anchor,button} of geometry) {
    expect(anchor.height).toBe(0);
    expect(button.top).toBeGreaterThanOrEqual(anchor.top);
    expect(button.top-anchor.top).toBeLessThan(5);
    expect(button.right).toBeLessThanOrEqual(1280);
  }
  for (let i=0;i<geometry.length;i++) for (let j=i+1;j<geometry.length;j++) {
    const a=geometry[i].button,b=geometry[j].button;
    const intersects=a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
    expect(intersects).toBe(false);
  }
  const paneButton=page.locator('[data-cmd="popout-preview"]');
  await expect(paneButton).toBeVisible();
  expect(await paneButton.evaluate(node => {
    const r=node.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return node.contains(hit);
  })).toBe(true);
  await page.getByRole('button',{name:'書式を展開'}).click();
  await expect(page.locator('.formatbar')).toBeVisible();
  await page.getByRole('button',{name:'タブを展開'}).click();
  await expect(page.locator('.tabbar-row')).toBeVisible();
  await page.getByRole('button',{name:'操作を展開'}).click();
  await expect(page.locator('[data-cmd="open"]')).toBeVisible();
});

test('drawers follow visible rows when search or file type changes', async ({page}) => {
  await page.setViewportSize({width:900,height:800});
  await page.getByRole('button',{name:'書式を折りたたむ'}).click();
  await page.getByRole('button',{name:'タブを折りたたむ'}).click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#search-panel')).toBeVisible();
  await expect(page.getByRole('button',{name:'書式を展開'})).toBeVisible();
  await page.getByRole('button',{name:'検索を閉じる'}).click();
  await page.getByRole('button',{name:'タブを展開'}).click();
  await page.locator('#new-format').selectOption('txt');
  await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();
  await expect(page.locator('[data-fold-anchor="format"]')).toBeHidden();
  await page.locator('#new-format').selectOption('md');
  await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();
  await expect(page.getByRole('button',{name:'書式を展開'})).toBeVisible();
  await page.getByRole('button',{name:'書式を展開'}).click();
  await expect(page.locator('.formatbar')).toBeVisible();
});

test('restore handles leave the status controls accessible in narrow Discord mode', async ({page}) => {
  await page.setViewportSize({width:400,height:800});
  await page.locator('[data-cmd="mode-discord"]').click();
  await page.evaluate(()=>window.__mdSplit.setText('a'.repeat(12000)));
  await page.evaluate(()=>window.__mdSplit.editor().dispatch({changes:{from:0,insert:'!'}}));
  for(const label of ['タブ','書式','操作']) await page.getByRole('button',{name:`${label}を折りたたむ`}).click();
  await expect(page.locator('#save-state')).toHaveAttribute('title','未保存の変更');
  const saved=await page.locator('#save-state').boundingBox();
  expect(saved.height).toBeLessThan(28);
  expect(await page.locator('#save-state').evaluate(node=>getComputedStyle(node,'::after').content)).toContain('未保存');
  const buttons=page.locator('#line-endings, #encoding, .discord-controls button');
  for(const button of await buttons.all()){
    if(!(await button.isVisible())) continue;
    const r=await button.boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x+r.width).toBeLessThanOrEqual(400);
    expect(r.width).toBeGreaterThan(30);
    const layout=await button.evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth}));
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);
  }
  const r=await page.locator('.discord-controls').boundingBox();
  expect(r.x+r.width).toBeLessThanOrEqual(400);
  // Windows fonts can be wider than Linux. Check extra width pressure, too.
  await page.addStyleTag({content:'.statusbar {font-size: 13px !important} .statusbar .encoding-button, .statusbar .discord-controls select {font-size: 13px !important}'});
  for(const selector of ['#line-endings','#encoding','#show-chunks','#zoom-label']){
    const rect=await page.locator(selector).boundingBox();
    expect(rect.x+rect.width,selector).toBeLessThanOrEqual(400);
  }
  await page.setViewportSize({width:320,height:800});
  for(const selector of ['#save-state','#line-endings','#encoding','#show-chunks']){
    const node=page.locator(selector), rect=await node.boundingBox();
    expect(rect.x,selector).toBeGreaterThanOrEqual(0);
    expect(rect.x+rect.width,selector).toBeLessThanOrEqual(320);
  }
  await expect(page.locator('#show-chunks')).toHaveAttribute('title','分割してコピー');
  for(const label of ['操作','タブ','書式']) await expect(page.getByRole('button',{name:`${label}を展開`})).toBeVisible();
  await page.locator('#line-endings').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('fold buttons stay at the right of their section and remain available when folded', async ({page}) => {
  for (const width of [400,700,1400]) {
    await page.setViewportSize({width,height:800});
    for (const [key, section] of [['actions','.topbar'],['format','.formatbar'],['tabs','.tabbar-row']]) {
      const button=page.locator(`[data-fold-toggle="${key}"]`);
      const box=await button.boundingBox();
      const parent=await page.locator(section).boundingBox();
      expect(box.x+box.width).toBeLessThanOrEqual(parent.x+parent.width+1);
      expect(parent.x+parent.width-(box.x+box.width)).toBeLessThan(30);
      await button.click();
          await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded','false');
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded','true');
    }
  }
});

test('tab fold control stays visible while the tab list overflows and is redrawn', async ({page}) => {
  await page.setViewportSize({width:500,height:800});
  for(let i=0;i<8;i++) await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();
  const toggle=page.getByRole('button',{name:'タブを折りたたむ'});
  await expect(toggle).toBeVisible();
  expect((await toggle.boundingBox()).x+(await toggle.boundingBox()).width).toBeLessThanOrEqual(500);
  await toggle.click();
  await expect(page.getByRole('button',{name:'タブを展開'})).toBeVisible();
  await page.getByRole('button',{name:'タブを展開'}).click();
  await expect(page.locator('.tabbar .tab')).toHaveCount(9);
});
