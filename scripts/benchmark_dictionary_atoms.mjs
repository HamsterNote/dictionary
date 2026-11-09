import { resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  for (const [label, root] of [
    ['before', resolve('../ham195-hotspot-before')],
    ['after', process.cwd()],
  ]) {
    const server = await createServer({
      configFile: resolve(root, 'vite.demo.config.ts'),
      server: { port: 0, strictPort: false },
      logLevel: 'error',
      plugins: [
        {
          name: 'dictionary-atom-benchmark',
          configureServer(server) {
            server.middlewares.use('/__resources', async (req, res, next) => {
              try {
                const id = new URL(req.url, 'http://fixture').pathname.slice(1);
                if (id.includes('..')) throw new Error('invalid resource');
                res.setHeader('Content-Type', 'application/octet-stream');
                res.end(await readFile(resolve(root, 'resources/dictionary', id)));
              } catch (error) {
                next(error);
              }
            });
            server.middlewares.use('/__atoms', (_req, res) => {
              res.setHeader('Content-Type', 'text/html');
              res.end('<!doctype html><body>Dictionary atom benchmark</body>');
            });
          },
          resolveId(id) {
            if (id === '/hotspot-atoms') return '\0hotspot-atoms';
          },
          load(id) {
            if (id !== '\0hotspot-atoms') return;
            return `
          export { sha256 } from '@noble/hashes/sha2.js';
          export { gunzipSync } from 'fflate';
          export * from '${root}/src/lookupChinese.ts';
          export * from '${root}/src/lookupEnglishChinese.ts';
          export * from '${root}/src/englishInflectionLookup.ts';
          export * from '${root}/src/dictionaryTextCandidates.ts';
          export * from '${root}/src/offline-resources/index.ts';
          export { chineseDictionaryPack } from '${root}/src/dictionary-packs/chinese-dictionary.ts';
          export { chineseDictionaryWordsDictionaryPack } from '${root}/src/dictionary-packs/chinese-dictionary-words.ts';
          export { chineseXinhuaDictionaryPack } from '${root}/src/dictionary-packs/chinese-xinhua.ts';
          export { chineseXinhuaWordsDictionaryPack } from '${root}/src/dictionary-packs/chinese-xinhua-words.ts';
          export { ecdictInflectionIndexPack } from '${root}/src/inflection-packs/reverse.ts';
        `;
          },
        },
      ],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      await page.goto(`${origin}/__atoms`);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const results = await page.evaluate(async (root) => {
        const m = await import('/hotspot-atoms');
        const packs = [
          m.chineseDictionaryPack,
          m.chineseDictionaryWordsDictionaryPack,
          m.chineseXinhuaDictionaryPack,
          m.chineseXinhuaWordsDictionaryPack,
        ];
        const results = [];
        function measure(name, run, count = 7) {
          const values = [];
          for (let i = 0; i < count; i++) {
            const start = performance.now();
            run();
            values.push(performance.now() - start);
          }
          const sorted = [...values].sort((a, b) => a - b);
          results.push({
            name,
            maxMs: Math.max(...values),
            medianMs: sorted[Math.floor(count / 2)],
            values,
          });
        }
        measure('suggestChinese(行; 617747 source entries)', () => m.suggestChinese('行', packs));
        measure('countChineseEntries(4 packs)', () => m.countChineseEntries(packs));
        const entry = m.lookupChinese('行', packs);
        const text = entry.meanings.map((x) => x.definition).join('。');
        measure('extractDictionaryTextTokens(行 full definition)', () =>
          m.extractDictionaryTextTokens(text),
        );
        measure('resolveChineseText(行; cached Map lookup)', () =>
          m.resolveChineseText(text, (word) =>
            packs.some((p) => p.entries.has(word)) ? { word, definition: 'cached' } : undefined,
          ),
        );
        measure('resolveChineseEntry(行)', () => m.resolveChineseEntry('行', packs));
        measure('findEnglishInflectionSources(went)', () =>
          m.findEnglishInflectionSources('went', [m.ecdictInflectionIndexPack]),
        );
        const manifest = await fetch(`/@fs/${root}/resources/dictionary/manifest.json`).then((r) =>
          r.json(),
        );
        const resource = manifest.packs
          .filter((p) => p.kind === 'chinese')
          .map((p) => p.index)
          .sort((a, b) => b.uncompressedBytes - a.uncompressedBytes)[0];
        const zipped = new Uint8Array(
          await fetch(`/__resources/${resource.id}`).then((r) => r.arrayBuffer()),
        );
        const raw = m.gunzipSync(zipped);
        measure(`sha256(compressed ${resource.id}; ${zipped.length} bytes)`, () =>
          m.sha256(zipped),
        );
        measure(`gunzipSync(${resource.id})`, () => m.gunzipSync(zipped));
        measure(`sha256(raw ${raw.length} bytes)`, () => m.sha256(raw));
        measure(`TextDecoder.decode(${raw.length} bytes)`, () => new TextDecoder().decode(raw));
        return {
          cpuThrottle: 4,
          viewport: { width: 390, height: 844 },
          sourceEntries: packs.reduce((n, p) => n + p.entryCount, 0),
          resource,
          operations: results.sort((a, b) => b.maxMs - a.maxMs),
        };
      }, root);
      await mkdir(`artifacts/hotspots-${label}`, { recursive: true });
      await writeFile(`artifacts/hotspots-${label}/atoms.json`, JSON.stringify(results, null, 2));
      console.log(
        label,
        results.operations.map(({ name, maxMs, medianMs }) => ({ name, maxMs, medianMs })),
      );
    } finally {
      await page.close();
      await server.close();
    }
  }
} finally {
  await browser.close();
}
