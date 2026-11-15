import {test,expect} from '@playwright/test';

async function desktop(page){
  await page.addInitScript(()=>{
    const listeners=[];window._guideCalls=[];window._guideSaved={};
    window.chrome=window.chrome||{};
    window.chrome.webview={
      addEventListener(name,fn){if(name==='message')listeners.push(fn);},
      postMessage(message){
        window._guideCalls.push(message);let result=true;
        if(message.method==='bootstrap')result={settings:{welcomeShown:true,language:'ja',updateCheckDays:-1},documents:[{id:'11111111-1111-4111-8111-111111111111',name:'other.md',path:'C:\\notes\\other.md',text:'keep another document',savedText:'keep another document',encoding:'utf8'}]};
        if(message.method==='file.save'){
          const doc=message.args.document,path='C:\\notes\\MD-CSV Split Editor の使い方.md';
          window._guideSaved[path]=doc.text;
          result={path,name:'MD-CSV Split Editor の使い方.md',text:doc.text,encoding:doc.encoding,hasBom:doc.hasBom,fingerprint:'saved-guide-fixture'};
        }
        setTimeout(()=>listeners.forEach(fn=>fn({data:{replyTo:message.id,result}})),0);
      }
    };
  });
  await page.goto('/');await page.waitForFunction(()=>window.__mdSplit);
}
async function openGuide(page){
  const previous=await page.evaluate(()=>window.__mdSplit.model().id);
  await page.getByRole('button',{name:'使い方とショートカット',exact:true}).click();
  await page.getByRole('button',{name:'編集できるガイドを開く',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().id)).not.toBe(previous);
  return page.evaluate(()=>({id:window.__mdSplit.model().id,text:window.__mdSplit.getText(),path:window.__mdSplit.model().path}));
}
async function prepend(page,text){
  await page.evaluate(()=>{const editor=window.__mdSplit.editor();editor.dispatch({selection:{anchor:0}});editor.focus();});
  await page.keyboard.insertText(text);
}

test('reopening the guide returns the original after saving edits and keeps saved and dirty copies',async({page})=>{
  await desktop(page);
  const original=await openGuide(page);
  expect(original.path).toBeNull();
  expect(original.text.slice(0,1200)).toContain('名前を付けて保存');
  await prepend(page,'SAVED_GUIDE_EDIT\n\n');
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(()=>page.evaluate(()=>window._guideCalls.filter(c=>c.method==='file.save').length)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  await prepend(page,'OVERWRITTEN_GUIDE_EDIT\n\n');
  await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(()=>window._guideCalls.filter(c=>c.method==='file.save').length)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>window.__mdSplit.model().dirty)).toBe(false);
  expect(await page.evaluate(()=>window._guideCalls.filter(c=>c.method==='file.save').map(c=>c.args.saveAs))).toEqual([true,false]);
  const saved=await page.evaluate(()=>({id:window.__mdSplit.model().id,path:window.__mdSplit.model().path,text:window.__mdSplit.getText()}));
  expect(saved.id).toBe(original.id);
  expect(saved.text).toContain('SAVED_GUIDE_EDIT');expect(saved.text).toContain('OVERWRITTEN_GUIDE_EDIT');
  const fresh=await openGuide(page);
  expect(fresh.id).not.toBe(saved.id);expect(fresh.path).toBeNull();expect(fresh.text).toBe(original.text);
  expect(await page.evaluate(id=>window.__mdSplit.documents().find(d=>d.id===id).raw,saved.id)).toBe(saved.text);
  expect(await page.evaluate(path=>window._guideSaved[path],saved.path)).toBe(saved.text);
  await prepend(page,'UNSAVED_GUIDE_EDIT\n\n');
  const dirtyId=fresh.id;
  const again=await openGuide(page);
  expect(again.text).toBe(original.text);expect(again.path).toBeNull();
  expect(await page.evaluate(id=>({raw:window.__mdSplit.documents().find(d=>d.id===id).raw,dirty:window.__mdSplit.documents().find(d=>d.id===id).dirty}),dirtyId)).toEqual({raw:'UNSAVED_GUIDE_EDIT\n\n'+original.text,dirty:true});
  expect(await page.evaluate(()=>window.__mdSplit.documents().find(d=>d.name==='other.md').raw)).toBe('keep another document');
  expect(await page.evaluate(()=>window._guideCalls.filter(c=>c.method==='file.save').length)).toBe(2);
});
