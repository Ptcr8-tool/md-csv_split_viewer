import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/');
  await page.waitForFunction(()=>window.__mdSplit);
});
const setText=(page,text)=>page.evaluate(text=>window.__mdSplit.setText(text),text);
const getText=page=>page.evaluate(()=>window.__mdSplit.getText());
const sourceSelect=(page,from)=>page.evaluate(from=>{
  const editor=window.__mdSplit.editor();
  editor.dispatch({selection:{anchor:from}});
  editor.focus();
},from);

async function assertSeparateBlankLines(locator,count){
  await expect(locator).toHaveCount(count);
  const positions=await locator.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
  for(let i=1;i<positions.length;i++)expect(positions[i]-positions[i-1]).toBeGreaterThan(20);
}

test('repeated source Enter inserts each blank line into the preview',async({page})=>{
  await setText(page,'alpha\nbeta');
  await sourceSelect(page,'alpha'.length);
  for(let count=1;count<=3;count++){
    await page.keyboard.press('Enter');
    const expected='alpha'+'\n'.repeat(count+1)+'beta';
    await expect.poll(()=>getText(page)).toBe(expected);
    await assertSeparateBlankLines(page.locator('#preview > .source-blank-line'),count);
  }
  expect(await getText(page)).toBe('alpha\n\n\n\nbeta');
});

test('source Enter and quote markers retain each blank quoted line in the preview',async({page})=>{
  await setText(page,'> alpha\n> beta');
  for(let count=1;count<=3;count++){
    // Enter on a nonempty quote automatically continues its marker. Reposition
    // before each Enter so the empty-quote exit command is not invoked.
    await sourceSelect(page,'> alpha'.length);
    await page.keyboard.press('Enter');
    const expected='> alpha\n'+'> \n'.repeat(count)+'> beta';
    await expect.poll(()=>getText(page)).toBe(expected);
    await assertSeparateBlankLines(page.locator('#preview blockquote > .source-blank-line'),count);
  }
  expect(await getText(page)).toBe('> alpha\n> \n> \n> \n> beta');
  await expect(page.locator('#preview blockquote')).toHaveCount(1);
});
