/* global document */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';

const mode = process.argv[2] ?? 'after';
const embedded = process.env.PREVIEW_EMBEDDED === '1';
const server = await createTextResolutionServer();
const results = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const dir = `artifacts/preview-contract-${mode}`;
  await mkdir(dir, { recursive: true });
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 900 : 844 },
        colorScheme: theme,
      });
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/${embedded ? 'embedded-preview' : 'preview-contract'}`,
      );
      const frame = embedded ? page.frames().find((f) => f.parentFrame()) : page.mainFrame();
      assert.ok(frame);
      const anchor = frame.getByRole('button', { name: 'probe', exact: true });
      await anchor.waitFor();
      await anchor.click();
      const preview = frame.locator('.dictionary-word-preview');
      await preview.waitFor();
      await page.waitForTimeout(200);
      results.push(
        await frame.evaluate(
          ({ width, theme }) => {
            const a = document
              .querySelector('.dictionary-popover__inline-word')
              .getBoundingClientRect();
            const p = document.querySelector('.dictionary-word-preview').getBoundingClientRect();
            return {
              width,
              theme,
              anchor: a.toJSON(),
              preview: p.toJSON(),
              gap: p.top - a.bottom,
              detailCalls: globalThis.previewHarness.calls,
              text: document.querySelector('.dictionary-word-preview').textContent,
            };
          },
          { width, theme },
        ),
      );
      await page.screenshot({ path: `${dir}/${width}-${theme}.png` });
      await page.close();
    }
  await writeFile(`${dir}/summary.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
