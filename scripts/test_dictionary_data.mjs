import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { createChineseDictionaryPack } = await server.ssrLoadModule(
    '/src/chineseDictionaryPack.ts',
  );
  const { getDetail, search } = await server.ssrLoadModule('/src/dictionaryData.ts');
  const { DictionaryContent } = await server.ssrLoadModule('/src/DictionaryContent.tsx');
  const chineseDictionaryPack = createChineseDictionaryPack(
    ['# fixture', '心\txīn\t汉字\t内心', '心安\txīn ān\t词语\t内心安定'].join('\n'),
    {
      entryCount: 2,
      gzipBytes: 0,
      id: 'dictionary-data-fixture',
      label: '详情数据测试词库',
    },
  );

  // Given 默认英文词典；When 获取词条详情；Then 返回可 JSON 序列化的统一详情合同。
  const englishDetail = getDetail('note');
  assert.equal(englishDetail?.word, 'note');
  assert.equal(typeof englishDetail?.phonetic, 'string');
  assert.equal(typeof englishDetail?.sources[0]?.meanings[0]?.definition, 'string');
  assert.doesNotThrow(() => JSON.stringify(englishDetail));

  // Given 注入的中文词库；When 获取中文详情；Then 使用同一合同并保留来源信息。
  const chineseDetail = getDetail('心', { chineseDictionaryPacks: [chineseDictionaryPack] });
  assert.deepEqual(chineseDetail, {
    phonetic: 'xīn',
    sources: [
      {
        id: 'dictionary-data-fixture',
        label: '详情数据测试词库',
        meanings: [{ definition: '内心', id: '心-1', partOfSpeech: '汉字' }],
      },
    ],
    word: '心',
  });

  // Given 同一数据能力；When 搜索候选；Then 返回基础读音和释义，不混入视图节点。
  assert.deepEqual(search('心', { chineseDictionaryPacks: [chineseDictionaryPack] }), [
    { definition: '内心', phonetic: 'xīn', word: '心' },
    { definition: '内心安定', phonetic: 'xīn ān', word: '心安' },
  ]);
  assert.equal(getDetail('不存在', { chineseDictionaryPacks: [chineseDictionaryPack] }), undefined);

  // Given 外部实现的数据能力；When 渲染详情视图；Then 视图只消费注入 JSON，并用 search 检索释义词语。
  const searchedWords = [];
  const markup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      getDetail: (word) => ({
        sources: [
          {
            id: 'external',
            label: '外部数据源',
            meanings: [{ definition: 'durable knowledge', id: 'external-1' }],
          },
        ],
        word,
      }),
      keyword: 'external-entry',
      onOpenPreview: () => {},
      search: (word) => {
        searchedWords.push(word);
        return word === 'durable' ? [{ definition: '持久的', word }] : [];
      },
    }),
  );
  assert.match(markup, /external-entry/);
  assert.match(markup, /外部数据源/);
  assert.match(markup, /dictionary-popover__inline-word/);
  assert.ok(searchedWords.includes('durable'));

  // Given search 只返回前缀候选；When 渲染详情词元；Then 不把原词错误链接到其他词条。
  const prefixMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      getDetail: (word) => ({
        sources: [
          {
            id: 'prefix',
            label: '前缀候选测试',
            meanings: [{ definition: 'dur', id: 'prefix-1' }],
          },
        ],
        word,
      }),
      keyword: 'prefix-entry',
      onOpenPreview: () => {},
      search: () => [{ definition: '持久的', word: 'durable' }],
    }),
  );
  assert.doesNotMatch(prefixMarkup, /dictionary-popover__inline-word/);
} finally {
  await server.close();
}
