import {test,expect} from '@playwright/test';

test('column addresses coexist with editable CSV headers, can be changed, and are retained in sidecar exports',async({page})=>{
  await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true}));});
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'labels.csv',path:'C:\\synthetic\\labels.csv',text:'Name,Value\nAlice,2',savedText:'Name,Value\nAlice,2',encoding:'utf8',hasBom:false}));
  const header=page.locator('#text-preview thead [data-select-column="0"]');
  await expect(header.locator('.csv-column-label')).toHaveText('A');
  await expect(header.locator('.csv-cell-content')).toHaveText('Name');
  await expect(page.getByRole('button',{name:'表全体を選択'})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'1行を選択'})).toHaveCount(1);
  await page.getByRole('button',{name:'表示設定',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CSVの表示設定'});
  await dialog.locator('#csv-column-label').selectOption('numbers');await dialog.getByRole('button',{name:'適用'}).click();
  await expect(header.locator('.csv-column-label')).toHaveText('1');
  await expect(header.locator('.csv-cell-content')).toHaveText('Name');
  expect(await page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'表示設定を保存',exact:true}).click();
  const file=await download;const stream=await file.createReadStream();let data='';for await(const part of stream)data+=part.toString();
  expect(JSON.parse(data).view.columnLabel).toBe('numbers');
  await page.getByLabel('先頭行を見出しにする').uncheck();
  await expect(page.locator('#text-preview thead [data-select-column="0"]')).toHaveText('1');
});
