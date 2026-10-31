import {test,expect} from '@playwright/test';

const ready=page=>page.waitForFunction(()=>window.__mdSplit?.openDocument);
const open=(page,name)=>page.evaluate(name=>window.__mdSplit.openDocument({name,path:'C:\\synthetic\\'+name,text:name.endsWith('.md')?'# Title':'A,B\nC,D',needsInitialSave:false}),name);
const view=(page,mode)=>expect(page.locator('.editor-panes')).toHaveAttribute('data-view',mode);
const choose=(page,mode)=>page.locator(`[data-cmd="view-${mode}"]`).click();

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('mdsplit.settings'))localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});
  await page.goto('/');await ready(page);
});

test('the last manually selected view is reused independently per kind across relaunch',async({page})=>{
  await open(page,'first.md');await choose(page,'preview');await view(page,'preview');
  await open(page,'second.csv');await view(page,'split');await choose(page,'source');
  await open(page,'third.md');await view(page,'preview');
  await page.reload();await ready(page);await open(page,'reopened.csv');await view(page,'source');await open(page,'reopened.md');await view(page,'preview');await open(page,'separate.tsv');await view(page,'split');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).fileTypeSettings.csv.viewMode)).toBe('source');
});

test('explicit per-kind default wins for new files while existing tabs keep their chosen view',async({page})=>{
  await open(page,'fixed.md');await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.locator('#setting-view-mode').selectOption('preview');await page.getByRole('button',{name:'適用',exact:true}).click();await view(page,'preview');
  await choose(page,'source');await view(page,'source');await open(page,'new.csv');await view(page,'split');
  await page.getByRole('button',{name:'fixed.md',exact:true}).click();await view(page,'source');await open(page,'new.md');await view(page,'preview');
  await page.reload();await ready(page);await open(page,'reopened.md');await view(page,'preview');await open(page,'reopened.csv');await view(page,'split');
});

test('plain text stays source-only and does not erase any remembered kind view',async({page})=>{
  await open(page,'before.csv');await choose(page,'preview');await open(page,'plain.txt');await view(page,'source');
  await expect(page.locator('.view-controls')).toBeHidden();await open(page,'after.md');await view(page,'split');await open(page,'after.csv');await view(page,'preview');
});

test('settings can configure supported file kinds from a plain text tab without cross-kind leakage',async({page})=>{
  await open(page,'settings.txt');await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.locator('#setting-file-kind').selectOption('markdown');await page.locator('#setting-view-mode').selectOption('preview');await page.locator('#setting-outline').uncheck();await page.locator('#setting-sync').uncheck();
  await page.locator('#setting-file-kind').selectOption('csv');await expect(page.locator('#setting-outline')).toBeDisabled();await expect(page.locator('#setting-sync')).toBeEnabled();await page.locator('#setting-view-mode').selectOption('source');await page.locator('#setting-sync').check();
  await page.locator('#setting-file-kind').selectOption('tsv');await page.locator('#setting-view-mode').selectOption('split');await page.locator('#setting-sync').uncheck();
  await page.locator('#setting-file-kind').selectOption('html');await expect(page.locator('#setting-outline')).toBeEnabled();await page.locator('#setting-outline').check();await expect(page.locator('#setting-sync')).toBeDisabled();await page.locator('#setting-view-mode').selectOption('preview');
  await page.getByRole('button',{name:'適用',exact:true}).click();await view(page,'source');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).fileTypeSettings?.markdown?.defaultViewMode)).toBe('preview');
  await open(page,'configured.md');await view(page,'preview');await expect(page.locator('#outline-panel')).toBeHidden();await expect(page.locator('#sync-toggle')).toHaveAttribute('aria-pressed','false');
  await open(page,'configured.csv');await view(page,'source');await expect(page.locator('#sync-toggle')).toHaveAttribute('aria-pressed','true');
  await open(page,'configured.tsv');await view(page,'split');await expect(page.locator('#sync-toggle')).toHaveAttribute('aria-pressed','false');
  await open(page,'configured.html');await view(page,'preview');await expect(page.locator('#sync-toggle')).toBeHidden();await expect(page.locator('#outline-toggle')).toHaveAttribute('aria-pressed','true');
  await page.reload();await ready(page);await open(page,'reloaded.md');await view(page,'preview');await expect(page.locator('#outline-panel')).toBeHidden();await expect(page.locator('#sync-toggle')).toHaveAttribute('aria-pressed','false');await open(page,'reloaded.csv');await view(page,'source');
});
