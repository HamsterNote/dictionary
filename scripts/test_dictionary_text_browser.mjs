/* global document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';

const server = await createTextResolutionServer();
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const reset = async () => {
      await page.goto(`http://127.0.0.1:${address.port}/benchmark`);
      await page.waitForFunction(() => typeof globalThis.resolutionHarness === 'object');
    };
    await reset();
    for (const word of ['cold-disabled', 'replacement-disabled']) {
      await page.evaluate((word) => globalThis.resolutionHarness.render(word, false), word);
      await expect(page.locator('.dictionary-popover__word')).toHaveText(word);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => globalThis.resolutionStats().calls), 0);
      await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
    }
    await page.evaluate(() => globalThis.resolutionHarness.renderSync(true, false));
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => globalThis.resolutionStats().syncCalls), 0);
    await reset();
    await page.evaluate(() => {
      globalThis.resolutionHarness.hold();
      globalThis.resolutionHarness.render('cancel-toggle');
    });
    await page.waitForFunction(() => globalThis.resolutionStats().calls === 1);
    await page.evaluate(() => globalThis.resolutionHarness.render('cancel-toggle', false));
    await expect(page.locator('.dictionary-inline-resolution')).toHaveCount(0);
    await page.evaluate(() => globalThis.resolutionHarness.release());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => globalThis.resolutionStats().calls), 1);
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
    await page.evaluate(() => globalThis.resolutionHarness.unmount());
    for (const fallback of [false, true]) {
      await reset();
      await page.evaluate((fallback) => {
        if (fallback) {
          delete globalThis.requestIdleCallback;
          delete globalThis.IntersectionObserver;
        }
        globalThis.resolutionHarness.hold();
        document.getElementById('start').click();
      }, fallback);
      await page.waitForFunction(() => globalThis.resolutionStats().calls === 1);
      await page.locator('.dictionary-popover__definition').last().scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        globalThis.resolutionHarness.release();
      });
      await expect(
        page.locator('.dictionary-popover__definition').last().locator('[role=button]'),
      ).toHaveCount(24);
      const stats = await page.evaluate(() => globalThis.resolutionStats());
      assert.equal(stats.concurrency, 1);
      assert.ok(
        stats.trace.indexOf('wordbrk') < stats.trace.indexOf('wordaay') ||
          !stats.trace.includes('wordaay'),
        'scrolled-to paragraph should finish before the middle',
      );
      assert.ok(
        stats.calls < 1152,
        'visible text is interactive before the whole article finishes',
      );
      await page.evaluate(() => globalThis.resolutionHarness.unmount());
    }

    await reset();
    await page.evaluate(() => {
      globalThis.resolutionHarness.hold();
      document.getElementById('start').click();
    });
    await page.waitForFunction(() => globalThis.resolutionStats().calls === 1);
    await page.evaluate(() => globalThis.resolutionHarness.render('replacement'));
    await expect(page.locator('.dictionary-popover__word')).toHaveText('replacement');
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
    await page.evaluate(() => globalThis.resolutionHarness.release());
    await expect(page.locator('.dictionary-popover__inline-word').first()).toBeVisible();
    const switched = await page.evaluate(() => globalThis.resolutionStats());
    assert.equal(switched.concurrency, 1);
    assert.deepEqual(
      switched.trace.slice(0, 2),
      ['wordaaa', 'wordaaa'],
      'replacement starts a new reader, without advancing the old one',
    );
    await page.evaluate(() => globalThis.resolutionHarness.unmount());

    await reset();
    await page.evaluate(() => {
      globalThis.resolutionHarness.hold();
      document.getElementById('start').click();
    });
    await page.waitForFunction(() => globalThis.resolutionStats().calls === 1);
    await page.evaluate(async () => {
      globalThis.resolutionHarness.unmount();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      globalThis.resolutionHarness.release();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    assert.equal(await page.evaluate(() => globalThis.resolutionStats().calls), 1);
    await expect(page.locator('.dictionary-content')).toHaveCount(0);

    await reset();
    await page.evaluate(() => {
      globalThis.resolutionHarness.fail();
      document.getElementById('start').click();
    });
    await page.getByRole('button', { name: '重试点词加载' }).click();
    await expect(page.locator('.dictionary-inline-resolution')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(1152);
    assert.equal(await page.evaluate(() => globalThis.resolutionStats().concurrency), 1);
    await page.evaluate(() => globalThis.resolutionHarness.renderSync(false));
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
    await page.evaluate(() => globalThis.resolutionHarness.renderSync(true));
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(1152);
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    'Desktop/mobile text readers: viewport reprioritization (idle/timer fallback), partial readiness, replacement, unmount and retry passed.\n',
  );
} finally {
  await browser?.close();
  await server.close();
}
