import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
const server = await createServer({
  configFile: 'vite.demo.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const context = await browser.newContext();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const page = await context.newPage();
  await page.goto(url);
  const toggle = page.getByRole('checkbox', { name: '支持解释内点词汇' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  const input = page.getByRole('combobox');
  await input.fill('note');
  await input.press('Enter');
  await expect(page.locator('.dictionary-popover__inline-word')).toHaveCount(0);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  const second = await context.newPage();
  await second.goto(url);
  const other = second.getByRole('checkbox', { name: '支持解释内点词汇' });
  await expect(other).not.toBeChecked();
  await toggle.check();
  await expect(other).toBeChecked();
  await other.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restorePreferenceWrites = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'hamster-note:dictionary-preferences:v1') throw Error('blocked');
      return original.call(this, key, value);
    };
  });
  await toggle.check();
  await expect(page.getByText('未保存，可重试')).toBeVisible();
  await expect(toggle).toBeChecked();
  await page.evaluate(() => globalThis.restorePreferenceWrites());
  await page.getByRole('button', { name: '重试设置' }).click();
  await expect(page.getByText('未保存，可重试')).toHaveCount(0);
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('hamster-note:dictionary-preferences:v1'))
          .definitionWordPreviewEnabled,
    ),
    true,
  );
  await context.close();
  console.log(
    'Demo preferences: persistence, cross-tab synchronization and failed-save/latest-intent retry passed.',
  );
} finally {
  await browser?.close();
  await server.close();
}
