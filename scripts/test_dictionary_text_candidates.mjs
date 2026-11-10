import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { OfflineDictionaryResourceStore } = await server.ssrLoadModule(
    '/src/offline-resources/index.ts',
  );
  const { createDictionaryProvider } = await server.ssrLoadModule('/src/dictionaryProvider.ts');
  const { resolveDictionaryTextEntries } = await server.ssrLoadModule(
    '/src/dictionaryTextCandidates.ts',
  );
  const { DictionaryInteractiveText } = await server.ssrLoadModule(
    '/src/DictionaryInteractiveText.tsx',
  );
  const manifest = JSON.parse(
    await readFile(new URL('../resources/dictionary/manifest.json', import.meta.url), 'utf8'),
  );
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/offline-query-baseline.json', import.meta.url), 'utf8'),
  );
  const resourceRoot = new URL('../resources/dictionary/', import.meta.url);
  const store = new OfflineDictionaryResourceStore(manifest, {
    read: async (resource) => readFile(new URL(resource.id, resourceRoot)),
  });
  const vocabularyPacks = [];
  for (const id of fixture.packOrder.english.filter((id) => id !== 'core')) {
    const module = await server.ssrLoadModule(`/src/vocabulary-packs/${id}.ts`);
    vocabularyPacks.push(module[`${id}VocabularyPack`]);
  }
  const reverseModule = await server.ssrLoadModule('/src/inflection-packs/reverse.ts');
  const provider = createDictionaryProvider({
    englishInflectionIndexPacks: [reverseModule.ecdictInflectionIndexPack],
    englishVocabularyPacks: vocabularyPacks,
    offlineResources: store,
  });

  for (const testCase of fixture.interactiveTexts) {
    const entries = await resolveDictionaryTextEntries(testCase.text, provider.resolveEntry);
    const markup = renderToStaticMarkup(
      createElement(
        DictionaryInteractiveText,
        {
          onOpen: () => {},
          resolveEntry: (word) => entries.get(word),
        },
        testCase.text,
      ),
    );
    const resolvedSegments = [
      ...markup.matchAll(
        /<span[^>]*class="dictionary-popover__inline-word"[^>]*>([^<]*)<\/span>/gu,
      ),
    ].map((match) => match[1].replaceAll('\u2060', ''));
    assert.deepEqual(resolvedSegments, testCase.resolvedSegments, testCase.id);
  }

  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    resolveDictionaryTextEntries('心', provider.resolveEntry, abortController.signal),
    /aborted/u,
  );
  store.dispose();
  process.stdout.write(`共享文本候选对照通过：${String(fixture.interactiveTexts.length)} 组。\n`);
} finally {
  await server.close();
}
