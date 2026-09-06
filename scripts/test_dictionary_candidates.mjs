import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { createChineseDictionaryPack } = await server.ssrLoadModule(
    '/src/chineseDictionaryPack.ts',
  );
  const { searchDictionaryCandidates } = await server.ssrLoadModule(
    '/src/searchDictionaryCandidates.ts',
  );
  const chineseDictionaryPack = createChineseDictionaryPack(
    ['# fixture', '心\txīn\t汉字\t内心', '心安\txīn ān\t词语\t内心安定'].join('\n'),
    {
      entryCount: 2,
      gzipBytes: 0,
      id: 'dictionary-candidate-fixture',
      label: '候选搜索测试词库',
    },
  );

  // Given 英文核心词典；When 输入英文前缀；Then 返回含词头、音标和释义的候选信息。
  const englishCandidates = searchDictionaryCandidates('note');
  assert.equal(englishCandidates[0]?.word, 'note');
  assert.equal(typeof englishCandidates[0]?.definition, 'string');
  assert.equal(typeof englishCandidates[0]?.phonetic, 'string');

  // Given 已加载中文词典；When 输入汉字；Then 自动走中文候选路径。
  const chineseCandidates = searchDictionaryCandidates('心', {
    chineseDictionaryPacks: [chineseDictionaryPack],
  });
  assert.deepEqual(chineseCandidates, [
    { definition: '内心', phonetic: 'xīn', word: '心' },
    { definition: '内心安定', phonetic: 'xīn ān', word: '心安' },
  ]);

  // Given 只有空白；When 搜索候选；Then 不返回无意义结果。
  assert.deepEqual(searchDictionaryCandidates('   '), []);
} finally {
  await server.close();
}
