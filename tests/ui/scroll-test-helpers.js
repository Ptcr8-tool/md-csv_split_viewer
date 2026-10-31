// Synchronization has an explicit guard against feedback between the two panes.
// Wait for the guard itself, instead of assuming it expires within a fixed delay.
export async function waitForScrollReady(page) {
  await page.waitForFunction(() => typeof window.__mdSplitScrollReady === 'function' && window.__mdSplitScrollReady());
}

// Scroll events are dispatched on a rendering frame; the second frame allows
// their synchronous handlers and any resulting layout to complete.
export async function settleScroll(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await waitForScrollReady(page);
}
