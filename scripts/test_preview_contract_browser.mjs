/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';

const embedded = process.env.PREVIEW_EMBEDDED === '1';
const server = await createTextResolutionServer();
const records = [];
let browser;
const clean = (s) => s.replaceAll('\u2060', '');
try {
  await server.listen();
  browser = await chromium.launch();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const dir = 'artifacts/preview-contract-after';
  await mkdir(dir, { recursive: true });
  for (const width of process.env.PREVIEW_VARIANTS_ONLY ? [] : [1440, 390])
    for (const theme of ['light', 'dark']) {
      const height = width === 1440 ? 900 : 844;
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
      await page.goto(`${origin}/${embedded ? 'embedded-preview' : 'preview-contract'}`);
      const frame = embedded ? page.frames().find((f) => f.parentFrame()) : page.mainFrame();
      assert.ok(frame);
      const anchor = frame.getByRole('button', { name: 'probe', exact: true });
      await anchor.waitFor();
      assert.deepEqual(
        await frame.evaluate(() => globalThis.previewHarness.calls),
        [],
        'candidates must not prefetch detail',
      );
      const move = async (x, y) => {
        await frame.evaluate(
          ({ x, y }) => {
            const host = document.getElementById('host');
            const a = document
              .querySelector('.dictionary-popover__inline-word')
              .getBoundingClientRect();
            host.style.left = `${parseFloat(host.style.left) + x - a.left}px`;
            host.style.top = `${parseFloat(host.style.top) + y - a.top}px`;
          },
          { x, y },
        );
      };
      const sample = async (scenario, count = 6) => {
        const frames = await frame.evaluate(async (count) => {
          const samples = [];
          for (let i = 0; i < count; i++) {
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            const p = document.querySelector('.dictionary-word-preview');
            if (!p || getComputedStyle(p).visibility !== 'visible') continue;
            samples.push({
              time: performance.now(),
              rect: p.getBoundingClientRect().toJSON(),
              layout: JSON.parse(p.dataset.layout),
              transform: getComputedStyle(p).transform,
            });
          }
          return samples;
        }, count);
        assert.ok(frames.length, scenario);
        for (const { rect: p, layout: l, transform } of frames) {
          const a = l.anchor,
            v = l.viewport;
          const s = { left: v.left + 8, top: v.top + 8, right: v.right - 8, bottom: v.bottom - 8 };
          const b = Math.max(0, s.bottom - a.bottom - 4),
            t = Math.max(0, a.top - s.top - 4);
          const h = Math.min(l.naturalHeight, 420, 0.6 * (v.bottom - v.top));
          const side = b >= h ? 'bottom' : t >= h ? 'top' : b >= t ? 'bottom' : 'top';
          const gap = side === 'bottom' ? p.top - a.bottom : a.top - p.bottom;
          assert.ok(Math.abs(gap - 4) <= 1, `${scenario}: gap ${gap}`);
          assert.equal(l.side, side);
          assert.ok(
            Math.abs(
              p.left -
                Math.min(Math.max(a.left, s.left), s.right - Math.min(280, s.right - s.left)),
            ) <= 1,
          );
          assert.ok(
            p.left >= s.left - 1 &&
              p.right <= s.right + 1 &&
              p.top >= s.top - 1 &&
              p.bottom <= s.bottom + 1,
            scenario,
          );
          assert.equal(transform, 'none');
        }
        records.push({ width, theme, scenario, frames });
        return frames;
      };
      // Three cold openings at every position, including the first visible loading/ready frames.
      for (let run = 1; run <= 3; run++)
        for (const [name, x, y] of [
          ['center', width / 2 - 20, height / 2 - 10],
          ['top-left', 8, 12],
          ['top-right', width - 45, 12],
          ['bottom-left', 8, height - 32],
          ['bottom-right', width - 45, height - 32],
          ['growth-flip', 40, height * 0.62],
        ]) {
          await move(x, y);
          await frame.evaluate(() => globalThis.previewHarness.hold());
          const before = await frame
            .locator('.dictionary-popover__definition')
            .first()
            .boundingBox();
          await anchor.click();
          await sample(`${name}-${run}-loading`);
          await frame.evaluate(() => globalThis.previewHarness.release());
          await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
          const ready = await sample(`${name}-${run}-ready`);
          if (name.startsWith('bottom')) assert.equal(ready[0].layout.side, 'top');
          assert.deepEqual(
            await frame.locator('.dictionary-popover__definition').first().boundingBox(),
            before,
          );
          if (run === 1 && name === 'center') {
            assert.deepEqual(
              await frame.locator('.dictionary-word-preview__group h4').allTextContents(),
              ['v.', 'n.', 'adj.', '未标注词性'],
            );
            assert.equal(await frame.locator('.dictionary-word-preview__group li').count(), 29);
            assert.deepEqual(
              (
                await frame
                  .locator('.dictionary-word-preview__group')
                  .nth(1)
                  .locator('li')
                  .allTextContents()
              ).map(clean),
              ['B probe来源甲', 'E probe来源乙'],
            );
            const last = frame.locator('.dictionary-word-preview__group li').last();
            await last.scrollIntoViewIfNeeded();
            await expect(last).toBeInViewport();
            await expect(
              frame.getByRole('button', { name: '在主窗口打开 probe' }),
            ).toBeInViewport();
            await page.screenshot({ path: `${dir}/${width}-${theme}-full.png` });
          }
          await page.keyboard.press('Escape');
          await expect(frame.locator('.dictionary-word-preview')).toHaveCount(0);
        }
      // A late response must not overwrite B, reopen after close, or survive disabling/unmounting.
      await move(40, 200);
      await frame.evaluate(() => globalThis.previewHarness.hold());
      await anchor.click();
      await frame.getByRole('button', { name: 'next', exact: true }).click();
      await frame.evaluate(() => globalThis.previewHarness.release());
      await expect(frame.getByRole('dialog', { name: 'next' })).toBeVisible();
      assert.ok(
        !(await frame.locator('.dictionary-word-preview').textContent()).includes('A probe'),
      );
      await page.keyboard.press('Escape');
      await frame.evaluate(() => globalThis.previewHarness.fail(true));
      await anchor.click();
      await expect(frame.getByRole('alert')).toContainText('释义加载失败');
      await frame.evaluate(() => globalThis.previewHarness.fail(false));
      await frame.getByRole('button', { name: '重新加载释义' }).click();
      await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
      await page.keyboard.press('Escape');
      await frame.evaluate(() => globalThis.previewHarness.empty(true));
      await anchor.click();
      await expect(frame.locator('.dictionary-word-preview')).toContainText('摘要（暂无完整释义）');
      await page.keyboard.press('Escape');
      await frame.evaluate(() => {
        globalThis.previewHarness.empty(false);
        globalThis.previewHarness.hold();
      });
      await anchor.click();
      await frame.evaluate(() => globalThis.previewHarness.enabled(false));
      const calls = await frame.evaluate(() => globalThis.previewHarness.calls.length);
      await frame.evaluate(() => globalThis.previewHarness.release());
      await expect(frame.locator('.dictionary-word-preview')).toHaveCount(0);
      assert.equal(await frame.evaluate(() => globalThis.previewHarness.calls.length), calls);
      await frame.evaluate(() => globalThis.previewHarness.enabled(true));
      await anchor.waitFor();
      // Both sides limited: larger side wins and full body stays internally scrollable.
      await page.setViewportSize({ width, height: 400 });
      await move(25, 200);
      await anchor.click();
      await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
      const limited = await sample('both-sides-limited');
      assert.ok(limited[0].rect.height < 240);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width, height: 220 });
      await move(25, 100);
      await anchor.click();
      await expect(frame.locator('.dictionary-word-preview')).toHaveCount(0);
      await expect(frame.getByRole('status').filter({ hasText: '可用空间不足' })).toHaveCount(1);
      records.push({ width, theme, scenario: 'tiny-height', noDialog: true });
      await page.setViewportSize({ width: 135, height });
      await move(15, 200);
      await anchor.click();
      await expect(frame.locator('.dictionary-word-preview')).toHaveCount(0);
      records.push({ width, theme, scenario: 'tiny-width', noDialog: true });
      await page.setViewportSize({ width, height });
      await move(40, 220);
      await anchor.click();
      await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
      await page.setViewportSize({ width, height: height - 180 });
      await sample('resize-keyboard-height');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width, height });
      // Pointer selects line two; keyboard resets to the first visible line.
      await frame.evaluate(() => {
        document.getElementById('host').style.width = '155px';
        document.querySelector('.dictionary-popover__definition').style.wordBreak = 'break-all';
      });
      await move(40, 180);
      const chinese = frame.getByRole('button', {
        name: 'pneumonoultramicroscopicsilicovolcanoconiosis',
        exact: true,
      });
      const lines = await chinese.evaluate((el) =>
        Array.from(el.getClientRects(), (r) => r.toJSON()),
      );
      assert.ok(lines.length > 1, 'cross-line fixture');
      await page.mouse.click(
        lines[1].left + lines[1].width / 2,
        lines[1].top + lines[1].height / 2,
      );
      const second = await sample('pointer-second-line');
      assert.ok(Math.abs(second[0].layout.anchor.top - lines[1].top) < 0.1);
      await page.keyboard.press('Escape');
      await chinese.focus();
      await page.keyboard.press('Enter');
      const first = await sample('keyboard-first-visible-line');
      assert.ok(Math.abs(first[0].layout.anchor.top - lines[0].top) < 0.1);
      await page.keyboard.press('Escape');
      await frame.evaluate(() => {
        document.getElementById('host').style.width = '280px';
      });
      await move(40, 180);
      await anchor.click();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      await sample('real-200-percent-visual-viewport');
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await page.keyboard.press('Escape');
      // Nested scroll with nonzero page scroll; selected line remains the anchor.
      await frame.evaluate(() => {
        document.body.style.height = '1800px';
        window.scrollTo(0, 90);
        document.getElementById('scroller').scrollTop = 60;
      });
      await move(40, 250);
      await anchor.click();
      await sample('page-and-nested-scroll');
      await frame.evaluate(() => {
        document.getElementById('scroller').scrollTop += 10;
      });
      await sample('ancestor-scroll-update');
      await frame.evaluate(() => {
        document.getElementById('host').style.display = 'none';
      });
      await expect(frame.locator('.dictionary-word-preview')).toHaveCount(0);
      records.push({ width, theme, scenario: 'hidden-anchor-closes', noDialog: true });
      await frame.evaluate(() => {
        document.getElementById('host').style.display = '';
        globalThis.previewHarness.hold();
      });
      await anchor.click();
      await frame.evaluate(() => globalThis.previewHarness.mounted(false));
      await frame.evaluate(() => globalThis.previewHarness.release());
      await expect(frame.locator('.dictionary-word-preview')).toHaveCount(0);
      const continuous = await frame.evaluate(() => globalThis.previewHarness.frameTrace);
      const allFrames = continuous.map((row) => {
        const d = JSON.parse(row);
        return { ...d, layout: JSON.parse(d.layout) };
      });
      for (const { rect: p, layout: l } of allFrames) {
        const gap = l.side === 'bottom' ? p.top - l.anchor.bottom : l.anchor.top - p.bottom;
        assert.ok(Math.abs(gap - 4) <= 1, `first-visible-frame gap ${gap}`);
      }
      records.push({
        width,
        theme,
        scenario: 'continuous-including-first-visible-frame',
        frames: allFrames,
      });
      await page.close();
    }
  // Compatibility, empty content, synchronous details and correction identity.
  for (const variant of ['legacy', 'sync', 'blank&empty', 'corrected', 'standalone']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${origin}/preview-contract?${variant}`);
    const frame = page.mainFrame();
    if (variant === 'standalone') {
      const trigger = frame.getByRole('button', { name: 'probe', exact: true });
      await trigger.hover();
      await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
      await page.mouse.move(8, 8);
      await trigger.hover();
      await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
      records.push({ variant, passed: true });
      await page.close();
      continue;
    }
    await frame.getByRole('button', { name: 'probe', exact: true }).click();
    const preview = frame.locator('.dictionary-word-preview');
    await preview.waitFor();
    if (variant === 'legacy') {
      await expect(preview).toContainText('摘要（暂无完整释义）');
      assert.deepEqual(await frame.evaluate(() => globalThis.previewHarness.calls), []);
    } else if (variant === 'blank&empty') await expect(preview).toContainText('暂无释义');
    else {
      await expect(frame.locator('.dictionary-word-preview__group')).toHaveCount(4);
      assert.equal(await frame.locator('.dictionary-word-preview__group li').count(), 29);
      if (variant === 'corrected') {
        await expect(frame.getByRole('dialog', { name: 'corrected' })).toBeVisible();
        await expect(frame.locator('.dictionary-word-preview__group li').first()).toContainText(
          '纠错首义项',
        );
        await expect(frame.locator('.dictionary-word-preview__group').nth(1)).toContainText(
          'B probe',
        );
        await frame.getByRole('button', { name: '在主窗口打开 probe' }).click();
        assert.deepEqual(await frame.evaluate(() => globalThis.previewHarness.expanded), ['probe']);
      }
    }
    records.push({ variant, passed: true });
    await page.close();
  }
  await writeFile(
    `${dir}/${process.env.PREVIEW_VARIANTS_ONLY ? 'variants' : 'frames'}.json`,
    JSON.stringify(records),
  );
  console.log(
    `Preview contract passed: ${records.length} records; all visible frames gap 4±1px, viewport margin 8px; 29 full meanings, errors/retry/races/disable and tiny-space fallback.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
