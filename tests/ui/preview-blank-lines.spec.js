import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);});
const setText=(page,text)=>page.evaluate(text=>window.__mdSplit.setText(text),text);
const getText=page=>page.evaluate(()=>window.__mdSplit.getText());

test('consecutive source blank lines are visible as separate editable lines',async({page})=>{
  await setText(page,'alpha\n\nbeta');
  let before=await page.locator('#preview').getByText('beta',{exact:true}).evaluate(n=>n.getBoundingClientRect().top);
  await setText(page,'alpha\n\n\n\nbeta');
  const blank=page.locator('#preview > .source-blank-line');
  await expect(blank).toHaveCount(3);
  const tops=await blank.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
  expect(tops[1]-tops[0]).toBeGreaterThan(20);
  expect(tops[2]-tops[1]).toBeGreaterThan(20);
  const after=await page.locator('#preview').getByText('beta',{exact:true}).evaluate(n=>n.getBoundingClientRect().top);
  expect(after-before).toBeGreaterThan(40);
  expect(await getText(page)).toBe('alpha\n\n\n\nbeta');
  await blank.nth(1).click({position:{x:2,y:10}});
  await page.keyboard.insertText('X');
  expect(await getText(page)).toBe('alpha\n\nX\n\nbeta');
});

test('blank quoted lines stay within their block and are editable',async({page})=>{
  const raw='> alpha\n>\n>\n> beta';await setText(page,raw);
  const blank=page.locator('#preview blockquote > .source-blank-line');
  await expect(blank).toHaveCount(2);
  const tops=await blank.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
  expect(tops[1]-tops[0]).toBeGreaterThan(20);
  expect(await getText(page)).toBe(raw);
  await blank.first().click({position:{x:2,y:10}});await page.keyboard.insertText('X');
  expect(await getText(page)).toBe('> alpha\n>X\n>\n> beta');
});

test('blank lines preserve CRLF positions, beginning and trailing lines',async({page})=>{
  const raw='\r\nalpha\r\n\r\n\r\nbeta\r\n';await setText(page,raw);
  const blank=page.locator('#preview > .source-blank-line');
  await expect(blank).toHaveCount(4);
  expect(await blank.evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.from)))).toEqual([0,9,11,19]);
  expect(await getText(page)).toBe(raw);
});

test('blank lines in fenced code are not rendered twice',async({page})=>{
  const raw='```text\nalpha\n\n\nbeta\n```';await setText(page,raw);
  await expect(page.locator('#preview .code-block')).toContainText('alpha');
  await expect(page.locator('#preview .source-blank-line')).toHaveCount(0);
  expect(await getText(page)).toBe(raw);
});

test('blank list lines remain in valid list structure',async({page})=>{
  const raw='- alpha\n\n- beta';await setText(page,raw);
  await expect(page.locator('#preview ul > li')).toHaveCount(2);
  await expect(page.locator('#preview ul > .source-blank-line')).toHaveCount(0);
  await expect(page.locator('#preview ul > li > .source-blank-line')).toHaveCount(1);
  expect(await getText(page)).toBe(raw);
});

test('blank lines follow heading fold visibility and source text stays intact',async({page})=>{
  const raw='# Parent\n\n\ninside\n\n# Next';await setText(page,raw);
  await expect(page.locator('#preview > .source-blank-line')).toHaveCount(3);
  await page.getByRole('button',{name:'折りたたむ: Parent',exact:true}).click();
  await expect(page.locator('#preview').getByText('inside',{exact:true})).toBeHidden();
  await expect(page.locator('#preview > .source-blank-line').first()).toBeHidden();
  expect(await getText(page)).toBe(raw);
});
