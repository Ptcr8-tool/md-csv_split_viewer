import {test,expect} from '@playwright/test';

test('expanding a source fold placeholder updates preview and outline while retaining nested folds',async({page})=>{
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit);
  await page.evaluate(()=>window.__mdSplit.setText('# Parent\n\nparent body\n\n## Child\n\nchild body\n\n# Next\n\nnext body'));
  await page.getByRole('button',{name:'折りたたむ: Child',exact:true}).click();
  await page.getByRole('button',{name:'折りたたむ: Parent',exact:true}).click();
  await expect(page.locator('#preview').getByText('parent body')).toBeHidden();
  await expect(page.locator('#outline-tree').getByRole('button',{name:'開く: Parent',exact:true})).toHaveAttribute('aria-expanded','false');
  await page.locator('.cm-foldPlaceholder').first().dblclick();
  await expect(page.locator('#preview').getByText('parent body')).toBeVisible();
  await expect(page.locator('#outline-tree').getByRole('button',{name:'折りたたむ: Parent',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#preview h1').first().locator('.heading-fold')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#outline-tree').getByRole('button',{name:'開く: Child',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#preview').getByText('child body')).toBeHidden();
  await page.locator('.cm-foldPlaceholder').first().dblclick();
  await expect(page.locator('#preview').getByText('child body')).toBeVisible();
  await expect(page.locator('#outline-tree').getByRole('button',{name:'折りたたむ: Child',exact:true})).toHaveAttribute('aria-expanded','true');
  await page.getByRole('button',{name:'折りたたむ: Parent',exact:true}).click();
  await expect(page.locator('#preview').getByText('parent body')).toBeHidden();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
});
