import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function openNew(page){
  await page.getByLabel('ファイルメニュー').click();
  await page.getByRole('button',{name:'新規作成…',exact:true}).click();
  await expect(page.locator('#dialog-title')).toHaveText('新規ファイルを作成');
}
async function browserPage(page){
  await page.addInitScript(()=>localStorage.setItem('mdsplit.settings',JSON.stringify({welcomeShown:true})));
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());
}
async function savedBytes(page,text){
  await page.locator('.cm-content').click();await page.keyboard.insertText(text);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'保存 · Ctrl+S',exact:true}).click();
  const file=await download;return {name:file.suggestedFilename(),bytes:[...await readFile(await file.path())]};
}

test('menu creates TXT with UTF-8 BOM and saves the selected bytes',async({page})=>{
  await browserPage(page);await openNew(page);
  await page.getByRole('radio',{name:/テキスト/}).check();
  await page.locator('#new-file-encoding').selectOption('utf8bom');
  await page.getByRole('button',{name:'作成',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('無題.txt');
  expect(await page.evaluate(()=>({encoding:window.__mdSplit.model().encoding,hasBom:window.__mdSplit.model().hasBom,dirty:window.__mdSplit.model().dirty}))).toEqual({encoding:'utf8bom',hasBom:true,dirty:false});
  expect(await savedBytes(page,'日本')).toEqual({name:'無題.txt',bytes:[0xef,0xbb,0xbf,0xe6,0x97,0xa5,0xe6,0x9c,0xac]});
});

test('more formats offers YAML yml and chosen UTF-16 BE is retained when saved',async({page})=>{
  await browserPage(page);await openNew(page);
  await page.locator('#new-file-more summary').click();
  await expect(page.getByRole('combobox',{name:'その他のファイル形式',exact:true})).toHaveValue('');
  await page.getByRole('combobox',{name:'その他のファイル形式',exact:true}).selectOption('yml');
  await expect(page.locator('#new-file-more-selection')).toHaveText('YAML（.yml）');
  await page.locator('#new-file-more summary').click();
  await expect(page.locator('#new-file-more-selection')).toBeVisible();
  await page.locator('#new-file-encoding').selectOption('utf16be');
  await page.getByRole('button',{name:'作成',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('無題.yml');
  await expect(page.locator('#source-label')).toHaveText('YAML');
  expect(await page.evaluate(()=>({encoding:window.__mdSplit.model().encoding,hasBom:window.__mdSplit.model().hasBom}))).toEqual({encoding:'utf16be',hasBom:true});
  expect(await savedBytes(page,'あ')).toEqual({name:'無題.yml',bytes:[0xfe,0xff,0x30,0x42]});
});

test('cancel leaves the current document alone and browser-only unsupported encodings are disabled',async({page})=>{
  await browserPage(page);await page.evaluate(()=>window.__mdSplit.setText('keep'));
  const before=await page.evaluate(()=>window.__mdSplit.documents().length);
  await openNew(page);await expect(page.locator('#new-file-encoding option[value="shiftjis"]')).toHaveAttribute('disabled','');
  await page.getByRole('radio',{name:/CSV/}).first().check();
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  expect(await page.evaluate(()=>({count:window.__mdSplit.documents().length,text:window.__mdSplit.getText()}))).toEqual({count:before,text:'keep'});
});

test('format and encoding choices fit on a small desktop window',async({page})=>{
  await page.setViewportSize({width:800,height:560});await browserPage(page);await openNew(page);
  await page.locator('#new-file-more summary').click();
  const body=await page.locator('#dialog-body').boundingBox(),encoding=await page.locator('#new-file-encoding').boundingBox(),hint=await page.locator('.new-file-hint').boundingBox();
  expect(encoding.y).toBeGreaterThanOrEqual(body.y);
  expect(encoding.y+encoding.height).toBeLessThanOrEqual(body.y+body.height);
  expect(hint.y+hint.height).toBeLessThanOrEqual(body.y+body.height);
});

test('switching back to a common format replaces the advanced choice',async({page})=>{
  await browserPage(page);await openNew(page);
  await page.locator('#new-file-more summary').click();
  await page.getByRole('combobox',{name:'その他のファイル形式',exact:true}).selectOption('yml');
  await expect(page.locator('#new-file-common input:checked')).toHaveCount(0);
  await page.getByRole('radio',{name:/テキスト/}).check();
  await expect(page.locator('#new-file-extra-format')).toHaveValue('');
  await page.getByRole('button',{name:'作成',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('無題.txt');
});

test('Windows receives the selected extension and legacy encoding for a new document',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window._newFileCalls=[];window.chrome=window.chrome||{};
    window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      window._newFileCalls.push(message);
      const emit=data=>listeners.forEach(fn=>fn({data}));
      if(message.method==='file.new')setTimeout(()=>emit({type:'new-document',document:{id:'22222222-2222-4222-8222-222222222222',name:message.args.name,encoding:message.args.encoding,savedEncoding:message.args.encoding,hasBom:false,savedHasBom:false}}),0);
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1,openPolicy:'tabs'},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'start.md',text:'',savedText:'',encoding:'utf8'}]}:true;
      setTimeout(()=>emit({replyTo:message.id,result}),0);
    }};
  });
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());await openNew(page);
  await page.locator('#new-file-more summary').click();await page.getByRole('combobox',{name:'その他のファイル形式',exact:true}).selectOption('yml');
  await page.locator('#new-file-encoding').selectOption('shiftjis');await page.getByRole('button',{name:'作成',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().name)).toBe('無題.yml');
  const request=await page.evaluate(()=>window._newFileCalls.find(call=>call.method==='file.new').args);
  expect(request).toEqual({name:'無題.yml',encoding:'shiftjis'});
  expect(await page.evaluate(()=>window.__mdSplit.model().encoding)).toBe('shiftjis');
});

test('a new file is delegated to Windows when the open-in-new-window setting is active',async({page})=>{
  await page.addInitScript(()=>{
    const listeners=[];window._windowNewCalls=[];window.chrome=window.chrome||{};
    window.chrome.webview={addEventListener(name,fn){if(name==='message')listeners.push(fn);},postMessage(message){
      window._windowNewCalls.push(message);
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1,openPolicy:'windows'},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'start.md',text:'',savedText:'',encoding:'utf8'}]}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  });
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());await openNew(page);
  await page.getByRole('radio',{name:/CSV/}).check();await page.locator('#new-file-encoding').selectOption('utf16le');await page.getByRole('button',{name:'作成',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window._windowNewCalls.some(call=>call.method==='file.new'))).toBe(true);
  expect(await page.evaluate(()=>window._windowNewCalls.find(call=>call.method==='file.new').args)).toEqual({name:'無題.csv',encoding:'utf16le'});
  expect(await page.evaluate(()=>window.__mdSplit.documents().length)).toBe(1);
});
