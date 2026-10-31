import {test,expect} from '@playwright/test';

test('CSV common actions use accessible icons with explanatory tooltips',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit?.openDocument);
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'icons.csv',path:'C:\\synthetic\\icons.csv',text:'Name,Value\r\nAlice,1\r\n',savedText:'Name,Value\r\nAlice,1\r\n',encoding:'utf8',hasBom:false}));
  for(const label of ['表示設定','選択を非表示','行・列を削除','非表示をすべて解除','表示設定を保存','表示設定を読込']) {
    const button=page.getByRole('button',{name:label,exact:true});
    await expect(button).toHaveAttribute('title',label);
    await expect(button.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(button).toHaveText('');
  }
  await page.getByRole('button',{name:'表示設定',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'CSVの表示設定',exact:true})).toBeVisible();
});
