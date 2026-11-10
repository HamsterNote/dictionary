import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const server = await createServer({
  configFile: 'vite.demo.config.ts',
  server: { port: 0, strictPort: false },
  logLevel: 'error',
  plugins: [
    {
      name: 'decoder-test-page',
      configureServer(server) {
        server.middlewares.use('/__resources', async (req, res, next) => {
          try {
            const id = new URL(req.url, 'http://fixture').pathname.slice(1);
            if (id.includes('..')) throw new Error('invalid resource');
            res.setHeader('Content-Type', 'application/octet-stream');
            res.end(await readFile(new URL(`../resources/dictionary/${id}`, import.meta.url)));
          } catch (error) {
            next(error);
          }
        });
        server.middlewares.use('/__decoder', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><body>Decoder test</body>');
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  let workerCount = 0;
  page.on('worker', () => workerCount++);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__decoder`);
  const result = await page.evaluate(async (root) => {
    const { OfflineResourceDecoder } = await import(
      `/@fs/${root}/src/offline-resources/resourceDecoder.ts`
    );
    const manifest = await fetch(`/@fs/${root}/resources/dictionary/manifest.json`).then((r) =>
      r.json(),
    );
    const resource = manifest.packs.find((p) => p.kind === 'chinese').shards[0];
    const zipped = new Uint8Array(
      await fetch(`/__resources/${resource.id}`).then((r) => r.arrayBuffer()),
    );
    const original = [...zipped];
    const decoder = new OfflineResourceDecoder();
    const [first, second, decodedText] = await Promise.all([
      decoder.decode(zipped, resource),
      decoder.decode(zipped, resource),
      decoder.decodeText(zipped, resource),
    ]);
    const text = new TextDecoder().decode(first);
    const cases = [
      { ...resource, bytes: resource.bytes + 1 },
      { ...resource, sha256: '0'.repeat(64) },
      { ...resource, uncompressedBytes: resource.uncompressedBytes + 1 },
      { ...resource, uncompressedSha256: '0'.repeat(64) },
    ];
    async function failures(target) {
      const messages = [];
      for (const item of cases) {
        try {
          await target.decode(zipped, item);
          messages.push('unexpected success');
        } catch (error) {
          messages.push(error.message);
        }
      }
      return messages;
    }
    const errors = await failures(decoder);
    const pending = decoder.decode(zipped, resource).then(
      () => false,
      () => true,
    );
    decoder.dispose();
    const disposed = await pending;
    const NativeWorker = globalThis.Worker;
    const fallbacks = [];
    for (const mode of ['absent', 'constructor', 'startup']) {
      globalThis.Worker =
        mode === 'absent'
          ? undefined
          : class {
              constructor() {
                if (mode === 'constructor') throw new Error('blocked by CSP');
              }
              postMessage() {
                queueMicrotask(() => this.onerror({ preventDefault() {} }));
              }
              terminate() {}
            };
      const fallback = new OfflineResourceDecoder();
      fallbacks.push({
        mode,
        text: new TextDecoder().decode(await fallback.decode(zipped, resource)),
        errors: await failures(fallback),
      });
      fallback.dispose();
    }
    globalThis.Worker = NativeWorker;
    return {
      same: text === new TextDecoder().decode(second) && text === decodedText,
      bytesIntact:
        original.every((byte, i) => byte === zipped[i]) && original.length === zipped.length,
      errors,
      disposed,
      fallbacks: fallbacks.map((x) => ({ mode: x.mode, same: x.text === text, errors: x.errors })),
    };
  }, process.cwd());
  assert.equal(workerCount, 1, 'reuse one worker for concurrent resources');
  assert.ok(result.same && result.bytesIntact && result.disposed);
  for (const errors of [result.errors, ...result.fallbacks.map((x) => x.errors)]) {
    assert.match(errors[0], /压缩长度/);
    assert.match(errors[1], /压缩 SHA-256/);
    assert.match(errors[2], /解压长度/);
    assert.match(errors[3], /解压 SHA-256/);
  }
  assert.ok(result.fallbacks.every((x) => x.same));
  console.log(
    'Offline decoder browser: worker reuse, buffer ownership, validation, disposal and three fallback modes passed.',
  );
} finally {
  await browser?.close();
  await server.close();
}
