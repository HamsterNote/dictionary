import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { createChineseDictionaryPack } = await server.ssrLoadModule(
    '/src/chineseDictionaryPack.ts',
  );
  const { suggestChinese } = await server.ssrLoadModule('/src/lookupChinese.ts');
  const snapshot = [
    '# fixture',
    '心\txīn\t汉字\t内心',
    '心安\txīn ān\t词语\t内心安定',
    '心愿\txīn yuàn\t词语\t愿望',
    '心事\txīn shì\t词语\t心里盘算的事',
    '心声\txīn shēng\t词语\t发自内心的声音',
    '心灵\txīn líng\t词语\t思想感情',
    '心情\txīn qíng\t词语\t情绪状态',
    '心态\txīn tài\t词语\t心理状态',
    '心疼\txīn téng\t词语\t疼爱或舍不得',
    '心境\txīn jìng\t词语\t内心的境况',
    '心上人\txīn shàng rén\t词语\t爱慕的人',
    '心连心\txīn lián xīn\t词语\t彼此知心',
    '心里话\txīn lǐ huà\t词语\t内心想说的话',
    '心头肉\txīn tóu ròu\t词语\t最亲爱的人',
    '心窝子\txīn wō zi\t词语\t心里',
    '心电图\txīn diàn tú\t词语\t心脏电活动图形',
    '心眼儿\txīn yǎnr\t词语\t心地或心计',
    '心肝儿\txīn gānr\t词语\t最亲爱的人',
    '心尖儿\txīn jiānr\t词语\t心里最喜爱的人',
    '心脏病\txīn zàng bìng\t词语\t心脏疾病',
    '心想事成\txīn xiǎng shì chéng\t成语\t愿望实现',
    '心心相印\txīn xīn xiāng yìn\t成语\t心意相通',
    '心有灵犀一点通\txīn yǒu líng xī yī diǎn tōng\t成语\t彼此心意相通',
    '心不负人，面无惭色\txīn bù fù rén\t成语\t内心坦然',
  ].join('\n');
  const dictionaryPack = createChineseDictionaryPack(snapshot, {
    entryCount: 24,
    gzipBytes: 0,
    id: 'chinese-suggestion-fixture',
    label: '中文候选测试词库',
  });

  const suggestions = suggestChinese('心', [dictionaryPack]);

  assert.deepEqual(
    suggestions,
    [
      '心',
      '心安',
      '心愿',
      '心事',
      '心声',
      '心灵',
      '心情',
      '心态',
      '心疼',
      '心境',
      '心上人',
      '心连心',
      '心里话',
      '心头肉',
      '心窝子',
      '心电图',
      '心眼儿',
      '心肝儿',
    ],
    '中文候选默认应显示 18 条，同时将精确匹配置顶并将其余候选按字数升序排列',
  );
} finally {
  await server.close();
}
