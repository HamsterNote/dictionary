/* global document, innerHeight, scrollY */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';
const server = await createTextResolutionServer();
let browser;
const records = [];
try {
  await server.listen();
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      hasTouch: true,
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/layout`);
    await page.waitForFunction(() => globalThis.layoutHarness?.calls() === 1);
    await page.evaluate(() => globalThis.layoutHarness.release());
    await expect(page.locator('.dictionary-inline-resolution')).toHaveCount(0);
    const candidates = await page.evaluate(() => {
      const words = [...document.querySelectorAll('.dictionary-popover__inline-word')];
      return words
        .map((word, index) => {
          const paragraph = word.closest('.dictionary-popover__definition');
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          range.setEnd(word, 0);
          return {
            index,
            name: word.getAttribute('aria-label'),
            paragraphIndex: [
              ...document.querySelectorAll('.dictionary-popover__definition'),
            ].indexOf(paragraph),
            sourceOffset: range.toString().replaceAll('\u2060', '').length,
            rect: word.getClientRects()[0]?.toJSON(),
          };
        })
        .filter((w) => w.rect && w.rect.y > 0 && w.rect.bottom < innerHeight - 80)
        .sort((a, b) => b.rect.right - a.rect.right)
        .filter(
          (word, index, words) =>
            words.findIndex((other) => Math.abs(other.rect.y - word.rect.y) < 0.1) === index,
        )
        .slice(0, 3);
    });
    assert.equal(candidates.length, 3);
    for (const target of candidates) {
      const x = target.rect.x + target.rect.width / 2,
        y = target.rect.y + target.rect.height / 2;
      await page.evaluate(() => globalThis.layoutHarness.render(false));
      await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
      const previousCalls = await page.evaluate(() => globalThis.layoutHarness.calls());
      await page.evaluate(() => {
        globalThis.layoutHarness.hold();
        globalThis.layoutHarness.render(true);
      });
      await page.waitForFunction(
        (count) => globalThis.layoutHarness.calls() === count + 1,
        previousCalls,
      );
      for (let i = 0; i < 10; i++) {
        if (i === 3) await page.evaluate(() => globalThis.layoutHarness.release());
        await page.mouse.click(x, y);
        const dialog = page.getByRole('dialog');
        const name = (await dialog.count()) ? await dialog.locator('h3').textContent() : null;
        if (i < 3) assert.equal(name, null);
        else if (name !== null) assert.equal(name, target.name);
        if (i === 9) assert.equal(name, target.name);
        records.push({
          width,
          target: target.name,
          paragraphIndex: target.paragraphIndex,
          sourceOffset: target.sourceOffset,
          x,
          y,
          attempt: i,
          actual: name,
          time: Date.now(),
        });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      }
      await expect(page.locator('.dictionary-inline-resolution')).toHaveCount(0);
      const word = page.locator('.dictionary-popover__inline-word').nth(target.index);
      await word.tap();
      await expect(page.getByRole('dialog', { name: target.name })).toBeVisible();
      await page.keyboard.press('Escape');
      for (const key of ['Enter', 'Space']) {
        await word.focus();
        await word.press(key);
        await expect(page.getByRole('dialog', { name: target.name })).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
    await page.locator('.dictionary-popover__inline-word').first().focus();
    const before = await page.evaluate(() => ({
      scroll: scrollY,
      calls: globalThis.layoutHarness.calls(),
    }));
    await page.evaluate(() => globalThis.layoutHarness.render(false));
    await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
    await expect(page.locator('.dictionary-content')).toBeFocused();
    for (const target of candidates)
      await page.mouse.click(
        target.rect.x + target.rect.width / 2,
        target.rect.y + target.rect.height / 2,
      );
    for (const target of candidates)
      await page.touchscreen.tap(
        target.rect.x + target.rect.width / 2,
        target.rect.y + target.rect.height / 2,
      );
    await page.locator('.dictionary-content').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual(
      await page.evaluate(() => ({ scroll: scrollY, calls: globalThis.layoutHarness.calls() })),
      before,
    );
    await page.close();
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/definition-interactions.json', JSON.stringify(records, null, 2));
  console.log(
    '60 fixed-coordinate activations, touch, Enter/Space, Escape and disabled focus/call-count checks passed.',
  );
} finally {
  await browser?.close();
  await server.close();
}
