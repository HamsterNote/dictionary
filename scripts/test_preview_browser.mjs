import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: 'vite.demo.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
let browser;

try {
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${String(address.port)}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(origin);

  await page.locator('#vocabulary-pack-chinese-dictionary').check();
  await page.locator('#vocabulary-pack-chinese-dictionary-words').check();
  const input = page.getByRole('combobox');
  await input.fill('心');
  await input.press('Enter');
  await page.locator('.dictionary-popover__word').filter({ hasText: /^心$/u }).waitFor();
  await page.locator('.dictionary-inline-resolution').waitFor({ state: 'hidden' });

  const heartButton = page
    .locator('.dictionary-popover__inline-word')
    .filter({ hasText: /^心脏$/u })
    .first();
  await heartButton.waitFor();
  const mainQueryBeforePreview = await input.inputValue();
  await heartButton.click();
  const preview = page.getByRole('dialog', { name: '心脏' });
  await preview.waitFor();
  assert.equal(await input.inputValue(), mainQueryBeforePreview);
  await page.getByRole('button', { name: '在主窗口打开 心脏' }).click();
  await page
    .locator('.dictionary-popover__word')
    .filter({ hasText: /^心脏$/u })
    .waitFor();
  assert.equal(await input.inputValue(), '心脏');
  await page.locator('.dictionary-inline-resolution').waitFor({ state: 'hidden' });

  const nextButtons = page.locator('.demo-popover-slot .dictionary-popover__inline-word');
  assert.ok((await nextButtons.count()) > 0);
  const firstWord = await nextButtons.nth(0).textContent();
  assert.ok(firstWord);
  await nextButtons.nth(0).click();
  const secondPreview = page.getByRole('dialog', { name: firstWord });
  await secondPreview.waitFor();
  assert.equal(await input.inputValue(), '心脏');
  await page.keyboard.press('Escape');
  await secondPreview.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => globalThis.document.activeElement?.textContent),
    firstWord,
  );

  await nextButtons.nth(0).click();
  await secondPreview.waitFor();
  await page.locator('.demo-popover-slot .dictionary-popover__word').click();
  await secondPreview.waitFor({ state: 'hidden' });

  if ((await nextButtons.count()) > 1) {
    const secondWord = await nextButtons.nth(1).textContent();
    assert.ok(secondWord);
    await nextButtons.nth(0).click();
    await nextButtons.nth(1).click();
    await page.getByRole('dialog', { name: secondWord }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.keyboard.press('Escape');
  }

  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.screenshot({
    path: new URL('../artifacts/dictionary-preview-desktop.png', import.meta.url).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await nextButtons.nth(0).click();
  await secondPreview.waitFor();
  const bounds = await secondPreview.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
  await page.screenshot({
    path: new URL('../artifacts/dictionary-preview-mobile.png', import.meta.url).pathname,
    fullPage: true,
  });
  process.stdout.write(
    'Demo 浏览器预览链路通过：放大、连续点词、竞态、Escape、外部点击与移动视口。\n',
  );
} finally {
  await browser?.close();
  await server.close();
}
