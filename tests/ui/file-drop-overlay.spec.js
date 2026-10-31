import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__mdSplit);
});

async function beginFileDrag(page, selector, files) {
  await page.evaluate(({selector, files}) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([file.content], file.name, {type:file.type}));
    window.__fileDrag = transfer;
    document.querySelector(selector).dispatchEvent(new DragEvent('dragenter', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    document.querySelector(selector).dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer}));
  }, {selector, files});
}

async function completeFileDrag(page, selector) {
  await page.evaluate(selector => {
    document.querySelector(selector).dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:window.__fileDrag}));
  }, selector);
}

test('document drag shows a nonblocking overlay and drop opens it from the toolbar', async ({page}) => {
  await beginFileDrag(page, '.topbar', [{name:'dragged.txt', type:'text/plain', content:'Dropped document'}]);
  const overlay = page.locator('.file-drop-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('ファイルをドロップして開く');
  expect(await overlay.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  await completeFileDrag(page, '.topbar');
  await expect(overlay).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__mdSplit.getText())).toBe('Dropped document');
});

test('a Markdown image drop shows insertion guidance and inserts the image', async ({page}) => {
  await page.evaluate(() => window.__mdSplit.setText('begin'));
  await beginFileDrag(page, '#source', [{name:'photo.png', type:'image/png', content:'image bytes'}]);
  const overlay = page.locator('.file-drop-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('画像をドロップして挿入');
  await completeFileDrag(page, '#source');
  await expect(overlay).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__mdSplit.getText())).toContain('![photo.png](data:image/png;base64,');
});

test('overlay disappears when leaving or ending a drag and ignores non-file drags', async ({page}) => {
  await beginFileDrag(page, '#app', [{name:'note.md', type:'text/markdown', content:'# note'}]);
  const overlay = page.locator('.file-drop-overlay');
  await expect(overlay).toBeVisible();
  await page.evaluate(() => document.querySelector('#app').dispatchEvent(new DragEvent('dragleave', {bubbles:true,relatedTarget:null})));
  await expect(overlay).toBeHidden();
  await beginFileDrag(page, '#app', [{name:'note.md', type:'text/markdown', content:'# note'}]);
  await page.evaluate(() => document.querySelector('#app').dispatchEvent(new DragEvent('dragend', {bubbles:true})));
  await expect(overlay).toBeHidden();
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', 'text');
    document.querySelector('#app').dispatchEvent(new DragEvent('dragover', {bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect(overlay).toBeHidden();
});

test('a non-Markdown document does not promise image insertion', async ({page}) => {
  await beginFileDrag(page, '#app', [{name:'note.txt', type:'text/plain', content:'plain text'}]);
  await completeFileDrag(page, '#app');
  await expect.poll(() => page.evaluate(() => window.__mdSplit.getText())).toBe('plain text');
  await beginFileDrag(page, '#source', [{name:'photo.png', type:'image/png', content:'image bytes'}]);
  await expect(page.locator('.file-drop-overlay')).toContainText('画像の挿入は Markdown 文書で利用できます');
  await completeFileDrag(page, '#source');
  await expect(page.locator('.file-drop-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__mdSplit.getText())).toBe('plain text');
});

test('desktop file drops keep using the native WebView bridge', async ({page}) => {
  await page.addInitScript(() => {
    const listeners = [];
    window.__nativeDrops = [];
    window.chrome = window.chrome || {};
    const reply = (message, result) => setTimeout(() => {
      for (const listener of listeners) listener({data:{replyTo:message.id, result}});
    }, 0);
    window.chrome.webview = {
      addEventListener(name, handler) { if (name === 'message') listeners.push(handler); },
      postMessage(message) {
        if (message.method === 'bootstrap') reply(message, {settings:{welcomeShown:true, updateCheckDays:-1}, documents:[{id:'11111111-1111-4111-8111-111111111111',name:'note.md',text:'native text',savedText:'native text',encoding:'utf8'}]});
        else reply(message, true);
      },
      postMessageWithAdditionalObjects(message, objects) {
        window.__nativeDrops.push({method:message.method, names:Array.from(objects, file => file.name)});
        reply(message, true);
      }
    };
  });
  await page.reload();
  await page.waitForFunction(() => window.__mdSplit);
  await beginFileDrag(page, '.topbar', [{name:'dragged.md', type:'text/markdown', content:'# Example'}]);
  await expect(page.locator('.file-drop-overlay')).toContainText('ファイルをドロップして開く');
  await completeFileDrag(page, '.topbar');
  await expect(page.locator('.file-drop-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__nativeDrops)).toEqual([{method:'file.drop', names:['dragged.md']}]);
});
