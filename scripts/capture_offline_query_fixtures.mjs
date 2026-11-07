import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const outputPath = new URL('./fixtures/offline-query-baseline.json', import.meta.url);
const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { getDetail, search } = await server.ssrLoadModule('/src/dictionaryData.ts');
  const { resolveChineseEntry } = await server.ssrLoadModule('/src/lookupChinese.ts');
  const { resolveEnglishChineseEntry } = await server.ssrLoadModule('/src/lookupEnglishChinese.ts');
  const { DictionaryInteractiveText } = await server.ssrLoadModule(
    '/src/DictionaryInteractiveText.tsx',
  );

  const chineseIds = [
    'chinese-dictionary',
    'chinese-dictionary-words',
    'chinese-xinhua',
    'chinese-xinhua-words',
  ];
  const chineseExports = {
    'chinese-dictionary': 'chineseDictionaryPack',
    'chinese-dictionary-words': 'chineseDictionaryWordsDictionaryPack',
    'chinese-xinhua': 'chineseXinhuaDictionaryPack',
    'chinese-xinhua-words': 'chineseXinhuaWordsDictionaryPack',
  };
  const chinesePacks = [];
  for (const id of chineseIds) {
    const module = await server.ssrLoadModule(`/src/dictionary-packs/${id}.ts`);
    chinesePacks.push(module[chineseExports[id]]);
  }

  const englishIds = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre', 'bnc'];
  const vocabularyPacks = [];
  const synonymPacks = [];
  const rootPacks = [];
  for (const id of englishIds) {
    const vocabularyModule = await server.ssrLoadModule(`/src/vocabulary-packs/${id}.ts`);
    vocabularyPacks.push(vocabularyModule[`${id}VocabularyPack`]);
  }
  for (const id of ['core', ...englishIds]) {
    const synonymModule = await server.ssrLoadModule(`/src/synonym-packs/${id}.ts`);
    synonymPacks.push(synonymModule[`${id}SynonymPack`]);
    const rootModule = await server.ssrLoadModule(`/src/root-packs/${id}.ts`);
    rootPacks.push(rootModule[`${id}RootPack`]);
  }
  const formsModule = await server.ssrLoadModule('/src/inflection-packs/forms.ts');
  const reverseModule = await server.ssrLoadModule('/src/inflection-packs/reverse.ts');
  const formsPack = formsModule.ecdictInflectionFormsPack;
  const reversePack = reverseModule.ecdictInflectionIndexPack;

  const detailOptions = {
    chineseDictionaryPacks: chinesePacks,
    englishExampleSentencePacks: [],
    englishInflectionFormsPacks: [formsPack],
    englishInflectionIndexPacks: [reversePack],
    englishRootPacks: rootPacks,
    englishSynonymPacks: synonymPacks,
    englishVocabularyPacks: vocabularyPacks,
  };
  const searchOptions = {
    chineseDictionaryPacks: chinesePacks,
    englishInflectionIndexPacks: [reversePack],
    englishVocabularyPacks: vocabularyPacks,
    limit: 18,
  };

  function capture(id, query) {
    const isChinese = /\p{Script=Han}/u.test(query);
    return {
      id,
      query,
      detail: getDetail(query, detailOptions) ?? null,
      resolved:
        (isChinese
          ? resolveChineseEntry(query, chinesePacks)
          : resolveEnglishChineseEntry(query, vocabularyPacks, { index: [reversePack] })) ?? null,
      suggestions: search(query, searchOptions),
    };
  }

  const cases = [
    capture('overlap-single-character', '心'),
    capture('whitespace-nfkc', '  ＮＯＴＥ  '),
    capture('english-inflection', 'went'),
    capture('english-homograph', 'found'),
    capture('unknown', 'hamster-word-that-does-not-exist'),
    capture('blank', '   '),
  ];
  assert.ok(cases[0].detail);
  assert.ok(cases[1].detail);
  assert.equal(cases[4].detail, null);
  assert.equal(cases[5].detail, null);

  for (const [index, pack] of chinesePacks.entries()) {
    const otherPacks = chinesePacks.filter((_, otherIndex) => otherIndex !== index);
    const headword = [...pack.entries.keys()].find((word) =>
      otherPacks.every((otherPack) => !otherPack.entries.has(word)),
    );
    assert.ok(headword, `${pack.id} 应有独有词头`);
    cases.push(capture(`unique:${pack.id}`, headword));
  }
  const idiom = [...chinesePacks[2].entries.keys()].find(
    (word) => chinesePacks[2].entries.get(word)?.[1] === '成语',
  );
  assert.ok(idiom);
  cases.push(capture('idiom', idiom));

  function captureSupplementCases(kind, packs) {
    const seen = new Set();
    const sourceId = kind === 'synonyms' ? 'wordnet' : 'unimorph';
    for (const pack of packs) {
      const word = [...pack.entries.keys()].find((candidate) => {
        if (seen.has(candidate)) return false;
        const detail = getDetail(candidate, detailOptions);
        return detail?.sources.some((source) => source.id === sourceId);
      });
      const fallback = word ?? [...pack.entries.keys()].find((candidate) => !seen.has(candidate));
      assert.ok(fallback, `${pack.id} 应有可对照词条`);
      for (const entry of pack.entries.keys()) seen.add(entry);
      cases.push(capture(`${kind}:${pack.id}`, fallback));
    }
  }
  captureSupplementCases('synonyms', synonymPacks);
  captureSupplementCases('roots', rootPacks);

  function captureInteractive(id, text) {
    const markup = renderToStaticMarkup(
      createElement(
        DictionaryInteractiveText,
        {
          onOpen: () => {},
          resolveEntry: (word) =>
            /\p{Script=Han}/u.test(word)
              ? resolveChineseEntry(word, chinesePacks)
              : resolveEnglishChineseEntry(word, vocabularyPacks, { index: [reversePack] }),
        },
        text,
      ),
    );
    const words = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/gu)].map((match) => match[1]);
    return { id, text, resolvedSegments: words };
  }
  const interactiveTexts = [
    captureInteractive('chinese-longest-match', '内心安定，心想事成。'),
    captureInteractive('english-inflection-qualifier', 'running(noun), went, unknownzz.'),
    captureInteractive('english-punctuation', "Don't re-enter found; keep unknownzz."),
  ];

  const snapshotFiles = [
    ...chineseIds.map((id) => `${id}.tsv`),
    ...englishIds.map((id) => `ecdict-${id}.tsv`),
    ...['core', ...englishIds].flatMap((id) => [
      `wordnet-synonyms-${id}.tsv`,
      `unimorph-roots-${id}.tsv`,
    ]),
    'ecdict-core.tsv',
    'ecdict-inflections.tsv',
    'ecdict-inflection-index.tsv',
  ];
  const snapshots = {};
  for (const filename of snapshotFiles) {
    const contents = await readFile(new URL(`../src/data/${filename}`, import.meta.url));
    snapshots[filename] = {
      header: contents.toString('utf8').split('\n', 1)[0],
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  }

  const fixture = {
    version: 1,
    cases,
    interactiveTexts,
    snapshots,
    packOrder: {
      chinese: chineseIds,
      english: ['core', ...englishIds],
    },
  };
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `已捕获 ${String(cases.length)} 个查询与 ${String(interactiveTexts.length)} 个交互文本夹具：${outputPath.pathname}\n`,
  );
} finally {
  await server.close();
}
