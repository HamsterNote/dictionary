import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Deliberately no Tracing, Profiler, React instrumentation or screenshots.
// CDP is used only to apply the same main-thread CPU throttle to both builds.
const label = process.argv[2] ?? 'production';
const repeats = Number(process.env.BENCH_REPEATS ?? 3);
const directory = `artifacts/production-${label}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const cpu of [1, 4]) {
    for (const host of ['web', 'native']) {
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const page = await browser.newPage({
          viewport: cpu === 1 ? { width: 1440, height: 900 } : { width: 390, height: 844 },
          hasTouch: cpu > 1,
        });
        const errors = [];
        const scripts = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (request.resourceType() === 'script') scripts.push(request.url());
        });
        await page.goto(
          host === 'web'
            ? (process.env.BENCH_WEB_URL ?? 'http://127.0.0.1:19502')
            : (process.env.BENCH_NATIVE_URL ?? 'http://127.0.0.1:19501'),
        );
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
            await page.waitForFunction(
              (id) =>
                globalThis.document
                  .getElementById(`vocabulary-pack-${id}`)
                  ?.getAttribute('aria-busy') === 'false',
              id,
            );
          }
        } else {
          await page.frameLocator('iframe').getByRole('button', { name: '打开词典搜索' }).click();
          frame = page.frames().find((candidate) => candidate !== page.mainFrame());
        }
        const input = frame.getByRole('combobox');
        const content = frame.locator(host === 'web' ? '.demo-popover-slot' : 'body');
        await input.waitFor();
        await page.waitForTimeout(300);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
        async function record(action, run) {
          await page.evaluate(() => {
            const state = { start: performance.now(), tasks: [], frames: [], active: true };
            state.observer = new PerformanceObserver((list) => {
              state.tasks.push(
                ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
              );
            });
            state.observer.observe({ type: 'longtask' });
            const tick = (time) => {
              state.frames.push(time);
              if (state.active) globalThis.requestAnimationFrame(tick);
            };
            globalThis.requestAnimationFrame(tick);
            globalThis.productionBenchmark = state;
          });
          await run();
          await page.waitForTimeout(250);
          const measurement = await page.evaluate(async () => {
            const state = globalThis.productionBenchmark;
            const end = performance.now();
            state.active = false;
            await new Promise((resolve) => setTimeout(resolve, 100));
            state.observer.disconnect();
            const tasks = state.tasks
              .filter((task) => task.startTime >= state.start && task.startTime <= end)
              .map((task) => ({
                startMs: task.startTime - state.start,
                durationMs: task.duration,
              }));
            const gaps = state.frames.slice(1).map((time, i) => time - state.frames[i]);
            return {
              windowMs: end - state.start,
              longTasks: tasks,
              longestObservedLongTaskMs: Math.max(0, ...tasks.map((task) => task.durationMs)),
              totalBlockingMs: tasks.reduce(
                (sum, task) => sum + Math.max(0, task.durationMs - 50),
                0,
              ),
              longestFrameGapMs: Math.max(0, ...gaps),
            };
          });
          const result = { label, host, cpu, repeat, action, ...measurement, errors: [...errors] };
          results.push(result);
          await writeFile(
            `${directory}/results.json`,
            JSON.stringify({ repeats, tracing: false, profiling: false, results }, null, 2) + '\n',
          );
          console.log(JSON.stringify(result));
        }
        await record('open-cold', async () => {
          await input.fill('行');
          await input.press('Enter');
          await frame.locator('.dictionary-popover__word').filter({ hasText: /^行$/u }).waitFor();
          await frame
            .locator('.dictionary-inline-resolution')
            .waitFor({ state: 'hidden', timeout: 120000 });
          await content.locator('.dictionary-popover__inline-word').first().waitFor();
        });
        await record('scroll', async () => {
          await content.locator('.dictionary-popover__inline-word').last().scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          await content
            .locator('.dictionary-popover__inline-word')
            .first()
            .scrollIntoViewIfNeeded();
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
        if (label.startsWith('prod')) {
          assert.equal(
            scripts.some((url) => /@vite\/client|@react-refresh|\.bundle\?.*dev=true/.test(url)),
            false,
            'production must not load development entrypoints',
          );
        }
        assert.deepEqual(errors, []);
        await writeFile(
          `${directory}/${host}-${cpu}-${repeat}-scripts.json`,
          JSON.stringify(scripts, null, 2),
        );
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
