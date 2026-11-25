import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { test } from '@playwright/test';

const counts = [100, 500, 1000, 5000, 10000];
const trials = 3;
const columns = 6;
const preview = '#text-preview .text-preview-scroll';
const modes = { paged: 'paged', all: 'all' };
const promptName = '大きな表のプレビュー';
const accept = { paged: '表示する', all: '⚠️ 無制限で表示' };
const activeTab = '.tab.active .tab-name';
const table = '#text-preview .text-preview-scroll table';
const report = value => console.log('CSV_BENCH ' + JSON.stringify(value));

function contents(rows) {
  const header = ['ID', 'Name', 'Group', 'Status', 'Date', 'Note'].join(',');
  const records = Array.from({ length: rows - 1 }, (_, i) => [
    String(i + 1).padStart(5, '0'), 'Record ' + String(i + 1).padStart(5, '0'),
    'Group ' + ((i % 20) + 1), i % 2 ? 'Active' : 'Pending', '2026-11-25', 'Synthetic data with a short note'
  ].join(','));
  return [header, ...records].join('\r\n') + '\r\n';
}

async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForGrid(page, name, renderedRows) {
  await page.waitForFunction(({ activeTab, table, name, renderedRows }) => {
    const grid = document.querySelector(table);
    return document.querySelector(activeTab)?.textContent === name &&
      grid?.tBodies[0]?.rows.length === renderedRows &&
      grid.getBoundingClientRect().height > 0;
  }, { activeTab, table, name, renderedRows }, { timeout: 45000 });
  await frames(page);
}

async function viewState(scroller) {
  return scroller.evaluate(node => {
    const rows = node.querySelector('tbody').rows;
    const visible = node.getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    return {
      first: Number(rows[0].dataset.gridRow),
      last: Number(rows[rows.length - 1].dataset.gridRow),
      top: node.scrollTop,
      max: node.scrollHeight - node.clientHeight,
      client: node.clientHeight,
      lastVisible: last.top < visible.bottom && last.bottom > visible.top,
    };
  });
}

async function verifyScroll(page, records, mode) {
  const scroller = page.locator(preview);
  const rect = await scroller.boundingBox();
  assert(rect?.height > 0);
  const start = await viewState(scroller);
  assert.equal(start.first, 1);
  await page.mouse.move(rect.x + Math.min(25, rect.width / 2), rect.y + rect.height * 0.7);
  await page.mouse.wheel(0, 440);
  await frames(page);
  let previous = await viewState(scroller);
  assert(previous.top > start.top || previous.first > start.first, 'wheel did not scroll down');
  let shifts = previous.first > start.first ? 1 : 0;
  let gestures = 1;
  let stalled = 0;
  const chunk = mode === modes.all ? Math.max(1600, Math.ceil(start.max / 12)) : 8000;
  const maxGestures = mode === modes.all ? 35 : Math.ceil(records / 50) + 35;
  while (previous.last !== records - 1 || !previous.lastVisible || previous.max - previous.top > 3) {
    if (++gestures > maxGestures) throw new Error('The wheel never reached the last CSV row: ' + JSON.stringify(previous));
    await page.mouse.wheel(0, chunk);
    await frames(page);
    const now = await viewState(scroller);
    assert(now.first >= previous.first);
    if (now.first > previous.first) shifts++;
    if (now.first === previous.first && Math.abs(now.top - previous.top) < 1) stalled++;
    else stalled = 0;
    if (stalled > 7) throw new Error('The table stopped responding to the wheel: ' + JSON.stringify(now));
    previous = now;
  }
  const bottom = previous;
  await page.mouse.wheel(0, -Math.min(450, bottom.client / 2));
  await frames(page);
  assert((await viewState(scroller)).top < bottom.top, 'wheel did not scroll back up');
  if (mode === modes.all) assert.equal(shifts, 0);
  if (mode === modes.paged && records > 101) assert(shifts > 0, 'the table never advanced to the next window');
  return { gestures, shifts, lastDataRow: bottom.last, up: true };
}

async function applyUnlimited(page, name, renderedRows) {
  await page.getByRole('button', { name: '表示設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'CSVの表示設定', exact: true });
  await dialog.locator('#csv-page-mode').selectOption('unlimited');
  const tick = performance.now();
  await dialog.getByRole('button', { name: '適用', exact: true }).click();
  await waitForGrid(page, name, renderedRows);
  return performance.now() - tick;
}


test('measure CSV files and scroll to their last row in both display modes', async ({page}, info) => {
  test.setTimeout(240000);
  await page.addInitScript(() => localStorage.setItem('mdsplit.settings', JSON.stringify({language:'ja',welcomeShown:true,updateCheckDays:-1})));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__mdSplit?.openDocument === 'function');
  const root=info.outputPath('csv-fixtures');
  await mkdir(root,{recursive:true});
  const warm=join(root,'warm-up.csv');
  await writeFile(warm,contents(5));
  const picker=page.locator('#file-input');
  await picker.setInputFiles(warm);
  await waitForGrid(page,basename(warm),4);
  report({environment:{platform:process.platform,cpu:cpus()[0].model,logicalCpus:cpus().length,ramBytes:totalmem(),chrome:page.context().browser().version(),viewport:page.viewportSize(),columns,trials}});
  for(const records of counts){
    const text=contents(records);
    const byteSize=Buffer.byteLength(text,'utf8');
    for(const mode of records>1000?[modes.paged,modes.all]:[modes.paged]){
      for(let trial=1;trial<=trials;trial++){
        const name=[records,mode,trial].join('-')+'.csv',path=join(root,name);
        await writeFile(path,text);
        const start=performance.now();
        await picker.setInputFiles(path);
        let promptMs=null,renderMs=null;
        if(records>1000){
          const dialog=page.getByRole('dialog',{name:promptName,exact:true});
          await dialog.waitFor({state:'visible',timeout:45000});
          promptMs=performance.now()-start;
          const tick=performance.now();
          await dialog.getByRole('button',{name:accept[mode],exact:true}).click();
          await waitForGrid(page,name,mode===modes.all?records-1:100);
          renderMs=performance.now()-tick;
        }else{
          await waitForGrid(page,name,Math.min(100,records-1));
        }
        const openMs=promptMs===null?performance.now()-start:promptMs+renderMs;
        report({records,mode,trial,byteSize,openMs,promptMs,renderMs});
        if(trial===1)report({records,mode,scroll:await verifyScroll(page,records,mode)});
        if(records<=1000){
          const switchMs=await applyUnlimited(page,name,records-1);
          report({records,mode:modes.all,trial,byteSize,switchMs});
          if(trial===1){
            await page.locator(preview).evaluate(node=>{node.scrollTop=0;});
            await frames(page);
            report({records,mode:modes.all,scroll:await verifyScroll(page,records,modes.all)});
          }
        }
        await page.locator('.tab.active .tab-close').click();
        await waitForGrid(page,basename(warm),4);
      }
    }
  }
  report({complete:true});
});
