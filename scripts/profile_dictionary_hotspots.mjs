import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { mainThreadIntervals } from './dictionary_trace_summary.mjs';

const label = process.argv[2] ?? 'before';
const output = `artifacts/hotspots-${label}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
let localServer;
let webUrl = process.env.HOTSPOT_WEB_URL ?? 'http://127.0.0.1:19502';
if (process.env.HOTSPOT_WEB_ROOT) {
  localServer = await createServer({
    configFile: resolve(process.env.HOTSPOT_WEB_ROOT, 'vite.demo.config.ts'),
    server: { port: 0, strictPort: false },
    logLevel: 'error',
  });
  await localServer.listen();
  webUrl = `http://127.0.0.1:${localServer.httpServer.address().port}`;
}
const cpu = Number(process.env.HOTSPOT_CPU ?? 4);
try {
  for (const [host, url] of [
    ['web', webUrl],
    ['native', process.env.HOTSPOT_NATIVE_URL ?? 'http://127.0.0.1:19501'],
  ]) {
    if (process.env.HOTSPOT_HOSTS && !process.env.HOTSPOT_HOSTS.split(',').includes(host)) continue;
    const page = await browser.newPage({
      viewport: cpu === 1 ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      hasTouch: cpu > 1,
    });
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('PAGE ERROR', error.message);
    });
    await page.goto(url);
    let frame = page.mainFrame();
    if (host === 'web') {
      for (const id of [
        'chinese-dictionary',
        'chinese-dictionary-words',
        'chinese-xinhua',
        'chinese-xinhua-words',
      ]) {
        const checkbox = page.locator(`#vocabulary-pack-${id}`);
        await checkbox.check();
      }
      await page.waitForTimeout(1500);
    } else {
      await page.frameLocator('iframe').getByRole('button', { name: '打开词典搜索' }).click();
      frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    }
    const input = frame.getByRole('combobox');
    const content = frame.locator(host === 'web' ? '.demo-popover-slot' : 'body');
    await input.waitFor();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    const summary = [];
    async function record(name, action) {
      await cdp.send('Tracing.start', {
        categories: 'toplevel,devtools.timeline,v8,blink.user_timing',
        transferMode: 'ReturnAsStream',
      });
      await cdp.send('Profiler.start');
      await frame.evaluate((name) => {
        globalThis.hotspotLongTasks = [];
        globalThis.hotspotObserver = new globalThis.PerformanceObserver((list) =>
          globalThis.hotspotLongTasks.push(
            ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
          ),
        );
        globalThis.hotspotObserver.observe({ type: 'longtask' });
        globalThis.hotspotStart = performance.now();
        performance.mark(`hotspot-${name}-begin`);
      }, name);
      await action();
      await frame.evaluate((name) => performance.mark(`hotspot-${name}-end`), name);
      const observerTasks = await frame.evaluate(async () => {
        const end = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 60));
        globalThis.hotspotObserver.disconnect();
        return globalThis.hotspotLongTasks
          .filter((task) => task.startTime >= globalThis.hotspotStart && task.startTime <= end)
          .map((task) => ({
            startMs: task.startTime - globalThis.hotspotStart,
            durationMs: task.duration,
          }));
      });
      const { profile } = await cdp.send('Profiler.stop');
      const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end');
      const { stream } = await complete;
      let trace = '';
      for (;;) {
        const chunk = await cdp.send('IO.read', { handle: stream });
        trace += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
        if (chunk.eof) break;
      }
      await cdp.send('IO.close', { handle: stream });
      const events = JSON.parse(trace).traceEvents;
      const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
      const totals = new Map();
      for (let i = 0; i < (profile.samples ?? []).length; i++) {
        const node = nodes.get(profile.samples[i]);
        const key = `${node.callFrame.functionName || '(anonymous)'} @ ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`;
        totals.set(key, (totals.get(key) ?? 0) + Math.max(0, profile.timeDeltas[i]) / 1000);
      }
      const result = {
        host,
        cpuThrottle: cpu,
        action: name,
        ...mainThreadIntervals(events, name),
        observerLongTasks: observerTasks,
        observerLongestTaskMs: Math.max(0, ...observerTasks.map((task) => task.durationMs)),
        topSelfSamples: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25),
        errors,
      };
      summary.push(result);
      await writeFile(`${output}/${host}-${name}.trace.json`, trace);
      await writeFile(`${output}/${host}-${name}.cpuprofile`, JSON.stringify(profile));
      await writeFile(`${output}/${host}-summary.json`, JSON.stringify(summary, null, 2));
      console.log(
        JSON.stringify({
          host,
          action: name,
          longestTaskMs: result.longestTaskMs,
          observerLongestTaskMs: result.observerLongestTaskMs,
          elapsedMs: result.elapsedMs,
          errors,
        }),
      );
    }
    await record('open-cold', async () => {
      await input.fill('行');
      await input.press('Enter');
      await frame.locator('.dictionary-popover__word').filter({ hasText: /^行$/u }).waitFor();
      await frame
        .locator('.dictionary-inline-resolution')
        .waitFor({ state: 'hidden', timeout: 120000 });
    });
    await record('scroll', async () => {
      await content.locator('.dictionary-popover__inline-word').last().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await content.locator('.dictionary-popover__inline-word').first().scrollIntoViewIfNeeded();
    });
    await record('preview', async () => {
      await content.locator('.dictionary-popover__inline-word').first().click();
      await frame.getByRole('dialog').waitFor();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
    });
    await record('input-warm', async () => {
      await input.fill('行');
      await input.press('End');
      await input.press('Backspace');
      await input.pressSequentially('行走', { delay: 150 });
      await page.waitForTimeout(400);
    });
    await record('open-warm', async () => {
      await input.fill('行');
      await input.press('Enter');
      await frame.locator('.dictionary-popover__word').filter({ hasText: /^行$/u }).waitFor();
      await frame
        .locator('.dictionary-inline-resolution')
        .waitFor({ state: 'hidden', timeout: 120000 });
      await page.waitForTimeout(300);
    });
    await page.close();
  }
} finally {
  await browser.close();
  await localServer?.close();
}
