import assert from 'node:assert/strict';
/* global document, requestAnimationFrame, getComputedStyle, devicePixelRatio */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';
const label = process.argv[2] ?? 'after';
const out = `artifacts/definition-layout-${label}`;
await mkdir(out, { recursive: true });
const server = await createTextResolutionServer();
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const results = [];
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark'])
      for (let run = 1; run <= 3; run++) {
        const page = await browser.newPage({
          viewport: { width, height: width === 1440 ? 900 : 844 },
          colorScheme: theme,
        });
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/layout`);
        await page.waitForFunction(() => globalThis.layoutHarness?.calls() === 1);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${out}/${width}-${theme}-${run}-pending.png`,
          fullPage: true,
        });
        await page.waitForTimeout(600);
        const data = await page.evaluate(async () => {
          const shifts = [];
          const observer = new PerformanceObserver((list) =>
            shifts.push(
              ...list.getEntries().map((e) => ({
                value: e.value,
                startTime: e.startTime,
                hadRecentInput: e.hadRecentInput,
                sources: e.sources.map((s) => ({
                  node: s.node?.className,
                  previousRect: s.previousRect.toJSON(),
                  currentRect: s.currentRect.toJSON(),
                })),
              })),
            ),
          );
          observer.observe({ type: 'layout-shift' });
          const rect = (r) => [r.x, r.y, r.width, r.height];
          const capture = () =>
            [...document.querySelectorAll('.dictionary-popover__definition')].map((el) => {
              const chars = [];
              const walker = document.createTreeWalker(el, 4);
              let n;
              while ((n = walker.nextNode()))
                for (let i = 0; i < n.length; i++) {
                  if (n.textContent[i] === '\u2060') continue;
                  const r = document.createRange();
                  r.setStart(n, i);
                  r.setEnd(n, i + 1);
                  chars.push({ char: n.textContent[i], rect: rect(r.getBoundingClientRect()) });
                }
              const lines = [];
              for (let i = 0; i < chars.length; i++) {
                const y = chars[i].rect[1];
                const last = lines.at(-1);
                if (last?.y === y) last.end = i;
                else lines.push({ y, start: i, end: i });
              }
              return { rect: rect(el.getBoundingClientRect()), chars, lines };
            });
          const before = capture(),
            frames = [];
          const start = performance.now();
          globalThis.layoutHarness.release();
          let readyFrames = 0;
          while (performance.now() - start < 30000) {
            await new Promise(requestAnimationFrame);
            frames.push({ ms: performance.now() - start, paragraphs: capture() });
            if (!document.querySelector('.dictionary-inline-resolution')) readyFrames++;
            if (readyFrames === 3) break;
          }
          await new Promise((r) => setTimeout(r, 50));
          observer.disconnect();
          const after = capture();
          let maxDelta = 0,
            lineChanges = 0;
          for (const frame of frames)
            frame.paragraphs.forEach((p, i) => {
              const b = before[i];
              for (let k = 0; k < 4; k++)
                maxDelta = Math.max(maxDelta, Math.abs(p.rect[k] - b.rect[k]));
              p.chars.forEach((c, j) => {
                for (let k = 0; k < 4; k++)
                  maxDelta = Math.max(maxDelta, Math.abs(c.rect[k] - b.chars[j].rect[k]));
              });
              if (JSON.stringify(p.lines) !== JSON.stringify(b.lines)) lineChanges++;
            });
          let cls = 0,
            windowSum = 0,
            windowStart = 0,
            previous = 0;
          for (const s of shifts.filter((s) => !s.hadRecentInput)) {
            if (s.startTime - previous > 1000 || s.startTime - windowStart > 5000) {
              windowSum = 0;
              windowStart = s.startTime;
            }
            windowSum += s.value;
            cls = Math.max(cls, windowSum);
            previous = s.startTime;
          }
          const word = document.querySelector('.dictionary-popover__inline-word');
          const style = word ? getComputedStyle(word) : null;
          const styles = style
            ? Object.fromEntries(
                [
                  'display',
                  'padding',
                  'margin',
                  'borderWidth',
                  'fontFamily',
                  'fontSize',
                  'fontWeight',
                  'lineHeight',
                  'letterSpacing',
                  'wordSpacing',
                  'whiteSpace',
                  'textWrap',
                  'fontKerning',
                ].map((k) => [k, style[k]]),
              )
            : {};
          return {
            before,
            after,
            frames,
            shifts,
            cls,
            maxDelta,
            lineChanges,
            styles,
            calls: globalThis.layoutHarness.calls(),
            text: globalThis.layoutHarness.meanings,
            dpr: devicePixelRatio,
            userAgent: navigator.userAgent,
          };
        });
        await page.screenshot({ path: `${out}/${width}-${theme}-${run}.png`, fullPage: true });
        await writeFile(`${out}/${width}-${theme}-${run}.json`, JSON.stringify(data));
        results.push({
          width,
          theme,
          run,
          cls: data.cls,
          maxDelta: data.maxDelta,
          lineChanges: data.lineChanges,
          calls: data.calls,
        });
        await page.close();
      }
  const summary = {
    packageVersion: JSON.parse(
      await (await import('node:fs/promises')).readFile('package.json', 'utf8'),
    ).version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    browser: browser.version(),
    results,
  };
  await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  if (label === 'after')
    for (const result of results) {
      assert.ok(result.maxDelta <= 0.1);
      assert.equal(result.lineChanges, 0);
      assert.equal(result.cls, 0);
    }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
