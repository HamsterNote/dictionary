import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const words = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(words) || words.length === 0 || words.some((word) => typeof word !== 'string')) {
  throw new TypeError('lookup 输入必须是非空字符串数组');
}

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });
try {
  const { getDetail } = await server.ssrLoadModule('/src/dictionaryData.ts');
  const records = words.map((word) => {
    const detail = getDetail(word);
    return {
      word,
      detailWord: detail?.word ?? null,
      phonetic: detail?.phonetic ?? null,
    };
  });
  process.stdout.write(JSON.stringify({ schema: 'pronunciation-audio-lookup/1', records }) + '\n');
} finally {
  await server.close();
}
