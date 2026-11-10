/* global document, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';
const server = await createTextResolutionServer();
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 } });
    const url = `http://127.0.0.1:${server.httpServer.address().port}/layout`;
    await page.goto(url + '?enabled=0');
    await page.waitForFunction(() => !!globalThis.layoutHarness);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => globalThis.layoutHarness.calls()), 0);
    const capture = () =>
      page.evaluate(() => {
        const rects = [];
        for (const el of document.querySelectorAll('.dictionary-popover__definition')) {
          const rect = el.getBoundingClientRect();
          rects.push([rect.x, rect.y, rect.width, rect.height]);
          const walker = document.createTreeWalker(el, 4);
          let n;
          while ((n = walker.nextNode()))
            for (let i = 0; i < n.length; i++)
              if (n.textContent[i] !== '\u2060') {
                const range = document.createRange();
                range.setStart(n, i);
                range.setEnd(n, i + 1);
                const r = range.getBoundingClientRect();
                rects.push([r.x, r.y, r.width, r.height]);
              }
        }
        return rects;
      });
    const baseline = await capture();
    const compare = async (state) => {
      const rects = await capture();
      assert.equal(rects.length, baseline.length);
      let delta = 0;
      rects.forEach((r, i) =>
        r.forEach((v, k) => (delta = Math.max(delta, Math.abs(v - baseline[i][k])))),
      );
      assert.ok(delta <= 0.1, `${width} ${state} ${delta}`);
      results.push({ width, state, maxDelta: delta, rects });
    };
    await page.evaluate(() => {
      globalThis.layoutHarness.fail();
      globalThis.layoutHarness.render(true);
    });
    await page.waitForFunction(() => globalThis.layoutHarness.calls() === 1);
    await compare('pending');
    await page.evaluate(() => globalThis.layoutHarness.release());
    await expect(page.getByRole('button', { name: '重试点词加载' })).toBeVisible();
    await compare('error');
    await page.getByRole('button', { name: '重试点词加载' }).click();
    await expect(page.locator('.dictionary-inline-resolution')).toHaveCount(0);
    await compare('retry-ready');
    const word = page.locator('.dictionary-popover__inline-word').first();
    await word.hover();
    await compare('hover');
    await word.focus();
    await compare('focus');
    const styles = await word.evaluate((el) => {
      const parent = el.closest('.dictionary-popover__definition'),
        word = getComputedStyle(el),
        text = getComputedStyle(parent);
      const names = [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'fontStretch',
        'fontVariant',
        'lineHeight',
        'letterSpacing',
        'wordSpacing',
        'fontFeatureSettings',
        'fontKerning',
        'whiteSpace',
        'wordBreak',
        'overflowWrap',
        'textWrap',
      ];
      return {
        word: Object.fromEntries(names.map((k) => [k, word[k]])),
        text: Object.fromEntries(names.map((k) => [k, text[k]])),
        box: [word.display, word.margin, word.padding, word.borderWidth],
      };
    });
    assert.deepEqual(styles.word, styles.text);
    assert.deepEqual(styles.box, ['inline', '0px', '0px', '0px']);
    results.push({ width, styles });
    const calls = await page.evaluate(() => globalThis.layoutHarness.calls());
    await page.evaluate(() => globalThis.layoutHarness.render(false));
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
    await compare('disabled');
    assert.equal(await page.evaluate(() => globalThis.layoutHarness.calls()), calls);
    await page.evaluate(() => globalThis.layoutHarness.render(true));
    await expect(page.locator('.dictionary-inline-resolution')).toHaveCount(0);
    await compare('reenabled');
    await page.close();
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/definition-states.json', JSON.stringify(results));
  console.log(
    'Disabled cold start: zero resolver calls; pending/error/retry/hover/focus/off/on geometry and computed styles passed on both viewports.',
  );
} finally {
  await browser?.close();
  await server.close();
}
