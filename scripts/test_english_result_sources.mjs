import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { createEnglishResultSources } = await server.ssrLoadModule('/src/englishResultSources.ts');
  const sources = createEnglishResultSources({
    examples: ['A note helps.'],
    inflections: [{ form: 'notes', kind: 's' }],
    kind: 'entry',
    meanings: [{ definition: '笔记', id: 'note-1' }],
    roots: [],
    status: 'found',
    synonyms: ['record'],
    word: 'note',
  });
  const ids = sources.map((source) => source.id);

  assert.equal(
    new Set(ids).size,
    ids.length,
    `英文查询结果的来源 id 必须唯一，实际为：${ids.join(', ')}`,
  );
} finally {
  await server.close();
}
