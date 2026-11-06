import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const appVersion=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version;

test('the display title uses MD-CSV Split Editor while retaining the existing icon',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  await expect(page.locator('.editor-panes')).toHaveAttribute('data-view','split');
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'brand.csv',path:'C:\\synthetic\\brand.csv',text:'Name,Value\nExample,1',savedText:'Name,Value\nExample,1',needsInitialSave:false}));
  await expect(page.locator('.brand>span')).toHaveText('MD-CSV Split Editor');
  await expect(page).toHaveTitle('brand.csv — MD-CSV Split Editor');
  await expect(page.locator('.brand img')).toHaveAttribute('src','./icon.svg');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.locator('#settings-current-version')).toHaveText('現在のバージョン：'+appVersion);
});
