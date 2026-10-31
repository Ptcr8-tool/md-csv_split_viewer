import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('mdsplit.settings', JSON.stringify({welcomeShown:true})));
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit);
});
const setText = (page, text) => page.evaluate(text => window.__mdSplit.setText(text), text);
const sourceCaret = async (page, position) => {
  await page.evaluate(position => {
    const cm = window.__mdSplit.editor();
    cm.dispatch({selection:{anchor:position}});
    cm.focus();
  }, position);
  // The indicator is measured on the next animation frame. Its old row may
  // already have the same count, so wait for the actual target text geometry
  // before taking a baseline for scrolling/resizing assertions.
  await page.waitForFunction(position => {
    const leaf = window.__mdSplit.renderer.leaves.find(leaf => leaf.from<=position && leaf.to>=position);
    if (!leaf) return false;
    const offset = Math.max(0, leaf.map.findIndex(n => n>=position));
    const range = document.createRange();
    range.setStart(leaf.node, Math.min(offset, leaf.node.length));
    range.setEnd(leaf.node, Math.min(offset+1, leaf.node.length));
    const text = range.getBoundingClientRect();
    const center = (text.top+text.bottom)/2;
    return Array.from(document.querySelectorAll('.preview-active-line-row')).some(node => {
      const row = node.getBoundingClientRect();
      return center>row.top && center<row.bottom;
    });
  }, position, {timeout:5000});
};
const rows = page => page.locator('.preview-active-line-row');
const geometry = page => page.evaluate(() => {
  const preview = document.querySelector('#preview');
  const box = preview.getBoundingClientRect();
  return {
    left:box.left, top:box.top, width:preview.clientWidth,
    rows:Array.from(document.querySelectorAll('.preview-active-line-row'), node => {
      const row = node.getBoundingClientRect();
      return {left:row.left, top:row.top, width:row.width, bottom:row.bottom};
    })
  };
});
const targetTop = (page, position) => page.evaluate(position => {
  const leaf = window.__mdSplit.renderer.leaves.find(leaf => leaf.from<=position && leaf.to>=position);
  const offset = Math.max(0, leaf.map.findIndex(n => n>=position));
  const range = document.createRange();
  range.setStart(leaf.node, Math.min(offset, leaf.node.length));
  range.setEnd(leaf.node, Math.min(offset+1, leaf.node.length));
  const box = range.getBoundingClientRect();
  return (box.top+box.bottom)/2;
}, position);

test('heading uses one full-width row without changing the text selection', async ({page}) => {
  const raw = '# A **bold** [linked](https://example.com) heading\n\nBody';
  await setText(page, raw);
  await sourceCaret(page, raw.indexOf('bold'));
  await expect(rows(page)).toHaveCount(1);
  const box = await geometry(page);
  expect(box.rows[0].left).toBeCloseTo(box.left, 0);
  expect(box.rows[0].width).toBeCloseTo(box.width, 0);
  const middle = await targetTop(page, raw.indexOf('bold'));
  expect(middle).toBeGreaterThan(box.rows[0].top);
  expect(middle).toBeLessThan(box.rows[0].bottom);
  await expect(page.locator('.preview-active-line-layer')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('.preview-active-line-layer').evaluate(n => getComputedStyle(n).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  expect(await page.evaluate(() => !!CSS.highlights.get('linked-active-line'))).toBe(false);
});

test('wrapped Markdown line gets separate full-width visual rows and follows resizing', async ({page}) => {
  const text = 'A long sentence with **bold words** and ordinary text. '.repeat(7);
  await setText(page, text+'\n\nNext paragraph');
  await sourceCaret(page, 4);
  await expect.poll(() => rows(page).count()).toBeGreaterThan(2);
  const before = await geometry(page);
  for (const row of before.rows) expect(row.width).toBeCloseTo(before.width, 0);
  for (let i=1; i<before.rows.length; i++) expect(before.rows[i].top).toBeGreaterThanOrEqual(before.rows[i-1].bottom-1);
  await page.setViewportSize({width:1050, height:900});
  await expect.poll(async () => (await geometry(page)).width).toBeLessThan(before.width);
  await expect.poll(async () => (await geometry(page)).rows[0]?.width).toBeCloseTo((await geometry(page)).width, 0);
  expect((await geometry(page)).rows.length).toBeGreaterThanOrEqual(before.rows.length);
});

for (const [kind, raw, word] of [
  ['list', '- Item with **bold** text\n- Another item', 'bold'],
  ['table', '| Name | Description |\n|---|---|\n| Item with **bold** | Other cell |', 'bold']
]) test(`${kind} inline leaves merge into one visual row`, async ({page}) => {
  await setText(page, raw);
  await sourceCaret(page, raw.indexOf(word));
  await expect(rows(page)).toHaveCount(1);
  const box = await geometry(page);
  const middle = await targetTop(page, raw.indexOf(word));
  expect(box.rows[0].width).toBeCloseTo(box.width, 0);
  expect(middle).toBeGreaterThan(box.rows[0].top);
  expect(middle).toBeLessThan(box.rows[0].bottom);
});

test('preview scrolling moves the row without changing either editor selection', async ({page}) => {
  const raw = Array.from({length:45}, (_,i) => `Paragraph ${i} body`).join('\n\n');
  await setText(page, raw);
  await page.getByRole('button', {name:'スクロール連動を切り替え', exact:true}).click();
  await sourceCaret(page, raw.indexOf('Paragraph 4'));
  await expect(rows(page)).toHaveCount(1);
  const before = await geometry(page);
  const selection = await page.evaluate(() => window.__mdSplit.editor().state.selection.main.from);
  await page.locator('#preview').evaluate(n => n.scrollTop=65);
  await expect.poll(async () => (await geometry(page)).rows[0]?.top).toBeCloseTo(before.rows[0].top-65, 0);
  expect(await page.evaluate(() => window.__mdSplit.editor().state.selection.main.from)).toBe(selection);
  expect(await page.evaluate(() => window.__mdSplit.getText())).toBe(raw);
});

test('changing the source caret updates the row while preserving preview scroll', async ({page}) => {
  const raw = Array.from({length:45}, (_,i) => `Paragraph ${i} body`).join('\n\n');
  await setText(page, raw);
  await page.locator('#preview').evaluate(n => n.scrollTop=140);
  await sourceCaret(page, raw.indexOf('Paragraph 5'));
  await expect(rows(page)).toHaveCount(1);
  const before = await geometry(page);
  const scroll = await page.locator('#preview').evaluate(n => n.scrollTop);
  await sourceCaret(page, raw.indexOf('Paragraph 6'));
  await expect.poll(async () => (await geometry(page)).rows[0]?.top).toBeGreaterThan(before.rows[0].top+10);
  expect(await page.locator('#preview').evaluate(n => n.scrollTop)).toBeCloseTo(scroll, 0);
});

test('an image completing above the active line updates its geometry', async ({page}) => {
  let pendingImage;
  await page.route('**/delayed-active-line.svg', route => {pendingImage=route;});
  const raw = '![fixture](/delayed-active-line.svg)\n\nTarget after the image\n\nTail';
  await setText(page, raw);
  await expect.poll(() => !!pendingImage).toBe(true);
  const position = raw.indexOf('Target');
  await sourceCaret(page, position);
  await expect(rows(page)).toHaveCount(1);
  const before = await geometry(page);
  await pendingImage.fulfill({contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#888"/></svg>'});
  await expect.poll(() => page.locator('#preview img').evaluate(n => n.naturalHeight)).toBe(160);
  await expect.poll(async () => (await geometry(page)).rows[0]?.top).toBeGreaterThan(before.rows[0].top+80);
  const after = await geometry(page);
  const middle = await targetTop(page, position);
  expect(middle).toBeGreaterThan(after.rows[0].top);
  expect(middle).toBeLessThan(after.rows[0].bottom);
});

test('line overlay stays outside rich copies and does not intercept typing', async ({page}) => {
  const raw = '# Heading\n\nEditable body';
  await setText(page, raw);
  await page.locator('#preview p').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('!');
  await expect.poll(() => page.evaluate(() => window.__mdSplit.getText())).toBe(raw+'!');
  await expect(rows(page)).toHaveCount(1);
  const copied = await page.evaluate(() => {
    const preview = document.querySelector('#preview');
    const range = document.createRange();
    range.selectNodeContents(preview);
    getSelection().removeAllRanges();getSelection().addRange(range);
    const data = new DataTransfer();
    preview.dispatchEvent(new ClipboardEvent('copy', {bubbles:true, cancelable:true, clipboardData:data}));
    return {text:data.getData('text/plain'), html:data.getData('text/html'), inside:!!preview.querySelector('.preview-active-line-layer')};
  });
  expect(copied.inside).toBe(false);
  expect(copied.text).toContain('Editable body!');
  expect(copied.html).toContain('<h1');
  expect(copied.html).not.toContain('preview-active-line');
  expect(copied.html).not.toContain('background');
});
