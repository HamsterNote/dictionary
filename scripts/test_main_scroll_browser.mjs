/* global document, getComputedStyle, scrollY, innerHeight */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';

const phase = process.argv[2] ?? 'after';
const embedded = process.env.PREVIEW_EMBEDDED === '1';
const folder = `artifacts/main-scroll-${phase}`;
const records = [];
const server = await createTextResolutionServer();
let browser;
try {
  await mkdir(folder, { recursive: true });
  await server.listen();
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    for (const configuration of [
      { enabled: false },
      { enabled: true },
      { enabled: true, maxHeight: 480, noquery: true },
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const parameters = new URLSearchParams({
        enabled: configuration.enabled ? '1' : '0',
        ...(configuration.maxHeight ? { maxHeight: String(configuration.maxHeight) } : {}),
        ...(configuration.noquery ? { noquery: '1' } : {}),
      });
      const url = `http://127.0.0.1:${server.httpServer.address().port}`;
      await page.goto(`${url}/${embedded ? 'embedded-main-scroll' : 'main-scroll'}?${parameters}`);
      const frame = embedded ? page.frames()[1] : page.mainFrame();
      assert.ok(frame);
      await expect(frame.locator('.dictionary-popover__definition')).toHaveCount(60);
      if (configuration.enabled)
        await frame.waitForFunction(() => globalThis.mainScrollHarness.calls() === 1);
      else assert.equal(await frame.evaluate(() => globalThis.mainScrollHarness.calls()), 0);
      await frame
        .locator('.dictionary-popover')
        .evaluate((element) =>
          Promise.all(element.getAnimations().map((animation) => animation.finished)),
        );
      const capture = () =>
        frame.evaluate(() => {
          const main = document.querySelector('.dictionary-popover');
          const results = main.querySelector('.dictionary-popover__results');
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height };
          };
          return {
            main: rect(main),
            results: rect(results),
            header: rect(main.querySelector('.dictionary-popover__header')),
            search: main.querySelector('.dictionary-popover__search')
              ? rect(main.querySelector('.dictionary-popover__search'))
              : null,
            drag: rect(main.querySelector('.dictionary-popover__drag-handle')),
            overflowY: getComputedStyle(results).overflowY,
            clientHeight: results.clientHeight,
            scrollHeight: results.scrollHeight,
            scrollTop: results.scrollTop,
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: innerHeight,
            pageScrollY: scrollY,
            resolverCalls: globalThis.mainScrollHarness.calls(),
          };
        });
      const initial = await capture();
      const key = `${width}-${configuration.enabled ? 'on' : 'off'}-${configuration.maxHeight ?? 'default'}`;
      await page.screenshot({ path: `${folder}/${key}-top.png` });
      if (phase === 'before') {
        assert.equal(initial.overflowY, 'visible');
        assert.ok(initial.documentHeight > initial.viewportHeight);
        records.push({ width, configuration, initial });
      } else {
        const bounded = (sample) => {
          assert.equal(sample.overflowY, 'auto');
          assert.ok(sample.scrollHeight > sample.clientHeight);
          assert.ok(sample.documentHeight <= sample.viewportHeight + 1);
          assert.ok(sample.main.bottom <= sample.viewportHeight - 15);
          assert.ok(sample.results.bottom <= sample.main.bottom);
          if (configuration.maxHeight) assert.ok(sample.main.height <= configuration.maxHeight);
          assert.equal(sample.pageScrollY, 0);
        };
        bounded(initial);
        if (configuration.enabled) {
          await frame.evaluate(() => globalThis.mainScrollHarness.release());
          await expect(frame.locator('.dictionary-inline-resolution')).toHaveCount(0);
        }
        const ready = await capture();
        bounded(ready);
        assert.deepEqual(ready.results, initial.results);
        const results = frame.locator('.dictionary-popover__results');
        const last = frame.locator('.dictionary-popover__definition').last();
        await expect(last).not.toBeInViewport();
        await results.hover();
        await page.mouse.wheel(0, 10000);
        await expect.poll(async () => (await capture()).scrollTop).toBeGreaterThan(0);
        await expect(last).toBeInViewport();
        const scrolled = await capture();
        bounded(scrolled);
        for (const name of ['main', 'header', 'search', 'drag'])
          assert.deepEqual(scrolled[name], ready[name], `${key}: ${name} moved while scrolling`);
        await page.screenshot({ path: `${folder}/${key}-bottom.png` });
        records.push({ width, configuration, initial, ready, scrolled });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  await writeFile(`${folder}/summary.json`, JSON.stringify(records, null, 2));
  console.log(
    `Real HamsterDictionary / 60 meanings: ${records.length} ${phase} cases passed (${phase === 'before' ? 'overflow regression reproduced' : 'pending/ready and internal wheel scroll verified'}; desktop/mobile, off/on, custom maxHeight).`,
  );
} finally {
  await browser?.close();
  await server.close();
}
