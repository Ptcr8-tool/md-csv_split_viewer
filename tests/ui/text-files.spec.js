import {test, expect} from '@playwright/test';

const ready = page => page.waitForFunction(() => window.__mdSplit?.openDocument);
const rawText = page => page.evaluate(() => window.__mdSplit.getText());
const openDocument = (page, data) => page.evaluate(data => {
  window.__mdSplit.openDocument({encoding:'utf8', hasBom:false, ...data});
}, data);
const sourceSelection = (page, from, to=from) => page.evaluate(({from,to}) => {
  const raw = window.__mdSplit.getText();
  const offset = n => raw.slice(0,n).replace(/\r\n/g,'\n').length;
  const cm = window.__mdSplit.editor();
  cm.dispatch({selection:{anchor:offset(from), head:offset(to)}});
  cm.focus();
}, {from,to});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('mdsplit.settings', JSON.stringify({welcomeShown:true})));
  await page.goto('/');
  await ready(page);
});

for (const name of ['note.txt','data.json','document.xml','script.js','style.css','settings.yaml','unknown.custom']) {
  test(`${name} uses literal source editing without Markdown controls`, async ({page}) => {
    const requests=[];
    page.on('request', request => {if(request.url().startsWith('https://text-fixture.invalid/')) requests.push(request.url());});
    const text='# Heading\r\n\r\n- literal item\r\n![image](https://text-fixture.invalid/image.png)\r\n<script>window._literalExecuted=true</script>';
    await openDocument(page, {name,text});
    await expect(page.locator('.source-pane')).toBeVisible();
    await expect(page.locator('.preview-pane')).toBeHidden();
    await expect(page.locator('#outline-panel')).toBeHidden();
    await expect(page.locator('.formatbar')).toBeHidden();
    await expect(page.locator('#source-label')).not.toHaveText(/markdown/i);
    expect(await rawText(page)).toBe(text);
    expect(await page.evaluate(() => window._literalExecuted)).toBeUndefined();
    expect(requests).toEqual([]);
  });
}

test('plain Enter and Tab preserve line endings and never continue a Markdown list', async ({page}) => {
  await openDocument(page, {name:'note.txt',text:'- item\r\nsecond'});
  await sourceSelection(page, 6);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('next');
  await expect.poll(() => rawText(page)).toBe('- item\r\nnext\r\nsecond');
  await sourceSelection(page, 0);
  await page.keyboard.press('Tab');
  await expect.poll(() => rawText(page)).toBe('\t- item\r\nnext\r\nsecond');
});

test('plain formatting shortcuts do not insert Markdown or open a link dialog', async ({page}) => {
  const text='literal words';
  await openDocument(page, {name:'note.txt',text});
  for (const key of ['Control+b','Control+i','Control+k']) {
    await sourceSelection(page, 0, 7);
    await page.keyboard.press(key);
    expect(await rawText(page)).toBe(text);
    expect(await page.locator('#modal').evaluate(node => node.open)).toBe(false);
  }
});

test('plain source paste uses literal clipboard text rather than converting rich HTML', async ({page}) => {
  await openDocument(page,{name:'note.txt',text:'Before '});
  await sourceSelection(page,7);
  await page.locator('.cm-content').evaluate(node=>{
    const data=new DataTransfer();
    data.setData('text/plain','**literal** <b>text</b>');
    data.setData('text/html','<strong>formatted</strong>');
    node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  await expect.poll(()=>rawText(page)).toBe('Before **literal** <b>text</b>');
  await expect(page.locator('.preview-pane')).toBeHidden();
});

test('plain text shares undo, redo and regex replacement without changing untouched CRLF', async ({page}) => {
  const text='__literal__\r\nvalue=12\r\nend';
  await openDocument(page, {name:'note.txt',text});
  await sourceSelection(page, text.length);
  await page.keyboard.insertText(' edit');
  await expect.poll(() => rawText(page)).toBe(text+' edit');
  await page.keyboard.press('Control+z');
  await expect.poll(() => rawText(page)).toBe(text);
  await page.keyboard.press('Control+y');
  await expect.poll(() => rawText(page)).toBe(text+' edit');
  await page.keyboard.press('Control+h');
  await page.locator('#find-text').fill('(?<=value=)\\d+');
  await page.locator('#replace-text').fill('99');
  await page.locator('#find-regex').check();
  await page.getByRole('button',{name:'すべて置換',exact:true}).click();
  await expect.poll(() => rawText(page)).toBe(text.replace('12','99')+' edit');
});

test('CSV preview respects quoted commas, multiline fields and literal HTML/formulas', async ({page}) => {
  const text='Name,Note\r\n"Alice, Example","line1\r\nline2"\r\nBob,"He said ""Hi"""\r\nFormula,=1+1\r\nLiteral,<img src=x onerror=window._csvExecuted=true>';
  await openDocument(page, {name:'table.csv',text});
  const table=page.locator('#text-preview table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  const first=table.locator('tbody tr').first();
  await expect(first.locator('td').first()).toHaveText('Alice, Example');
  expect((await first.locator('td').nth(1).textContent()).replace(/\r\n/g,'\n')).toBe('line1\nline2');
  await expect(table.locator('tbody tr').nth(1).locator('td').nth(1)).toHaveText('He said "Hi"');
  await expect(table.locator('tbody tr').nth(2).locator('td').nth(1)).toHaveText('=1+1');
  await expect(table.locator('tbody tr').nth(3).locator('td').nth(1)).toHaveText('<img src=x onerror=window._csvExecuted=true>');
  await expect(page.locator('#text-preview img,#text-preview script')).toHaveCount(0);
  expect(await page.locator('#text-preview').evaluate(node => node.isContentEditable)).toBe(false);
  expect(await page.evaluate(() => window._csvExecuted)).toBeUndefined();
  const at=text.indexOf('Alice');
  await sourceSelection(page, at, at+5);
  await page.keyboard.insertText('Alicia');
  await expect(first.locator('td').first()).toHaveText('Alicia, Example');
  expect(await rawText(page)).toBe(text.replace('Alice','Alicia'));
});

test('CSV delimiter/header controls and TSV preview change only the view', async ({page}) => {
  const text='Name;Value\nA;"B;C"';
  await openDocument(page, {name:'semicolon.csv',text});
  await page.getByRole('combobox',{name:'区切り文字',exact:true}).selectOption('semicolon');
  const table=page.locator('#text-preview table');
  await expect(table.locator('tbody tr').first().locator('td')).toHaveText(['A','B;C']);
  await page.getByRole('checkbox',{name:'先頭行を見出しにする',exact:true}).uncheck();
  await expect(table.locator('tbody tr').first().locator('td')).toHaveText(['Name','Value']);
  expect(await rawText(page)).toBe(text);
  await openDocument(page, {name:'table.tsv',text:'Name\tValue\r\nA\tB'});
  await expect(page.locator('#text-preview table tbody tr').first().locator('td')).toHaveText(['A','B']);
});

test('oversized CSV preview reports a limit while source text remains editable', async ({page}) => {
  const text=Array.from({length:1001},(_,i)=>'row'+i+',value').join('\n');
  await openDocument(page, {name:'large.csv',text});
  await expect(page.getByRole('dialog',{name:'大きな表のプレビュー'})).toBeVisible();
  await page.getByRole('button',{name:'表示しない',exact:true}).click();
  await expect(page.locator('#text-preview table')).toHaveCount(0);
  await expect(page.locator('#text-preview')).toContainText('原文の編集は続けられます');
  expect(await rawText(page)).toBe(text);
  await sourceSelection(page, text.length);
  await page.keyboard.insertText(' edited');
  await expect.poll(() => rawText(page)).toBe(text+' edited');
});

test('large CSV can be opened, paged and edited beyond the former limits', async ({page}) => {
  const rows=Array.from({length:1001},(_,i)=>'row'+i+',value');const text=rows.join('\n');
  await openDocument(page,{name:'large.csv',text});
  await page.getByRole('button',{name:'表示する',exact:true}).click();
  await expect(page.locator('#text-preview tbody tr')).toHaveCount(100);
  for(let i=0;i<9;i++)await page.getByRole('button',{name:'次の行',exact:true}).click();
  const cell=page.locator('#text-preview tbody tr').last().locator('td').first();await expect(cell).toHaveText('row1000');
  await cell.dblclick();await cell.locator('textarea').fill('最終🙂');await cell.locator('textarea').press('Enter');
  await expect.poll(()=>rawText(page)).toBe(text.replace('row1000,value','最終🙂,value'));
  await expect(page.locator('#text-preview tbody tr').last().locator('td').first()).toHaveText('最終🙂');
});

test('large CSV cells remain editable beyond the former character limit', async ({page}) => {
  const value='🙂'.repeat(17000),text='name,note\nfirst,"'+value+'"';
  await openDocument(page,{name:'long.csv',text});await page.getByRole('button',{name:'表示する',exact:true}).click();
  const cell=page.locator('#text-preview tbody tr').first().locator('td').nth(1);await cell.dblclick();const input=cell.locator('textarea');
  expect(await input.evaluate(node=>node.maxLength)).toBe(-1);await input.fill(value+' ✅');await input.press('Enter');await expect.poll(()=>rawText(page)).toBe('name,note\nfirst,"'+value+' ✅"');
});

test('large CSV column pagination exposes cells beyond 100 columns', async ({page}) => {
  const text=Array.from({length:101},(_,i)=>'c'+i).join(',')+'\n'+Array.from({length:101},(_,i)=>'v'+i).join(',');
  await openDocument(page,{name:'wide.csv',text});await page.getByRole('button',{name:'表示する',exact:true}).click();
  await page.getByRole('button',{name:'次の列',exact:true}).click();await page.getByRole('button',{name:'次の列',exact:true}).click();
  const cell=page.locator('#text-preview tbody tr').first().locator('td').first();await expect(cell).toHaveText('v100');await cell.dblclick();await cell.locator('textarea').fill('編集');await cell.locator('textarea').press('Enter');await expect.poll(()=>rawText(page)).toBe(text.slice(0,-4)+'編集');
});

test('HTML is sandboxed and sanitized before any resource can load, then follows source edits', async ({page}) => {
  const requests=[];
  page.on('request', request => {if(request.url().startsWith('https://text-fixture.invalid/')) requests.push(request.url());});
  const text=`<!doctype html><html><head>
<base href="https://text-fixture.invalid/base/">
<meta http-equiv="refresh" content="0;url=https://text-fixture.invalid/refresh">
<link rel="prefetch" href="https://text-fixture.invalid/prefetch">
<style>@import url('https://text-fixture.invalid/import');body{background:url('https://text-fixture.invalid/background')}</style>
</head><body><h1>Safe heading</h1><p style="background:url('https://text-fixture.invalid/inline')">Body</p>
<script>window._htmlExecuted=true;parent._htmlEscaped=true;fetch('https://text-fixture.invalid/fetch')</script>
<img src="https://text-fixture.invalid/image" srcset="https://text-fixture.invalid/srcset 2x" onerror="parent._htmlEscaped=true">
<iframe src="https://text-fixture.invalid/frame"></iframe><form action="https://text-fixture.invalid/form"><input name="value"></form>
<a href="https://text-fixture.invalid/link" target="_blank" ping="https://text-fixture.invalid/ping">Safe link</a>
</body></html>`;
  await openDocument(page, {name:'page.html',text});
  const iframe=page.locator('#text-preview iframe');
  await expect(iframe).toHaveAttribute('sandbox','');
  const frame=page.frameLocator('#text-preview iframe');
  await expect(frame.getByRole('heading',{name:'Safe heading',exact:true})).toBeVisible();
  const policy=await iframe.evaluate(node => {
    const doc=new DOMParser().parseFromString(node.getAttribute('srcdoc'),'text/html');
    return {first:doc.head.firstElementChild.getAttribute('http-equiv'),csp:doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content};
  });
  expect(policy.first).toBe('Content-Security-Policy');
  for(const directive of ["default-src 'none'","script-src 'none'","connect-src 'none'"])expect(policy.csp).toContain(directive);
  await expect(frame.locator('script,iframe,base,form,input,link')).toHaveCount(0);
  await expect(frame.locator('[href],[srcset],[onerror]')).toHaveCount(0);
  expect(await iframe.evaluate(node => node.contentDocument===null)).toBe(true);
  const before=page.url();
  await frame.getByText('Safe link',{exact:true}).click();
  expect(page.url()).toBe(before);
  expect(page.context().pages()).toHaveLength(1);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window._htmlExecuted||window._htmlEscaped)).toBeUndefined();
  const at=text.indexOf('Safe heading');
  await sourceSelection(page, at, at+'Safe heading'.length);
  await page.keyboard.insertText('Updated heading');
  await expect(frame.getByRole('heading',{name:'Updated heading',exact:true})).toBeVisible();
  expect(await rawText(page)).toBe(text.replace('Safe heading','Updated heading'));
  expect(requests).toEqual([]);
});

async function mockDesktop(page) {
  await page.addInitScript(() => {
    const listeners=[];window._textHostCalls=[];window._nextSaveName=null;
    window.chrome={webview:{addEventListener(type,fn){if(type==='message')listeners.push(fn);},postMessage(message){
      window._textHostCalls.push(message);
      const reply=result=>setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
      if(message.method==='bootstrap')reply({settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',path:'C:/notes/note.txt',name:'note.txt',text:'# Literal\r\nbody',savedText:'# Literal\r\nbody',encoding:'utf16le',savedEncoding:'utf16le',hasBom:false,savedHasBom:false}]});
      else if(message.method==='file.save'){
        const document=message.args.document,name=window._nextSaveName||document.name;window._nextSaveName=null;
        reply({id:document.id,path:'C:/notes/'+name,name,text:document.text,encoding:document.encoding,hasBom:document.hasBom,fingerprint:'saved',replacements:[]});
      }else if(message.method==='file.reopen')reply({id:message.args.id,path:'C:/notes/note.txt',name:'note.txt',text:'開き直した本文\r\nsecond',savedText:'開き直した本文\r\nsecond',encoding:message.args.encoding,savedEncoding:message.args.encoding,hasBom:false,savedHasBom:false});
      else if(message.method==='file.open')reply(null);
      else if(message.method==='image.import')reply({url:'note.assets/image.png'});
      else reply(true);
    }}};
  });
  await page.reload();await ready(page);
}

test('Save As updates the filename-based document mode and restores the Markdown layout preference', async ({page}) => {
  await mockDesktop(page);
  await expect(page.locator('.preview-pane')).toBeHidden();
  await page.evaluate(() => {window._nextSaveName='renamed.md';});
  await page.getByRole('button',{name:'名前を付けて保存 · Ctrl+Shift+S',exact:true}).click();
  await expect(page.locator('.preview-pane')).toBeVisible();
  await expect(page.locator('#preview h1')).toHaveText(/Literal/);
  
  await page.locator('[data-cmd="view-preview"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.source-pane')).toBeHidden();
  await page.evaluate(() => {window._nextSaveName='renamed.txt';});
  await page.getByRole('button',{name:'名前を付けて保存 · Ctrl+Shift+S',exact:true}).click();
  await expect(page.locator('.source-pane')).toBeVisible();
  await expect(page.locator('.preview-pane')).toBeHidden();
  await page.evaluate(() => {window._nextSaveName='again.md';});
  await page.getByRole('button',{name:'名前を付けて保存 · Ctrl+Shift+S',exact:true}).click();
  await expect(page.locator('.source-pane')).toBeHidden();
  await expect(page.locator('.preview-pane')).toBeVisible();
  expect(await rawText(page)).toBe('# Literal\r\nbody');
  const saves=await page.evaluate(() => window._textHostCalls.filter(c=>c.method==='file.save').map(c=>c.args));
  expect(saves).toHaveLength(3);
  expect(saves.every(save=>save.saveAs&&save.document.hasBom===false)).toBe(true);
});

test('encoding save conversion and reopening keep text files and explicit BOM state intact', async ({page}) => {
  await mockDesktop(page);
  await page.getByRole('button',{name:'保存 · Ctrl+S',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window._textHostCalls.filter(c=>c.method==='file.save').length)).toBe(1);
  expect(await page.evaluate(() => window._textHostCalls.find(c=>c.method==='file.save').args.document.hasBom)).toBe(false);
  await page.waitForFunction(() => !window.__mdSplit.model().saving);
  await page.locator('#encoding').click();
  await page.locator('#chosen-encoding').selectOption('utf8bom');
  await page.locator('#encoding-action').selectOption('save');
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await page.getByRole('button',{name:'保存 · Ctrl+S',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window._textHostCalls.filter(c=>c.method==='file.save').length)).toBe(2);
  expect(await page.evaluate(() => window._textHostCalls.filter(c=>c.method==='file.save').at(-1).args.document.hasBom)).toBe(true);
  await page.waitForFunction(() => !window.__mdSplit.model().saving);
  await page.locator('#encoding').click();
  await page.locator('#chosen-encoding').selectOption('shiftjis');
  await page.locator('#encoding-action').selectOption('reopen');
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect.poll(() => rawText(page)).toBe('開き直した本文\r\nsecond');
  expect(await page.evaluate(() => window.__mdSplit.model().encoding)).toBe('shiftjis');
  expect(await page.evaluate(() => window.__mdSplit.model().hasBom)).toBe(false);
  await expect(page.locator('.preview-pane')).toBeHidden();
});

test('non-Markdown image paste/drop never imports images; text-file drop opens its actual type', async ({page}) => {
  await mockDesktop(page);
  for(const [name,text] of [['note.txt','literal'],['table.csv','A,B\nx,y'],['page.html','<p>Keep</p>']]){
    await openDocument(page,{name,text});
    await sourceSelection(page,0);
    await page.locator('.cm-content').evaluate(node => {
      const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'clipboard.png',{type:'image/png'}));
      node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
      node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
    });
    expect(await rawText(page)).toBe(text);
  }
  expect(await page.evaluate(() => window._textHostCalls.some(c=>c.method==='image.import'))).toBe(false);
  await page.locator('#source').evaluate(node => {
    const data=new DataTransfer();data.items.add(new File(['{"value":1}'],'dropped.json',{type:'application/json'}));
    node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
  });
  await expect.poll(() => page.evaluate(() => window.__mdSplit.model().name)).toBe('dropped.json');
  expect(await rawText(page)).toBe('{"value":1}');
  await expect(page.locator('.preview-pane')).toBeHidden();
});

test('plain tabs do not overwrite the saved Markdown-only layout choice', async ({page}) => {
  await openDocument(page,{name:'guide.md',text:'# Heading\n\nbody'});
  
  await page.locator('[data-cmd="view-preview"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.source-pane')).toBeHidden();
  await openDocument(page,{name:'note.txt',text:'# literal'});
  await expect(page.locator('.source-pane')).toBeVisible();
  await expect(page.locator('.preview-pane')).toBeHidden();
  await page.getByRole('button',{name:/guide\.md$/}).click();
  await expect(page.locator('.source-pane')).toBeHidden();
  await expect(page.locator('#preview h1')).toHaveText(/Heading/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mdsplit.settings')).fileTypeSettings.markdown.viewMode)).toBe('preview');
});

async function popup(page,side){
  const opened=page.waitForEvent('popup');
  await page.locator(`[data-cmd="popout-${side}"]`).click();
  const child=await opened;await ready(child);return child;
}

test('plain source popup remains text-only and edits the shared source', async ({page}) => {
  await openDocument(page,{name:'note.txt',text:'# literal\n- item'});
  const child=await popup(page,'source');
  await expect(child.locator('.preview-pane')).toBeHidden();
  await expect(child.locator('.formatbar')).toBeHidden();
  await child.locator('.cm-content').click();
  await child.keyboard.press('Control+End');
  await child.keyboard.insertText(' edit');
  await expect.poll(() => rawText(page)).toBe('# literal\n- item edit');
});

for(const [name,text,target] of [
  ['page.html','<h1>Before</h1>','html'],
  ['table.csv','Name,Value\nBefore,1','csv']
])test(`${name} preview popup follows owner edits`, async ({page}) => {
  await openDocument(page,{name,text});
  const child=await popup(page,'preview');
  await expect(child.locator('.source-pane')).toBeHidden();
  expect(await child.locator('#text-preview').evaluate(node=>node.isContentEditable)).toBe(false);
  if(target==='html'){
    await expect(child.locator('#text-preview iframe')).toHaveAttribute('sandbox','');
    await expect(child.frameLocator('#text-preview iframe').getByRole('heading',{name:'Before',exact:true})).toBeVisible();
  }else await expect(child.locator('#text-preview table tbody td').first()).toHaveText('Before');
  await page.bringToFront();
  const at=text.indexOf('Before');await sourceSelection(page,at,at+6);
  await page.keyboard.insertText('After');
  if(target==='html')await expect(child.frameLocator('#text-preview iframe').getByRole('heading',{name:'After',exact:true})).toBeVisible();
  else await expect(child.locator('#text-preview table tbody td').first()).toHaveText('After');
  expect(await rawText(child)).toBe(text.replace('Before','After'));
});

test('new format selector creates plain text and JSON receives syntax colors',async({page})=>{
  await page.locator('#new-format').selectOption('txt');await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();
  expect(await page.evaluate(()=>window.__mdSplit.model().name)).toBe('無題.txt');await expect(page.locator('.preview-pane')).toBeHidden();
  await page.locator('#new-format').selectOption('json');await page.keyboard.press('Control+n');expect(await page.evaluate(()=>window.__mdSplit.model().name)).toBe('無題.json');
  await page.locator('.cm-content').click();await page.keyboard.insertText('{"enabled": true}');await expect.poll(()=>page.locator('.cm-line span').count()).toBeGreaterThan(0);expect(await rawText(page)).toBe('{"enabled": true}');
});

test('CR-only text edits and Enter keep its original newline style',async({page})=>{
  await openDocument(page,{name:'old-mac.txt',text:'aa\rbb\r'});await sourceSelection(page,2);await page.keyboard.press('Enter');await page.keyboard.insertText('new');await expect.poll(()=>rawText(page)).toBe('aa\rnew\rbb\r');
});

test('applying text and CSV settings retains the Markdown view and scroll preferences',async({page})=>{
  for(const name of ['note.txt','table.csv']){
    await openDocument(page,{name,text:'A,B\nC,D'});await page.getByRole('button',{name:'設定',exact:true}).click();await page.locator('#setting-file-kind').selectOption(name.endsWith('.csv')?'csv':'html');if(name.endsWith('.csv'))await expect(page.locator('#setting-sync')).toBeEnabled();else await expect(page.locator('#setting-sync')).toBeDisabled();if(name.endsWith('.csv'))await expect(page.locator('#setting-outline')).toBeDisabled();else await expect(page.locator('#setting-outline')).toBeEnabled();await page.getByRole('button',{name:'適用',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).fileTypeSettings?.markdown?.sync)).toBe(true);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mdsplit.settings')).fileTypeSettings.markdown.viewMode)).toBe('split');
  }
  await openDocument(page,{name:'back.md',text:'# Back'});await expect(page.locator('#sync-toggle')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#outline-panel')).toBeVisible();
});

test('readonly HTML popup search opens the source search in the owning document',async({page})=>{
  await openDocument(page,{name:'page.html',text:'<h1>needle</h1>'});const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'展開表示を別ウィンドウで開く',exact:true}).click();const child=await opened;await ready(child);
  await openDocument(page,{name:'other.txt',text:'other'});await child.getByRole('button',{name:'検索・置換 · Ctrl+F',exact:true}).click();await expect(page.locator('#search-panel')).toBeVisible();expect(await rawText(page)).toBe('<h1>needle</h1>');await page.locator('#find-text').fill('needle');await page.getByRole('button',{name:'次へ',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.activeElement.closest('#source')!==null)).toBe(true);
});

test('a file can be opened with an explicitly selected encoding before automatic detection',async({page})=>{
  await mockDesktop(page);await page.locator('#encoding').click();await page.locator('#chosen-encoding').selectOption('eucjp');await page.locator('#encoding-action').selectOption('open');await page.getByRole('button',{name:'適用',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window._textHostCalls.some(c=>c.method==='file.open'))).toBe(true);expect(await page.evaluate(()=>window._textHostCalls.find(c=>c.method==='file.open').args)).toEqual({encoding:'eucjp'});expect(await rawText(page)).toBe('# Literal\r\nbody');
});

test('CSV right-cell input updates only that field and keeps quotes, CRLF and neighboring fields',async({page})=>{
  const original='Name,Value\r\n"Alice",keep\r\nOther,unchanged\r\n';await openDocument(page,{name:'table.csv',text:original});
  const cell=page.locator('#text-preview tbody tr').first().locator('td').first();await cell.dblclick();const input=cell.locator('textarea');await expect(input).toBeFocused();await input.fill('A,B "quoted"');
  await expect.poll(()=>rawText(page)).toBe('Name,Value\r\n"A,B ""quoted""",keep\r\nOther,unchanged\r\n');await expect(input).toBeFocused();await input.press('Shift+Enter');await page.keyboard.insertText('next');await expect.poll(()=>rawText(page)).toContain('"A,B ""quoted""\r\nnext",keep');
  await input.press('Tab');await expect(page.locator('#text-preview textarea')).toBeFocused();await page.locator('#text-preview textarea').fill('changed');await expect.poll(()=>rawText(page)).toContain('\r\nnext",changed\r\nOther,unchanged\r\n');await page.locator('#text-preview textarea').press('Enter');await expect(page.locator('#text-preview textarea')).toHaveValue('unchanged');
});

test('TSV cells, padded cells and literal HTML stay safe while right editing',async({page})=>{
  await openDocument(page,{name:'table.tsv',text:'A\tB\nfirst\n'});const cell=page.locator('#text-preview tbody tr').first().locator('td').nth(1);await cell.dblclick();await cell.locator('textarea').fill('<img src=x onerror=window._badCell=true>');await expect.poll(()=>rawText(page)).toBe('A\tB\nfirst\t<img src=x onerror=window._badCell=true>\n');await cell.locator('textarea').press('Enter');await expect(page.locator('#text-preview img')).toHaveCount(0);expect(await page.evaluate(()=>window._badCell)).toBeUndefined();
});

test('CSV cell editor survives IME, guards peers and shares edits from a preview popup',async({page})=>{
  await openDocument(page,{name:'table.csv',text:'Name,Value\nA,1'});const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'展開表示を別ウィンドウで開く',exact:true}).click();const child=await opened;await ready(child);
  const cell=child.locator('#text-preview tbody tr').first().locator('td').first();await cell.dblclick();const input=cell.locator('textarea');await input.dispatchEvent('compositionstart',{data:''});await input.evaluate(n=>{n.value='日本語';n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'日本語'}));});expect(await rawText(page)).toBe('Name,Value\nA,1');
  await input.dispatchEvent('compositionend',{data:'日本語'});await expect.poll(()=>rawText(page)).toBe('Name,Value\n日本語,1');await input.press('Tab');await child.locator('#text-preview textarea').fill('2');await expect.poll(()=>rawText(page)).toBe('Name,Value\n日本語,2');await child.locator('#text-preview textarea').press('Enter');await page.bringToFront();await sourceSelection(page,0);await page.keyboard.insertText('X');await expect.poll(()=>rawText(child)).toContain('XName');
});
