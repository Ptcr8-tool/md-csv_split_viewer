import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

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

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || !process.env.RUNNER_TEMP) {
  throw new Error('This benchmark requires a disposable GitHub-hosted Windows runner.');
}

function contents(rows) {
  const header = ['ID', 'Name', 'Group', 'Status', 'Date', 'Note'].join(',');
  const records = Array.from({ length: rows - 1 }, (_, i) => [
    String(i + 1).padStart(5, '0'), 'Record ' + String(i + 1).padStart(5, '0'),
    'Group ' + ((i % 20) + 1), i % 2 ? 'Active' : 'Pending', '2026-11-25', 'Synthetic data with a short note'
  ].join(','));
  return [header, ...records].join('\r\n') + '\r\n';
}

async function waitForWindow(port) {
  const endpoint = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 180; i++) {
    try {
      const response = await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).some(target => target.url.startsWith('https://app.mdsplit.local/'))) return endpoint;
    } catch {}
    await delay(350);
  }
  throw new Error('WebView2 CDP window did not become ready.');
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

const root = await mkdtemp(join(process.env.RUNNER_TEMP, 'mdsplit-csv-perf-'));
const source = resolve(process.argv[2] ?? 'release/MD-Split');
const application = join(root, 'Application');
await cp(source, application, { recursive: true });
const runtime = join(application, 'WebView2Runtime');
for (const sid of ['*S-1-15-2-2:(OI)(CI)(RX)', '*S-1-15-2-1:(OI)(CI)(RX)']) {
  execFileSync(join(process.env.WINDIR, 'System32', 'icacls.exe'), [runtime, '/grant', sid, '/T', '/Q']);
}
const data = join(application, 'Data');
await mkdir(data, { recursive: true });
await writeFile(join(data, 'settings.json'), JSON.stringify({
  language: 'ja', welcomeShown: true, updateCheckDays: -1, openPolicy: 'tabs', sessionPolicy: 'clear'
}));
const warm = join(root, 'warm-up.csv');
await writeFile(warm, contents(5));
const files = new Map();
for (const records of counts) {
  const text = contents(records);
  const byteSize = Buffer.byteLength(text, 'utf8');
  for (const trial of Array.from({ length: trials }, (_, i) => i + 1)) {
    for (const mode of records > 1000 ? [modes.paged, modes.all] : [modes.paged]) {
      const path = join(root, [records, mode, trial].join('-') + '.csv');
      await writeFile(path, text);
      files.set([records, mode, trial].join(':'), { path, byteSize });
    }
  }
}

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const exe = join(application, 'MD-Split.exe');
const app = spawn(exe, [warm], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port + ' --remote-debugging-address=127.0.0.1' },
  stdio: 'ignore',
});
let browser;
try {
  browser = await chromium.connectOverCDP(await waitForWindow(port));
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith('https://app.mdsplit.local/'));
  assert(page);
  await waitForGrid(page, basename(warm), 4);
  report({ environment: { platform: process.platform, cpu: cpus()[0].model, logicalCpus: cpus().length, ramBytes: totalmem(), chrome: browser.version(), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), columns, trials } });
  for (const records of counts) {
    for (const mode of records > 1000 ? [modes.paged, modes.all] : [modes.paged]) {
      for (let trial = 1; trial <= trials; trial++) {
        const { path, byteSize } = files.get([records, mode, trial].join(':'));
        const name = basename(path);
        const openStart = performance.now();
        const opener = spawn(exe, [path], { stdio: 'ignore' });
        const exit = once(opener, 'exit');
        const prompt = page.getByRole('dialog', { name: promptName, exact: true });
        let promptMs = null;
        let renderMs = null;
        if (records > 1000) {
          await prompt.waitFor({ state: 'visible', timeout: 45000 });
          const click = prompt.getByRole('button', { name: accept[mode], exact: true });
          promptMs = performance.now() - openStart;
          const renderStart = performance.now();
          await click.click();
          await waitForGrid(page, name, mode === modes.all ? records - 1 : 100);
          renderMs = performance.now() - renderStart;
        } else {
          await waitForGrid(page, name, Math.min(100, records - 1));
        }
        const openMs = promptMs === null ? performance.now() - openStart : promptMs + renderMs;
        assert.equal((await exit)[0], 0);
        report({ records, mode, trial, byteSize, openMs, promptMs, renderMs });
        if (trial === 1) report({ records, mode, scroll: await verifyScroll(page, records, mode) });
        if (records <= 1000) {
          const switchMs = await applyUnlimited(page, name, records - 1);
          report({ records, mode: modes.all, trial, byteSize, switchMs });
          if (trial === 1) {
            await page.locator(preview).evaluate(node => { node.scrollTop = 0; });
            await frames(page);
            report({ records, mode: modes.all, scroll: await verifyScroll(page, records, modes.all) });
          }
        }
        await page.locator('.tab.active .tab-close').click();
        await waitForGrid(page, basename(warm), 4);
      }
    }
  }
  report({ complete: true });
} finally {
  app.kill();
  await browser?.close();
}
