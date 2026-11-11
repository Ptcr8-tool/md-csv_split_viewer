import {test,expect} from '@playwright/test';

for (const [label,saved,expected] of [
  ['new settings', {welcomeShown:true}, [true,true,true,false]],
  ['saved choices', {welcomeShown:true,showLineBreaks:false,showFullWidthSpaces:false,showTabs:false,showSpaces:true}, [false,false,false,true]]
]) {
  test('whitespace markers use '+label,async({page})=>{
    await page.addInitScript(value=>localStorage.setItem('mdsplit.settings',JSON.stringify(value)),saved);
    await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
    await page.getByRole('button',{name:'設定',exact:true}).click();
    for (const [i,id] of ['#setting-line-breaks','#setting-wide-spaces','#setting-tabs','#setting-spaces'].entries()) {
      if(expected[i]) await expect(page.locator(id)).toBeChecked();
      else await expect(page.locator(id)).not.toBeChecked();
    }
  });
}
