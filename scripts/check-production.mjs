import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {checkTheme} from './check-theme.mjs';
const root=path.resolve(import.meta.dirname,'../release/MD-Split/wwwroot');
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+pathname);if(file!==root&&!file.startsWith(root+path.sep))throw new Error();if((await stat(file)).isDirectory()){res.writeHead(403);res.end();return;}const data=await readFile(file);const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE:',m.text());});
  const origin=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin+'/')).status,403);
  await page.goto(origin+'/index.html');await page.waitForSelector('.cm-content');
  // First launch opens the help document, which already contains tables and a
  // diagram. Test in a fresh tab so its contents cannot satisfy our assertions.
  await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.tab').length===2);
  await page.locator('.cm-content').focus();await page.keyboard.insertText('# 配布版の確認\n\n**実際に配布する画面**の動作を確認します。\n\n- リストの記号\n\n> 引用と `inline code`\n\n| A | B |\n|---|---|\n|1|2|\n\n```mermaid\nflowchart LR\n A[原文] --> B[表示]\n```');
  await page.waitForSelector('.mermaid-stage svg',{timeout:30000});assert.equal(await page.locator('#preview table').count(),1);assert.equal(await page.evaluate(()=>typeof window.__mdSplit),'undefined');
  const screenshotDir=path.resolve(import.meta.dirname,'../test-results');await mkdir(screenshotDir,{recursive:true});
  await page.screenshot({path:path.join(screenshotDir,'production-preview.png')});
  const download=page.waitForEvent('download',{timeout:15000});await page.getByRole('button',{name:'PNG保存',exact:true}).click();const file=await (await download).path();const bytes=await readFile(file);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.ok(bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0);
  const themeContrast=[];
  for(const [palette,theme] of [['black','dark'],['black','light'],['green','dark'],['red','dark'],['blue','dark'],['parchment','light'],['parchment-texture','light']]){
    await page.getByRole('button',{name:'設定',exact:true}).click();await page.locator('input[name="color-theme"][value="'+palette+'"]').check();if(!palette.startsWith('parchment'))await page.locator('input[name="setting-theme"][value="'+theme+'"]').check();await page.getByRole('button',{name:'適用',exact:true}).click();await page.waitForFunction(expected=>document.documentElement.dataset.palette===expected,palette);themeContrast.push({palette,...await checkTheme(page,theme)});
  }
  assert.equal((await fetch(origin+'/paper-grain.svg')).status,200);
  assert.notEqual(await page.locator('#preview').evaluate(n=>getComputedStyle(n).backgroundImage),'none');
  await page.getByRole('button',{name:'Discord表示',exact:true}).click();assert.equal(await page.locator('#preview table').count(),0);assert.equal(await page.locator('.mermaid-stage').count(),0);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'通常のMarkdown表示',exact:true}).click();await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const readSource=async()=>{await page.getByRole('button',{name:'全文をMarkdownでコピー',exact:true}).click();return (await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n');};
  await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();await page.locator('.cm-content').focus();await page.keyboard.insertText('- first');
  await page.waitForSelector('#preview li p');await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#preview li p'));range.collapse(false);document.querySelector('#preview').focus();getSelection().removeAllRanges();getSelection().addRange(range);});
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.insertText('通常文');assert.equal(await readSource(),'- first\n\n通常文');
  await page.getByRole('button',{name:'新規作成 · Ctrl+N',exact:true}).click();await page.getByRole('button',{name:'コードブロック',exact:true}).click();await page.locator('#code-preset').selectOption('html');await page.getByRole('button',{name:'適用',exact:true}).click();await page.waitForSelector('.code-content .tok-typeName');const codeSource=await readSource();assert.ok(codeSource.startsWith('```html\n<!doctype html>'));
  await page.getByRole('button',{name:'設定',exact:true}).click();for(const id of ['line-breaks','wide-spaces','tabs','spaces'])await page.locator('#setting-'+id).check();await page.getByRole('button',{name:'適用',exact:true}).click();await page.waitForSelector('.cm-eol-marker');assert.ok(await page.locator('#preview .ws-line-break').count()>0);assert.equal(await readSource(),codeSource);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({productionBundle:'passed',rootDirectory:403,entrypoint:'/index.html',mermaid:'passed',pngExport:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},themeContrast,parchmentTexture:'passed',listExit:'passed',htmlPresetAndSyntax:'passed',whitespaceCopy:'passed',discordMode:'passed',developmentHooks:false,pageErrors:errors},null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
