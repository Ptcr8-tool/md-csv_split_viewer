import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);});
const setText=(page,text)=>page.evaluate(text=>window.__mdSplit.setText(text),text);
const getText=page=>page.evaluate(()=>window.__mdSplit.getText());
const select=(page,from,to=from)=>page.evaluate(({from,to})=>window.__mdSplit.renderer.restoreSelection(from,to),{from,to});

test('left typing updates the rendered document and preserves mixed line endings',async({page})=>{
  const raw='__keep__  \r\n\n# 見出し\r\n\r\n本文';await setText(page,raw);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('を追記');
  await expect(page.locator('#preview')).toContainText('本文を追記');expect(await getText(page)).toBe(raw+'を追記');
});
test('right typing modifies only the selected source span',async({page})=>{
  const raw='__そのまま__  \r\n\r\n古い文章です。\r\n\r\n~~~js\r\n  keep( 1 );\r\n~~~';await setText(page,raw);
  const at=raw.indexOf('古い');await select(page,at,at+2);await page.keyboard.insertText('新しい');
  expect(await getText(page)).toBe(raw.replace('古い','新しい'));
  await expect(page.locator('.cm-content')).toContainText('新しい文章です。');
});
test('rich toolbar applies to the last selected right-side text',async({page})=>{
  const raw='選択した文章。\n\n__keep__';await setText(page,raw);await select(page,0,6);
  await page.getByRole('button',{name:'太字 · Ctrl+B',exact:true}).click();
  expect(await getText(page)).toBe('**選択した文章**。\n\n__keep__');
  await expect(page.locator('#preview strong').first()).toHaveText('選択した文章');
});
test('typing in a table cell preserves the original table whitespace',async({page})=>{
  const raw='前の文章\r\n\r\n| 名前   | 内容 |\r\n| :---   | ---: |\r\n| Alice | old  |\r\n\r\n後の文章';await setText(page,raw);
  const at=raw.indexOf('old');await select(page,at,at+3);await page.keyboard.insertText('new');
  expect(await getText(page)).toBe(raw.replace('old','new'));await expect(page.locator('#preview td').last()).toHaveText('new');
});
test('mode changes do not mutate source and Discord leaves tables and diagrams unexpanded',async({page})=>{
  const raw='__下線__\n\n-# 小さな文字\n\n| A | B |\n|---|---|\n|1|2|\n\n```mermaid\nflowchart LR\nA --> B\n```';await setText(page,raw);
  await page.getByRole('button',{name:'Discord表示',exact:true}).click();
  await expect(page.locator('#preview table')).toHaveCount(0);await expect(page.locator('#preview u')).toHaveText('下線');await expect(page.locator('.subtext')).toHaveText('小さな文字');await expect(page.locator('.mermaid-stage')).toHaveCount(0);expect(await getText(page)).toBe(raw);
});
test('Mermaid renders and right-side code edits preserve surrounding Markdown',async({page})=>{
  const raw='__keep__  \r\n\r\n```mermaid\r\nflowchart LR\r\n A[開始] --> B[完了]\r\n```\r\n\r\n末尾';await setText(page,raw);
  await expect(page.locator('.mermaid-stage svg')).toHaveCount(1,{timeout:30000});
  await page.getByRole('button',{name:'コード編集',exact:true}).click();
  await page.getByRole('textbox',{name:'Mermaidコード',exact:true}).fill('flowchart LR\n A[開始] --> B[変更]');
  expect(await getText(page)).toBe(raw.replace('B[完了]','B[変更]'));
});
test('details open state does not edit the source and its content is editable',async({page})=>{
  const raw='<details>\n<summary>もっと見る</summary>\n\n内側の文章\n\n</details>\n\n__keep__';await setText(page,raw);
  await page.locator('#preview summary').click();expect(await getText(page)).toBe(raw);
  const at=raw.indexOf('内側');await select(page,at,at+2);await page.keyboard.insertText('内部');expect(await getText(page)).toBe(raw.replace('内側','内部'));
});
test('undo and redo include right-side edits',async({page})=>{
  await setText(page,'元の文章');await select(page,0,1);await page.keyboard.insertText('新');expect(await getText(page)).toBe('新の文章');
  await page.keyboard.press('Control+z');expect(await getText(page)).toBe('元の文章');await page.keyboard.press('Control+y');expect(await getText(page)).toBe('新の文章');
});
test('replacement inside existing bold keeps the original delimiters',async({page})=>{
  const raw='__変更前__  \r\n\r\n後の文章';await setText(page,raw);await select(page,2,5);await page.keyboard.insertText('変更後');expect(await getText(page)).toBe(raw.replace('変更前','変更後'));
});
test('backspace deletes a complete emoji grapheme',async({page})=>{
  const raw='前👩‍👩‍👧‍👦後';await setText(page,raw);const at=raw.indexOf('後');await select(page,at);await page.keyboard.press('Backspace');expect(await getText(page)).toBe('前後');
});
test('composition commits exactly once and does not rerender during conversion',async({page})=>{
  await setText(page,'前 後');await select(page,2);
  await page.evaluate(()=>{const n=document.querySelector('#preview');window._beforeComposition=n.firstChild;n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));n.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,isComposing:true,inputType:'insertCompositionText',data:'にほん'}));});
  expect(await getText(page)).toBe('前 後');expect(await page.evaluate(()=>window._beforeComposition===document.querySelector('#preview').firstChild)).toBe(true);
  await page.evaluate(()=>document.querySelector('#preview').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本'})));
  await expect.poll(()=>getText(page)).toBe('前 日本後');
});
test('save response does not overwrite typing performed while the save was pending',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window._hostCalls=[];window.chrome=window.chrome||{};window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){window._hostCalls.push(message.method);
      const reply=result=>setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
      if(message.method==='bootstrap')reply({settings:{},documents:[{id:'11111111-1111-4111-8111-111111111111',path:'C:\\notes\\test.md',name:'test.md',text:'元の文章',savedText:'元の文章',fingerprint:'before',encoding:'utf8'}]});
      else if(message.method==='file.save')window._pendingSave={message,reply};else reply(true);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit);expect(await page.evaluate(()=>!!window.chrome?.webview)).toBe(true);await page.getByRole('button',{name:'保存 · Ctrl+S',exact:true}).click();await page.waitForFunction(()=>window._pendingSave);
  await select(page,4);await page.keyboard.insertText('追記');
  await page.evaluate(()=>{const {message,reply}=window._pendingSave;reply({text:message.args.document.text,path:'C:\\notes\\test.md',name:'test.md',encoding:'utf8',fingerprint:'after',replacements:[]});});
  await expect(page.locator('#save-state')).toHaveText('未保存の変更');expect(await getText(page)).toBe('元の文章追記');
});
for(const side of ['source','preview'])test(`Save As icon keeps ${side} edits on cancel and switches subsequent saves to the new file`,async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window._saveRequests=[];window.chrome=window.chrome||{};
    window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      const reply=result=>setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
      if(message.method==='bootstrap')reply({settings:{updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',path:'C:\\notes\\original.md',name:'original.md',text:'元の文章',savedText:'元の文章',encoding:'utf8'}]});
      else if(message.method==='file.save'){window._saveRequests.push(message.args);window._pendingSave={message,reply};}else reply(true);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit);
  if(side==='source')await page.evaluate(()=>{const cm=window.__mdSplit.editor();cm.dispatch({selection:{anchor:cm.state.doc.length}});cm.focus();});
  else await select(page,4);
  await page.keyboard.insertText('追記');
  const saveAs=page.getByRole('button',{name:'名前を付けて保存 · Ctrl+Shift+S',exact:true});
  await saveAs.click();await page.waitForFunction(()=>window._saveRequests.length===1);
  expect(await page.evaluate(()=>window._saveRequests[0].saveAs)).toBe(true);
  await page.evaluate(()=>window._pendingSave.reply(null));await page.waitForFunction(()=>!window.__mdSplit.model().saving);
  expect(await getText(page)).toBe('元の文章追記');expect(await page.evaluate(()=>window.__mdSplit.model().path)).toBe('C:\\notes\\original.md');await expect(page.locator('#save-state')).toHaveText('未保存の変更');
  await saveAs.click();await page.waitForFunction(()=>window._saveRequests.length===2);
  await page.evaluate(()=>{const {message,reply}=window._pendingSave;reply({text:message.args.document.text,path:'C:\\copies\\別名.md',name:'別名.md',encoding:'utf8',fingerprint:'saved-copy',replacements:[]});});
  await expect(page.locator('.tab-name')).toContainText('別名.md');await expect(page.locator('#save-state')).toHaveText('保存済み');
  expect(await getText(page)).toBe('元の文章追記');
  await page.getByRole('button',{name:'保存 · Ctrl+S',exact:true}).click();await page.waitForFunction(()=>window._saveRequests.length===3);
  expect(await page.evaluate(()=>({saveAs:window._saveRequests[2].saveAs,path:window._saveRequests[2].document.path}))).toEqual({saveAs:false,path:'C:\\copies\\別名.md'});
  await page.evaluate(()=>{const {message,reply}=window._pendingSave;reply({...message.args.document,text:message.args.document.text,fingerprint:'saved-again',replacements:[]});});
  await page.waitForFunction(()=>!window.__mdSplit.model().saving);
  if(side==='source')await page.evaluate(()=>window.__mdSplit.editor().focus());else await select(page,1);
  await page.keyboard.press('Control+Shift+s');await page.waitForFunction(()=>window._saveRequests.length===4);expect(await page.evaluate(()=>window._saveRequests[3].saveAs)).toBe(true);
  await page.evaluate(()=>window._pendingSave.reply(null));
});
test('a pending image stays in its original document when the active tab changes',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window.chrome=window.chrome||{};window._emit=message=>listeners.forEach(fn=>fn({data:message}));
    window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){const reply=result=>setTimeout(()=>window._emit({replyTo:message.id,result}),0);
      if(message.method==='bootstrap')reply({settings:{},documents:[{id:'11111111-1111-4111-8111-111111111111',path:'C:\\notes\\test.md',name:'test.md',text:'Before',savedText:'Before',encoding:'utf8'}]});
      else if(message.method==='image.import')window._imageReply=reply;else reply(true);
    }};
  });
  await page.reload();await page.waitForFunction(()=>window.__mdSplit);await select(page,6);
  await page.locator('#image-input').setInputFiles({name:'image.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cH+QAAAAASUVORK5CYII=','base64')});
  await page.waitForFunction(()=>window._imageReply);await page.keyboard.insertText('X');
  await page.evaluate(()=>window._emit({type:'new-document'}));await expect(page.locator('.tab')).toHaveCount(2);
  await page.evaluate(()=>window._imageReply({url:'test.assets/image.png'}));
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.documents()[0].raw)).toBe('BeforeX![image.png](<test.assets/image.png>)');expect(await getText(page)).toBe('');
});
test('column insertion works for Markdown tables without outer pipes',async({page})=>{
  await setText(page,'A | B\n--- | ---\none | two');await select(page,4);await page.locator('#preview th').last().dispatchEvent('contextmenu');
  await page.locator('#table-operation').selectOption('column-after');await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect.poll(()=>getText(page)).not.toBe('A | B\n--- | ---\none | two');const text=await getText(page);expect(text.split('\n')[0]).toContain('A | B| 内容 ');expect(text.split('\n')[2]).toContain('one | two| 内容 ');
});
test('Discord split copies stay within the limit',async({page})=>{
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const raw='```js\n'+('console.log("hello");\n'.repeat(250))+'```';await setText(page,raw);await page.getByRole('button',{name:'Discord表示',exact:true}).click();await page.locator('#show-chunks').click();
  expect(await page.locator('.chunk').count()).toBeGreaterThan(2);const expected=await page.locator('.chunk pre').first().textContent();await page.locator('.chunk button').first().click();const copied=await page.evaluate(()=>navigator.clipboard.readText());expect(copied.length).toBeLessThanOrEqual(2000);expect(copied.replace(/\r\n/g,'\n')).toBe(expected.replace(/\r\n/g,'\n'));expect(copied).toContain('```js');expect(copied.trimEnd().endsWith('```')).toBe(true);expect(await getText(page)).toBe(raw);
});
test('layout switching retains existing tabs and modes apply to all tabs',async({page})=>{
  await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();await expect(page.locator('.tab')).toHaveCount(2);
  await page.getByRole('button',{name:'次のファイルを別ウィンドウで開く',exact:true}).click();await expect(page.locator('.tab')).toHaveCount(2);
  await page.getByRole('button',{name:'Discord表示',exact:true}).click();await page.locator('.tab-name').first().click();await expect(page.locator('#render-label')).toHaveText('DISCORD');
});
test('no external font or script is needed and the interface stays inside the window',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await setText(page,'# お知らせ\n\n使い慣れたMarkdownを、もっと軽快に。\n\n## 自由に編集\n\n左は原文、右は文章。どちらからでも書き始められます。\n\n- **原文を保持**して編集\n- タブとウィンドウを切り替え\n- Discord向けの表示を確認\n\n| 機能 | 操作 |\n| --- | --- |\n| 保存 | Ctrl+S |\n| 太字 | Ctrl+B |\n\n> 文章を選択すると、上のツールバーから装飾できます。');
  await page.screenshot({path:'test-results/editor-overview.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
