import {test,expect} from '@playwright/test';
import {settleScroll,waitForScrollReady} from './scroll-test-helpers.js';
const ready=page=>page.waitForFunction(()=>window.__mdSplit);
const setText=(page,text)=>page.evaluate(text=>window.__mdSplit.setText(text),text);
const text=page=>page.evaluate(()=>window.__mdSplit.getText());
async function start(page){await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));await page.goto('/');await ready(page);}
async function popup(page,side){const opened=page.waitForEvent('popup');await page.locator(`[data-cmd="popout-${side}"]`).click();const child=await opened;await ready(child);return child;}

test('first launch opens a complete offline editable guide once and help can reopen it',async({page})=>{
  await page.goto('/');await ready(page);expect(await page.evaluate(()=>window.__mdSplit.model().name)).toBe('MD-CSV Split Editor の使い方.md');
  await expect(page.locator('#preview img')).toHaveCount(1);expect(await page.locator('#preview img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  for(const feature of ['Discord','Mermaid','名前を付けて保存','正規表現'])expect(await text(page)).toContain(feature);
  await page.reload();await ready(page);expect(await text(page)).toBe('');await page.getByRole('button',{name:'使い方とショートカット',exact:true}).click();await page.getByRole('button',{name:'編集できるガイドを開く',exact:true}).click();await expect.poll(()=>text(page)).toContain('Mermaid');
});

test('view menu switches editable panes and retains outline and layout choices',async({page})=>{
  await start(page);await setText(page,'# Heading\n\nbody');
  await page.locator('[data-cmd="view-source"]').click();await expect(page.locator('.preview-pane')).toBeHidden();await expect(page.locator('.source-pane')).toBeVisible();
  await page.locator('[data-cmd="outline"]').click();await expect(page.locator('#outline-panel')).toBeHidden();await page.locator('[data-cmd="view-preview"]').click();await page.keyboard.press('Escape');await expect(page.locator('.source-pane')).toBeHidden();
  await page.evaluate(()=>window.__mdSplit.renderer.restoreSelection(window.__mdSplit.getText().length));await page.keyboard.insertText(' edited');await expect.poll(()=>text(page)).toContain('body edited');
  await page.locator('[data-cmd="view-split"]').click();await expect(page.locator('.source-pane')).toBeVisible();await expect(page.locator('.preview-pane')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).fileTypeSettings.markdown.outlineVisible)).toBe(false);
});

test('theme previews immediately; cancel restores it, and Apply stays visible while settings scroll',async({page})=>{
  await start(page);await page.setViewportSize({width:1100,height:600});await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByRole('radio',{name:'テーマカラー：青',exact:true}).check();await expect(page.locator(':root')).toHaveAttribute('data-palette','blue');
  const before=await page.locator('#modal .dialog-actions').boundingBox();await page.locator('#dialog-body').evaluate(n=>n.scrollTop=n.scrollHeight);const after=await page.locator('#modal .dialog-actions').boundingBox();expect(Math.abs(after.y-before.y)).toBeLessThan(2);await expect(page.getByRole('button',{name:'適用',exact:true})).toBeInViewport();
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator(':root')).toHaveAttribute('data-palette','black');
});

test('source popup shares edits, undo and document state with its owner',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);await setText(page,'# Shared\n\noriginal');const child=await popup(page,'source');child.on('pageerror',e=>errors.push(e.message));
  await expect(child.locator('.preview-pane')).toBeHidden();await child.locator('.cm-content').click();await child.keyboard.press('Control+End');await child.keyboard.insertText(' child');await expect.poll(()=>text(page)).toBe('# Shared\n\noriginal child');
  await page.bringToFront();await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' owner');await expect.poll(()=>text(child)).toBe('# Shared\n\noriginal child owner');
  await child.bringToFront();await child.getByRole('button',{name:'元に戻す · Ctrl+Z',exact:true}).click();await expect.poll(()=>text(page)).toBe('# Shared\n\noriginal');
  await child.close();expect(await text(page)).toBe('# Shared\n\noriginal');expect(errors).toEqual([]);
});

test('preview popup edits the shared model and search focuses its visible editor',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);await setText(page,'# Title\n\nneedle');const child=await popup(page,'preview');child.on('pageerror',e=>errors.push(e.message));
  await expect(child.locator('.source-pane')).toBeHidden();await child.evaluate(()=>window.__mdSplit.renderer.restoreSelection(window.__mdSplit.getText().length));await child.keyboard.insertText(' popup');await expect.poll(()=>text(page)).toBe('# Title\n\nneedle popup');
  await child.keyboard.press('Control+f');await child.locator('#find-text').fill('needle');await child.getByRole('button',{name:'次へ',exact:true}).click();await expect.poll(()=>child.evaluate(()=>document.activeElement.id)).toBe('preview');await child.keyboard.insertText('found');await expect.poll(()=>text(page)).toBe('# Title\n\nfound popup');expect(errors).toEqual([]);
});

test('popups stay with their document when owner changes tabs and close with that document',async({page})=>{
  await start(page);await setText(page,'document A');const a=await popup(page,'preview');await page.bringToFront();await page.keyboard.press('Control+n');await setText(page,'document B');const b=await popup(page,'preview');
  expect(await text(a)).toBe('document A');expect(await text(b)).toBe('document B');await a.evaluate(()=>window.__mdSplit.renderer.restoreSelection(10));await a.keyboard.insertText(' edited');expect(await text(page)).toBe('document B');
  await page.bringToFront();await page.locator('.tab-name').first().click();await expect.poll(()=>text(page)).toBe('document A edited');
  const closed=a.waitForEvent('close');await page.locator('.tab-close').first().click();await page.getByRole('button',{name:'保存せずに閉じる',exact:true}).click();await closed;expect(b.isClosed()).toBe(false);expect(await text(page)).toBe('document B');
});

test('peer input is blocked during source composition and resumes after confirmation',async({page})=>{
  await start(page);await setText(page,'keep');const child=await popup(page,'source');
  await child.locator('.cm-content').dispatchEvent('compositionstart',{data:''});await page.bringToFront();await page.evaluate(()=>window.__mdSplit.renderer.restoreSelection(4));await page.keyboard.insertText('blocked');expect(await text(page)).toBe('keep');
  await child.locator('.cm-content').dispatchEvent('compositionend',{data:''});await expect.poll(()=>child.evaluate(()=>window.__mdSplit.model().composing)).toBe(false);await page.keyboard.insertText(' accepted');await expect.poll(()=>text(child)).toBe('keep accepted');
});

test('popup scrolls follow the owner by paragraph and honor the scroll link toggle',async({page})=>{
  await start(page);await setText(page,Array.from({length:100},(_,i)=>`Paragraph ${i} content\n\n`).join(''));const child=await popup(page,'source');
  await child.locator('.cm-scroller').hover();await child.mouse.wheel(0,650);await expect.poll(()=>page.locator('#preview').evaluate(n=>n.scrollTop)).toBeGreaterThan(250);
  await waitForScrollReady(page);await waitForScrollReady(child);await page.bringToFront();await page.locator('#preview').hover();await page.mouse.wheel(0,800);await expect.poll(()=>child.locator('.cm-scroller').evaluate(n=>n.scrollTop)).toBeGreaterThan(800);
  await page.locator('[data-cmd="sync"]').click();const before=await page.locator('#preview').evaluate(n=>n.scrollTop),childBefore=await child.locator('.cm-scroller').evaluate(n=>n.scrollTop);await child.bringToFront();await child.locator('.cm-scroller').hover();await child.mouse.wheel(0,700);await expect.poll(()=>child.locator('.cm-scroller').evaluate(n=>n.scrollTop)).not.toBe(childBefore);await settleScroll(child);await settleScroll(page);expect(await page.locator('#preview').evaluate(n=>n.scrollTop)).toBeCloseTo(before,0);
});

test('orphan pane URLs do not create an independently saved document',async({page})=>{
  await page.goto('/index.html?pane=preview');await expect(page.locator('#app')).toContainText('元のウィンドウに接続できません');expect(await page.evaluate(()=>window.__mdSplit)).toBeUndefined();expect(await page.evaluate(()=>localStorage.getItem('mdsplit.recovery'))).toBeNull();
});

test('an owner dialog pauses popup editing until it closes',async({page})=>{
  await start(page);await setText(page,'unchanged');const child=await popup(page,'source');
  await page.bringToFront();await page.getByRole('button',{name:'設定',exact:true}).click();await expect.poll(()=>child.locator('#app').evaluate(n=>n.inert)).toBe(true);
  await child.bringToFront();await child.keyboard.insertText('blocked');expect(await text(page)).toBe('unchanged');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect.poll(()=>child.locator('#app').evaluate(n=>n.inert)).toBe(false);
  await child.bringToFront();await child.locator('.cm-content').click();await child.keyboard.press('Control+End');await child.keyboard.insertText(' resumed');await expect.poll(()=>text(page)).toBe('unchanged resumed');
});

test('Save As from an inactive document popup uses its owner and never writes child recovery',async({page})=>{
  await page.context().addInitScript(()=>{
    const listeners=[];window._calls=[];window.chrome={webview:{addEventListener(type,fn){listeners.push(fn);},postMessage(message){
      window._calls.push(message);let result=true;
      if(message.method==='bootstrap')result={settings:{updateCheckDays:-1,welcomeShown:true},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'first.md',path:'C:\\notes\\first.md',text:'first',savedText:'first'}]};
      if(message.method==='file.save')result={path:'C:\\Users\\Test\\Documents\\saved.md',name:'saved.md',text:message.args.document.text,encoding:'utf8',fingerprint:'saved'};
      if(message.method==='file.new')setTimeout(()=>listeners.forEach(fn=>fn({data:{type:'new-document'}})),0);
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }}};
  });
  await page.goto('/');await ready(page);const child=await popup(page,'preview');await page.bringToFront();await page.keyboard.press('Control+n');await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents().length)).toBe(2);
  await child.bringToFront();await child.evaluate(()=>window.__mdSplit.renderer.restoreSelection(5));await child.keyboard.insertText(' modified');await child.keyboard.press('Control+Shift+s');
  await expect.poll(()=>page.evaluate(()=>window._calls.filter(c=>c.method==='file.save').length)).toBe(1);const saved=await page.evaluate(()=>window._calls.find(c=>c.method==='file.save').args);expect(saved.saveAs).toBe(true);expect(saved.document.id).toBe('11111111-1111-4111-8111-111111111111');expect(saved.document.text).toBe('first modified');
  await expect.poll(()=>child.evaluate(()=>window.__mdSplit.model().name)).toBe('saved.md');expect(await child.evaluate(()=>window._calls.some(c=>['bootstrap','recovery.write','file.save'].includes(c.method)))).toBe(false);
});
