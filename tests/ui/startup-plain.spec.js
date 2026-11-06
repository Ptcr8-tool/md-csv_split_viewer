import {test,expect} from '@playwright/test';

async function openAsDesktop(page,name){
  await page.addInitScript(name=>{
    const listeners=[];window.chrome=window.chrome||{};
    window.chrome.webview={addEventListener(type,fn){if(type==='message')listeners.push(fn);},postMessage(message){
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name,text:'one\ntwo',savedText:'one\ntwo',encoding:'utf8'}]}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  },name);
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());
}

for(const name of ['notes.txt','service.log','script.py'])test(`${name} starts without loading the preview module and remains editable`,async({page})=>{
  const requested=[];page.on('request',request=>requested.push(new URL(request.url()).pathname));
  await openAsDesktop(page,name);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('!');
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe('one\ntwo!');
  expect(requested.some(path=>path.endsWith('/text-preview.js'))).toBe(false);
  if(!name.endsWith('.py'))expect(requested.some(path=>/\/stex\//i.test(path))).toBe(false);
});

test('a CSV preview loads on demand after opening a plain file',async({page})=>{
  const requested=[];page.on('request',request=>requested.push(new URL(request.url()).pathname));
  await openAsDesktop(page,'notes.txt');
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'table.csv',text:'A,B\nx,y',savedText:'A,B\nx,y'}));
  await expect(page.locator('#text-preview [data-cell-row][data-cell-column]').first()).toBeVisible();
  expect(requested.some(path=>path.endsWith('/text-preview.js'))).toBe(true);
  await page.locator('.tab-name').filter({hasText:'notes.txt'}).click();
  await expect(page.locator('#text-preview')).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('one');
});

test('source scrolling during CSV preview loading is applied when the grid appears',async({page})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/src/text-preview.js*',async route=>{await gate;await route.continue();});
  await openAsDesktop(page,'notes.txt');
  const text='Name,Value\n'+Array.from({length:150},(_,i)=>`record${String(i).padStart(3,'0')},value`).join('\n');
  await page.evaluate(text=>window.__mdSplit.openDocument({name:'table.csv',text,savedText:text,needsInitialSave:false}),text);
  await page.evaluate(()=>{const cm=window.__mdSplit.editor(),at=cm.state.doc.toString().indexOf('record080');document.querySelector('#source').dispatchEvent(new WheelEvent('wheel',{bubbles:true}));cm.scrollDOM.scrollTop=cm.lineBlockAt(at).top;});
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.editor().scrollDOM.scrollTop)).toBeGreaterThan(500);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  release();
  await expect.poll(()=>page.locator('#text-preview .text-preview-scroll').evaluate(n=>n.scrollTop)).toBeGreaterThan(500);
});

test('switching back to text while a CSV preview loads keeps the text document active',async({page})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/src/text-preview.js*',async route=>{await gate;await route.continue();});
  await openAsDesktop(page,'notes.txt');
  await page.evaluate(()=>window.__mdSplit.openDocument({name:'table.csv',text:'A,B\nx,y',savedText:'A,B\nx,y'}));
  await page.locator('.tab-name').filter({hasText:'notes.txt'}).click();release();
  await expect(page.locator('.tab.active .tab-name')).toContainText('notes.txt');
  await expect(page.locator('#text-preview')).toBeHidden();
  await page.locator('.tab-name').filter({hasText:'table.csv'}).click();
  await expect(page.locator('#text-preview [data-cell-row][data-cell-column]').first()).toBeVisible();
});

test('restoring several tabs creates the editor once for the active document',async({page})=>{
  await page.addInitScript(()=>{
    window._editorCreations=0;
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches?.('.cm-editor'))window._editorCreations++;window._editorCreations+=node.querySelectorAll?.('.cm-editor').length||0;}}).observe(document,{subtree:true,childList:true});
    const listeners=[];window.chrome=window.chrome||{};window.chrome.webview={addEventListener(type,fn){if(type==='message')listeners.push(fn);},postMessage(message){
      const documents=[{id:'11111111-1111-4111-8111-111111111111',name:'first.txt',text:'first',savedText:'first',needsInitialSave:false},{id:'22222222-2222-4222-8222-222222222222',name:'second.py',text:'second',savedText:'second',needsInitialSave:false}];
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1},documents,activeId:documents[0].id}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  });
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());
  await expect(page.locator('.tab.active .tab-name')).toHaveText('first.txt');
  expect(await page.evaluate(()=>({text:window.__mdSplit.getText(),count:window._editorCreations}))).toEqual({text:'first',count:1});
  await page.locator('.tab-name').filter({hasText:'second.py'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.getText())).toBe('second');
});

test('starting with a new text file creates the editor once',async({page})=>{
  await page.addInitScript(()=>{
    window._editorCreations=0;
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches?.('.cm-editor'))window._editorCreations++;window._editorCreations+=node.querySelectorAll?.('.cm-editor').length||0;}}).observe(document,{subtree:true,childList:true});
    const listeners=[];window.chrome=window.chrome||{};window.chrome.webview={addEventListener(type,fn){if(type==='message')listeners.push(fn);},postMessage(message){
      const result=message.method==='bootstrap'?{settings:{welcomeShown:true,updateCheckDays:-1,startupFormat:'txt'},documents:[]}:true;
      setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
    }};
  });
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit?.editor());
  await expect(page.locator('.tab.active .tab-name')).toHaveText('無題.txt');
  expect(await page.evaluate(()=>window._editorCreations)).toBe(1);
});
