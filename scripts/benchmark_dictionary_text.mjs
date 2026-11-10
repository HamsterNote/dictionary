/* global document, requestAnimationFrame, innerHeight */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createTextResolutionServer } from './text_resolution_fixture.mjs';

const label = process.argv[2] ?? 'after';
const server = await createTextResolutionServer();
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch();
  const results = [];
  for (const [device, viewport, cpu] of [
    ['desktop', { width: 1440, height: 900 }, 1],
    ['mobile-emulated', { width: 390, height: 844 }, 4],
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: cpu > 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`http://127.0.0.1:${address.port}/benchmark`);
    await page.waitForFunction(() => typeof globalThis.resolutionStats === 'function');
    await cdp.send('Tracing.start', {
      categories: 'toplevel,devtools.timeline,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    const result = await page.evaluate(async () => {
      const samples = [{ ms: 0, ready: 0, visible: 0 }];
      const longTasks = [];
      const observer = new PerformanceObserver((list) => {
        longTasks.push(
          ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
        );
      });
      observer.observe({ type: 'longtask' });
      const start = performance.now();
      performance.mark('resolution-begin');
      document.getElementById('start').click();
      let firstVisibleReady;
      let lastCount = 0;
      let complete;
      while (performance.now() - start < 60000) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const buttons = [...document.querySelectorAll('.dictionary-popover__inline-word')];
        const time = performance.now() - start;
        const visible = buttons.filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.top < innerHeight && rect.bottom > 0;
        }).length;
        if (visible > 0) firstVisibleReady ??= time;
        if (buttons.length !== lastCount) {
          samples.push({ ms: time, ready: buttons.length, visible });
          lastCount = buttons.length;
        }
        if (buttons.length === 1152 && !document.querySelector('.dictionary-inline-resolution')) {
          complete = time;
          performance.mark('resolution-end');
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      observer.disconnect();
      const relevantTasks = longTasks.filter(
        (task) => task.startTime + task.duration >= start && task.startTime <= start + complete,
      );
      return {
        totalMs: complete,
        firstVisibleReadyMs: firstVisibleReady,
        longestTaskMs: Math.max(0, ...relevantTasks.map((task) => task.duration)),
        longTaskCount: relevantTasks.length,
        totalBlockingMs: relevantTasks.reduce(
          (total, task) => total + Math.max(0, task.duration - 50),
          0,
        ),
        samples,
        ...globalThis.resolutionStats(),
      };
    });
    const tracingComplete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await tracingComplete;
    let traceText = '';
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream });
      traceText += chunk.data;
      if (chunk.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    const { traceEvents } = JSON.parse(traceText);
    const begin = traceEvents.find((event) => event.name === 'resolution-begin');
    const end = traceEvents.find((event) => event.name === 'resolution-end');
    assert.ok(begin && end, 'trace must contain resolution markers');
    const tasks = traceEvents.filter(
      (event) =>
        event.pid === begin.pid &&
        event.tid === begin.tid &&
        event.ts + (event.dur ?? 0) >= begin.ts &&
        event.ts <= end.ts &&
        event.ph === 'X' &&
        /RunTask$/u.test(event.name),
    );
    assert.ok(tasks.length > 0, 'renderer main-thread task trace must be available');
    result.longestMainThreadTaskMs = Math.max(...tasks.map((event) => event.dur / 1000));
    assert.ok(result.totalMs, `${device}: did not finish`);
    assert.deepEqual(errors, []);
    delete result.trace;
    results.push({ device, viewport, cpuThrottle: cpu, ...result });
    await page.close();
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    `artifacts/text-resolution-${label}.json`,
    `${JSON.stringify(results, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      results.map(({ samples, ...result }) => ({ ...result, samples: samples.length })),
      null,
      2,
    )}\n`,
  );
} finally {
  await browser?.close();
  await server.close();
}
