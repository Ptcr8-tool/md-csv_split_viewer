import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'controls.md',path:'C:\\synthetic\\controls.md',text:'# Title\n\nbody',savedText:'# Title\n\nbody',needsInitialSave:false}));
});

test('header brightness controls persist the selection and follow live system changes',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('[data-cmd="theme-light"]').click();
  await expect(page.locator(':root')).toHaveAttribute('data-theme','light');
  await expect(page.locator('[data-cmd="theme-light"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-cmd="theme-dark"]').click();
  await expect(page.locator(':root')).toHaveAttribute('data-theme','dark');
  await page.locator('[data-cmd="theme-system"]').click();
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator(':root')).toHaveAttribute('data-theme','light');
  await expect(page.locator('[data-cmd="theme-system"]')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).theme)).toBe('system');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('parchment disables header brightness controls and returning to normal restores preference',async({page})=>{
  await page.locator('[data-cmd="theme-dark"]').click();
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByRole('radio',{name:'テーマカラー：羊皮紙',exact:true}).check();
  await page.getByRole('button',{name:'適用',exact:true}).click();
  for(const value of ['light','dark','system'])await expect(page.locator(`[data-cmd="theme-${value}"]`)).toBeDisabled();
  await expect(page.locator(':root')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByRole('radio',{name:'テーマカラー：黒（標準）',exact:true}).check();
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.locator('[data-cmd="theme-dark"]')).toBeEnabled();
  await expect(page.locator('[data-cmd="theme-dark"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator(':root')).toHaveAttribute('data-theme','dark');
});

test('header view toggles expose selection and keep controls inside a narrower window',async({page})=>{
  await page.setViewportSize({width:1000,height:800});
  for(const value of ['source','preview','split']){
    const button=page.locator(`[data-cmd="view-${value}"]`);await button.click();
    await expect(button).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.editor-panes')).toHaveAttribute('data-view',value);
  }
  const visible=await page.locator('.topbar button:visible').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;}));
  expect(visible).toBe(true);
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
});

test('wrapped header controls stay inside the header and above the tabs',async({page})=>{
  for(const width of [1000,910,800,600,400]){
    await page.setViewportSize({width,height:800});
    const layout=await page.evaluate(()=>{
      const header=document.querySelector('.topbar').getBoundingClientRect();
      const tabs=document.querySelector('.tabbar').getBoundingClientRect();
      const controls=[...document.querySelectorAll('.topbar button, .topbar select')]
        .filter(node=>node.getClientRects().length)
        .map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
      return {header:{left:header.left,right:header.right,top:header.top,bottom:header.bottom},tabsTop:tabs.top,controls};
    });
    expect(layout.tabsTop,`tabs overlap header at ${width}px`).toBeGreaterThanOrEqual(layout.header.bottom-0.1);
    for(const control of layout.controls){
      expect(control.left).toBeGreaterThanOrEqual(layout.header.left);
      expect(control.right).toBeLessThanOrEqual(layout.header.right);
      expect(control.top).toBeGreaterThanOrEqual(layout.header.top);
      expect(control.bottom).toBeLessThanOrEqual(layout.header.bottom);
    }
    await page.locator('[data-cmd="view-source"]').click();
    await expect(page.locator('.editor-panes')).toHaveAttribute('data-view','source');
  }
});


test('detached editor header grows if its controls wrap',async({page})=>{
  await page.evaluate(()=>{document.documentElement.dataset.paneWindow='source';});
  await page.setViewportSize({width:320,height:800});
  const layout=await page.evaluate(()=>{
    const header=document.querySelector('.topbar').getBoundingClientRect();
    const next=document.querySelector('.formatbar').getBoundingClientRect();
    const controls=[...document.querySelectorAll('.topbar button, .topbar select')]
      .filter(node=>node.getClientRects().length)
      .map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
    return {bottom:header.bottom,nextTop:next.top,controls};
  });
  expect(layout.nextTop).toBeGreaterThanOrEqual(layout.bottom-0.1);
  for(const control of layout.controls){
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(320);
    expect(control.bottom).toBeLessThanOrEqual(layout.bottom);
  }
});

test('search and replace button and scroll sync linked or broken icons are accessible and reflect state',async({page})=>{
  const search=page.getByRole('button',{name:'検索・置換 · Ctrl+F',exact:true});
  await expect(search.locator('svg')).toBeVisible();
  await expect(search.locator('svg path')).toHaveCount(1);
  const sync=page.getByRole('button',{name:'スクロール連動を切り替え',exact:true});
  await expect(sync).toHaveAttribute('aria-pressed','true');
  await expect(sync.locator('.sync-linked')).toBeVisible();
  await expect(sync.locator('.sync-unlinked')).toBeHidden();
  await sync.click();
  await expect(sync).toHaveAttribute('aria-pressed','false');
  await expect(sync.locator('.sync-linked')).toBeHidden();
  await expect(sync.locator('.sync-unlinked')).toBeVisible();
  await sync.click();
  await expect(sync).toHaveAttribute('aria-pressed','true');
  await expect(sync.locator('.sync-linked')).toBeVisible();
});
