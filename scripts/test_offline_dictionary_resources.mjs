import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { gunzipSync, gzipSync } from 'fflate';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { OfflineDictionaryResourceStore, OFFLINE_DICTIONARY_PACKAGE_VERSION } =
    await server.ssrLoadModule('/src/offline-resources/index.ts');
  const { lookupChinese } = await server.ssrLoadModule('/src/lookupChinese.ts');
  const { getDetail, search } = await server.ssrLoadModule('/src/dictionaryData.ts');
  const { createDictionaryProvider } = await server.ssrLoadModule('/src/dictionaryProvider.ts');
  const { DictionaryQueryController } = await server.ssrLoadModule(
    '/src/dictionaryQueryController.ts',
  );
  const manifest = JSON.parse(
    await readFile(new URL('../resources/dictionary/manifest.json', import.meta.url), 'utf8'),
  );
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.packageVersion, packageJson.version, 'manifest must match the npm package');
  assert.equal(
    OFFLINE_DICTIONARY_PACKAGE_VERSION,
    packageJson.version,
    'runtime resource version must match the npm package',
  );
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/offline-query-baseline.json', import.meta.url), 'utf8'),
  );
  const resourceRoot = new URL('../resources/dictionary/', import.meta.url);
  const reader = {
    read: async (resource) => {
      const contents = await readFile(new URL(resource.id, resourceRoot));
      assert.equal(contents.byteLength, resource.bytes);
      assert.equal(createHash('sha256').update(contents).digest('hex'), resource.sha256);
      return contents;
    },
  };
  const store = new OfflineDictionaryResourceStore(manifest, reader);

  const chinesePacks = [];
  for (const id of fixture.packOrder.chinese) {
    const module = await server.ssrLoadModule(`/src/dictionary-packs/${id}.ts`);
    const exportName = {
      'chinese-dictionary': 'chineseDictionaryPack',
      'chinese-dictionary-words': 'chineseDictionaryWordsDictionaryPack',
      'chinese-xinhua': 'chineseXinhuaDictionaryPack',
      'chinese-xinhua-words': 'chineseXinhuaWordsDictionaryPack',
    }[id];
    chinesePacks.push(module[exportName]);
  }
  const vocabularyPacks = [];
  const synonymPacks = [];
  const rootPacks = [];
  for (const id of fixture.packOrder.english.filter((id) => id !== 'core')) {
    const module = await server.ssrLoadModule(`/src/vocabulary-packs/${id}.ts`);
    vocabularyPacks.push(module[`${id}VocabularyPack`]);
  }
  for (const id of fixture.packOrder.english) {
    const synonymModule = await server.ssrLoadModule(`/src/synonym-packs/${id}.ts`);
    synonymPacks.push(synonymModule[`${id}SynonymPack`]);
    const rootModule = await server.ssrLoadModule(`/src/root-packs/${id}.ts`);
    rootPacks.push(rootModule[`${id}RootPack`]);
  }
  const formsModule = await server.ssrLoadModule('/src/inflection-packs/forms.ts');
  const reverseModule = await server.ssrLoadModule('/src/inflection-packs/reverse.ts');
  const inflectionForms = formsModule.ecdictInflectionFormsPack;
  const inflectionIndex = reverseModule.ecdictInflectionIndexPack;
  const searchOptions = {
    chineseDictionaryPacks: chinesePacks,
    englishInflectionIndexPacks: [inflectionIndex],
    englishVocabularyPacks: vocabularyPacks,
    limit: 18,
  };

  const provider = createDictionaryProvider({
    ...searchOptions,
    englishExampleSentencePacks: [],
    englishInflectionFormsPacks: [inflectionForms],
    offlineResources: store,
  });
  for (const testCase of fixture.cases) {
    const isChinese = /\p{Script=Han}/u.test(testCase.query);
    const expectedSuggestions = search(testCase.query, searchOptions);
    if (isChinese) {
      assert.deepEqual(
        await store.lookupChinese(testCase.query),
        lookupChinese(testCase.query, chinesePacks),
        `${testCase.id} 详情查询应与完整 TSV 一致`,
      );
      assert.deepEqual(
        await store.suggestChineseEntries(testCase.query, 18),
        expectedSuggestions,
        `${testCase.id} 候选及排序应与完整 TSV 一致`,
      );
    } else {
      const actualDetail = getDetail(testCase.query, {
        englishExampleSentencePacks: [],
        englishInflectionFormsPacks: [inflectionForms],
        englishInflectionIndexPacks: [inflectionIndex],
        englishRootPacks: await store.getRootPacks(testCase.query),
        englishSynonymPacks: await store.getSynonymPacks(testCase.query),
        englishVocabularyPacks: vocabularyPacks,
      });
      assert.deepEqual(actualDetail ?? null, testCase.detail, testCase.id);
    }
    assert.deepEqual(await provider.search(testCase.query), testCase.suggestions, testCase.id);
    assert.deepEqual(
      (await provider.getDetail(testCase.query)) ?? null,
      testCase.detail,
      `${testCase.id} 异步 provider 详情`,
    );
    assert.deepEqual(
      (await provider.resolveEntry(testCase.query)) ?? null,
      testCase.resolved,
      `${testCase.id} 异步 provider 摘要`,
    );
  }

  const controller = new DictionaryQueryController();
  let resolveA;
  let resolveB;
  const pendingA = new Promise((resolve) => {
    resolveA = resolve;
  });
  const pendingB = new Promise((resolve) => {
    resolveB = resolve;
  });
  const requestA = controller.request('A', () => pendingA);
  const requestB = controller.request('B', () => pendingB);
  resolveB({ word: 'B' });
  assert.equal((await requestB).current, true);
  resolveA({ word: 'A' });
  assert.equal((await requestA).current, false);
  assert.deepEqual(controller.state, { data: { word: 'B' }, query: 'B', status: 'ready' });
  assert.equal(
    (await controller.request('failure', () => Promise.reject(new Error('injected')))).state.status,
    'error',
  );
  assert.equal(
    (await controller.request('retry', () => Promise.resolve({ word: 'retry' }))).state.status,
    'ready',
  );
  assert.equal(
    (await controller.request('missing', () => Promise.resolve(undefined))).state.status,
    'not-found',
  );
  let resolveClosed;
  const closedRequest = controller.request(
    'closed',
    () =>
      new Promise((resolve) => {
        resolveClosed = resolve;
      }),
  );
  controller.cancel();
  resolveClosed({ word: 'closed' });
  assert.equal((await closedRequest).current, false);
  assert.deepEqual(controller.state, { status: 'idle' });
  controller.dispose();

  const evictionStore = new OfflineDictionaryResourceStore(manifest, reader, {
    maxShardCacheBytes: 64 * 1024,
  });
  const evictionWord = fixture.cases.find((testCase) => testCase.id === 'overlap-single-character');
  const beforeEviction = await evictionStore.suggestChineseEntries(evictionWord.query, 18);
  await evictionStore.clearShardCache();
  assert.deepEqual(
    await evictionStore.suggestChineseEntries(evictionWord.query, 18),
    beforeEviction,
  );
  assert.ok(evictionStore.stats.cachedShardBytes <= 64 * 1024);
  evictionStore.dispose();

  const largePack = manifest.packs.find((pack) => pack.id === 'chinese-dictionary-words');
  for (const shard of largePack.shards.slice(0, 70)) {
    await store.readPackShard(largePack.id, Number(shard.id.match(/(\d+)\.tsv\.gz$/u)[1]));
  }
  assert.ok(store.stats.cachedShardBytes <= 12 * 1024 * 1024);

  const memorySamples = [];
  for (let queryCount = 1; queryCount <= 100; queryCount += 1) {
    const query = queryCount % 2 === 0 ? '心' : 'abnormal';
    assert.ok(await provider.getDetail(query));
    if (queryCount % 10 === 0) {
      globalThis.gc?.();
      memorySamples.push({
        queryCount,
        heapUsed: process.memoryUsage().heapUsed,
        ...store.stats,
      });
    }
  }
  const heapGrowth = memorySamples.at(-1).heapUsed - memorySamples[0].heapUsed;
  assert.ok(heapGrowth <= 100 * 1024 * 1024);
  assert.ok(memorySamples.every((sample) => sample.cachedShardBytes <= 12 * 1024 * 1024));
  process.stdout.write(`100 次查询内存/缓存：${JSON.stringify({ heapGrowth, memorySamples })}\n`);

  let shouldFail = true;
  const retryStore = new OfflineDictionaryResourceStore(manifest, {
    read: async (resource) => {
      if (shouldFail && resource.id.startsWith('shards/')) {
        shouldFail = false;
        throw new Error('injected read failure');
      }
      return reader.read(resource);
    },
  });
  await assert.rejects(retryStore.lookupChinese('心'), /injected read failure/u);
  assert.deepEqual(await retryStore.lookupChinese('心'), lookupChinese('心', chinesePacks));
  retryStore.dispose();

  const corruptionPack = manifest.packs.find((pack) => pack.id === 'wordnet-synonyms-toefl');
  const corruptionResource = corruptionPack.index;
  const originalZipped = await reader.read(corruptionResource);
  const originalRaw = gunzipSync(originalZipped);
  const corruptedZipped = gzipSync(originalRaw, { level: 9, filename: 'x' });
  assert.equal(corruptedZipped.byteLength, originalZipped.byteLength);
  assert.notDeepEqual(corruptedZipped, originalZipped);
  assert.deepEqual(gunzipSync(corruptedZipped), originalRaw);
  const corruptedStore = new OfflineDictionaryResourceStore(manifest, {
    read: async (resource) =>
      resource.id === corruptionResource.id ? corruptedZipped : reader.read(resource),
  });
  await assert.rejects(corruptedStore.getSynonymPacks('a'), /压缩 SHA-256 校验失败/u);
  corruptedStore.dispose();

  await assert.rejects(store.readPackShard('../outside', 0), /不在 manifest 允许范围内/u);
  await assert.rejects(store.readPackShard(largePack.id, -1), /不在 manifest 允许范围内/u);
  store.dispose();
  await assert.rejects(store.lookupChinese('心'), /已释放/u);
  process.stdout.write(`离线资源查询对照通过：${String(fixture.cases.length)} 个固定查询。\n`);
} finally {
  await server.close();
}
