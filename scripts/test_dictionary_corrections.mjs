import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const {
    createDictionaryCorrectionPatch,
    mergeDictionaryPhoneticCorrection,
    normalizeDictionaryCorrectionKey,
    resolveDictionaryCorrection,
    sanitizeDictionaryCorrectionMap,
  } = await server.ssrLoadModule('/src/dictionaryCorrections.ts');
  const {
    applyDictionaryCorrectionToDetail,
    applyDictionaryCorrectionToSummary,
    createDictionaryCorrectedDetail,
  } = await server.ssrLoadModule('/src/dictionaryCorrectionApply.ts');
  const { createDictionaryCorrectionStore, createLocalDictionaryCorrectionStore } =
    await server.ssrLoadModule('/src/dictionaryCorrectionStore.ts');
  const { DictionaryContent } = await server.ssrLoadModule('/src/DictionaryContent.tsx');
  const { getDetail } = await server.ssrLoadModule('/src/dictionaryData.ts');
  const { SYSTEM_DICTIONARY_CORRECTIONS } = await server.ssrLoadModule(
    '/src/systemDictionaryCorrections.ts',
  );

  // Given 混合脚本的词头；When 规范化纠错键；Then 拉丁小写、中文保留。
  assert.equal(normalizeDictionaryCorrectionKey('  Note '), 'note');
  assert.equal(normalizeDictionaryCorrectionKey('心安'), '心安');
  assert.equal(normalizeDictionaryCorrectionKey('Ｈｅｌｌｏ　World'), 'hello world');

  // Given 用户与系统纠错同时存在；When 解析生效补丁；Then 逐字段合并，用户优先于系统。
  const precedence = resolveDictionaryCorrection('note', {
    system: { note: { phonetic: '/sys/', word: 'sysnote' } },
    user: { note: { phonetic: '/user/' } },
  });
  assert.equal(precedence?.origin, 'user');
  assert.equal(precedence?.patch.phonetic, '/user/');
  assert.equal(precedence?.patch.word, 'sysnote');
  const systemOnly = resolveDictionaryCorrection('NOTE', {
    system: { note: { phonetic: '/sys/' } },
  });
  assert.equal(systemOnly?.origin, 'system');

  // Given 仅改音标的保存；When 合并既有用户补丁；Then word/meaning 字段原样保留。
  assert.deepEqual(
    mergeDictionaryPhoneticCorrection({ meaning: '自定义释义', word: 'notte' }, '/nəʊt/', '/nәut/'),
    { meaning: '自定义释义', phonetic: '/nəʊt/', word: 'notte' },
  );
  // Given 音标改回原值；When 合并；Then 丢弃音标字段，仅保留其他用户字段。
  assert.deepEqual(mergeDictionaryPhoneticCorrection({ word: 'notte' }, '/nәut/', '/nәut/'), {
    word: 'notte',
  });
  // Given 音标改回原值且无其他字段；Then 返回 null 表示删除纠错。
  assert.equal(mergeDictionaryPhoneticCorrection(undefined, '/nәut/', '/nәut/'), null);
  assert.equal(mergeDictionaryPhoneticCorrection(undefined, '  ', ''), null);

  // Given 词条详情；When 应用补丁；Then 词头、音标、首条释义被逐字段覆盖。
  const noteDetail = getDetail('note');
  assert.ok(noteDetail);
  const corrected = applyDictionaryCorrectionToDetail(noteDetail, {
    user: { note: { meaning: '自定义释义', phonetic: '/nəʊt/', word: 'notte' } },
  });
  assert.equal(corrected.detail.word, 'notte');
  assert.equal(corrected.detail.phonetic, '/nəʊt/');
  assert.equal(corrected.detail.sources[0]?.meanings[0]?.definition, '自定义释义');
  assert.deepEqual(
    corrected.changes.map((change) => change.field),
    ['word', 'phonetic', 'meaning'],
  );
  const untouched = applyDictionaryCorrectionToDetail(noteDetail, { user: {} });
  assert.equal(untouched.changes.length, 0);
  assert.equal(untouched.detail.word, noteDetail.word);

  // Given 词条摘要；When 应用补丁；Then 候选展示字段被覆盖。
  const summary = applyDictionaryCorrectionToSummary(
    { definition: '笔记', phonetic: '/nəʊt/', word: 'note' },
    { system: { note: { phonetic: '/nəut/' } } },
  );
  assert.equal(summary.summary.phonetic, '/nəut/');
  assert.equal(summary.summary.definition, '笔记');
  assert.equal(summary.changes[0]?.field, 'phonetic');
  assert.equal(summary.changes[0]?.origin, 'system');

  // Given 编辑值与原始值一致；When 生成补丁；Then 返回 null 以删除纠错。
  assert.equal(
    createDictionaryCorrectionPatch(
      { meaning: '笔记', phonetic: '/nəʊt/', word: 'note' },
      { meaning: '笔记', phonetic: '/nəʊt/', word: 'note' },
    ),
    null,
  );
  assert.deepEqual(
    createDictionaryCorrectionPatch(
      { meaning: '笔记', phonetic: '/x/', word: 'note' },
      { meaning: '笔记', phonetic: '/nəʊt/', word: 'note' },
    ),
    { phonetic: '/x/' },
  );

  // Given 外部 JSON；When 清洗纠错表；Then 丢弃非法键与字段。
  assert.deepEqual(
    sanitizeDictionaryCorrectionMap({
      bad: { word: 1 },
      empty: {},
      note: { meaning: '笔记', phonetic: '  /nəʊt/  ', word: 'notte' },
    }),
    { note: { meaning: '笔记', phonetic: '/nəʊt/', word: 'notte' } },
  );

  // Given 假存储；When 通过仓库读写；Then 读写往返一致。
  const memory = new Map();
  const memoryStore = createDictionaryCorrectionStore(
    {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, value),
    },
    'test-key',
  );
  memoryStore.save({ note: { phonetic: '/x/' } });
  assert.deepEqual(memoryStore.load(), { note: { phonetic: '/x/' } });

  // Given 写入会失败的存储；When 保存；Then 异常原样抛出，不产生假成功。
  const failingStore = createDictionaryCorrectionStore({
    getItem: () => null,
    setItem: () => {
      throw new Error('磁盘配额已满');
    },
  });
  assert.throws(() => failingStore.save({ note: { phonetic: '/x/' } }), /磁盘配额已满/u);

  // Given 默认本地存储工厂；When 在非浏览器环境创建；Then 明确抛出而不是静默共享状态。
  assert.throws(() => createLocalDictionaryCorrectionStore(), ReferenceError);

  // Given 已确认的 curiosity 勘误；When 加载随包系统纠错表；Then 保留指定音标。
  assert.deepEqual(SYSTEM_DICTIONARY_CORRECTIONS.curiosity, { phonetic: "/.kjuәri'ɒsəti/" });

  // Given 纠错后的详情；When 渲染 DictionaryContent；Then 词头展示纠错拼写并出现详情弹窗按钮。
  const markup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: {
        onChange: () => undefined,
        user: { note: { phonetic: '/nəut/', word: 'notte' } },
      },
      keyword: 'note',
    }),
  );
  assert.match(markup, /notte/u);
  assert.match(markup, /\/nəut\//u);
  assert.match(markup, /当前单词已纠错/u);
  assert.match(markup, /aria-haspopup="dialog"/u);
  // SSR 下不渲染模态弹窗内容。
  assert.doesNotMatch(markup, /dictionary-correction__panel/u);

  // Given 仅音标被纠错；When 渲染 DictionaryContent；Then “已纠错”紧跟音标且不再出现“当前单词已纠错”。
  const phoneticOnlyMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: {
        onChange: () => undefined,
        user: { note: { phonetic: '/nəut/' } },
      },
      keyword: 'note',
    }),
  );
  assert.match(
    phoneticOnlyMarkup,
    /dictionary-popover__phonetic">\/nəut\/<\/p><button aria-haspopup="dialog" class="dictionary-correction-details__summary"[^>]*>已纠错<\/button>/u,
  );
  assert.doesNotMatch(phoneticOnlyMarkup, /当前单词已纠错/u);

  // Given 宿主禁用纠错；When 渲染；Then 不显示纠错入口且内容保持原样。
  const disabledMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: { disabled: true, user: { note: { word: 'notte' } } },
      keyword: 'note',
    }),
  );
  assert.doesNotMatch(disabledMarkup, />纠错</u);
  assert.doesNotMatch(disabledMarkup, /notte/u);

  // Given 受控纠错；When 查看纠错入口；Then 按钮存在且 aria-label 指向原始词头。
  assert.match(markup, /aria-label="纠错词条 note"/u);

  // —— 回归：修复清单 ——

  // 修复 1：corrections 必须传入内容组件并被应用，且不会泄漏到 DOM 属性。
  // （HamsterDictionary 依赖 multi-drag 无法在 Node SSR 中加载；其转发目标是 DictionarySearchContent。）
  const { DictionarySearchContent } = await server.ssrLoadModule(
    '/src/DictionarySearchContent.tsx',
  );
  const hamsterMarkup = renderToStaticMarkup(
    createElement(DictionarySearchContent, {
      corrections: { user: { note: { word: 'notte' } } },
      word: 'note',
    }),
  );
  assert.match(hamsterMarkup, /notte/u);
  assert.doesNotMatch(hamsterMarkup, /corrections=/u);

  // 修复 2：纠错摘要保留原始词头，供提交与展开使用。
  const identity = applyDictionaryCorrectionToSummary(
    { definition: '笔记', phonetic: '/nәut/', word: 'note' },
    { user: { note: { word: 'notte' } } },
  );
  assert.equal(identity.originalWord, 'note');
  assert.equal(identity.summary.word, 'notte');

  // 修复 3：保存合并不再依赖变化列表；未改音标时回落到 getDetail 的原始音标。
  const rawDetail = getDetail('note');
  assert.ok(rawDetail?.phonetic);
  assert.equal(
    mergeDictionaryPhoneticCorrection(undefined, rawDetail.phonetic, rawDetail.phonetic),
    null,
  );
  assert.deepEqual(mergeDictionaryPhoneticCorrection(undefined, '/x/', rawDetail.phonetic), {
    phonetic: '/x/',
  });

  // 修复 4：系统拼写 + 用户音标混合时，逐字段标注来源。
  const mixed = applyDictionaryCorrectionToDetail(noteDetail, {
    system: { note: { meaning: '系统释义', word: 'sysnote' } },
    user: { note: { phonetic: '/up/' } },
  });
  assert.deepEqual(
    mixed.changes.map((change) => [change.field, change.origin]),
    [
      ['word', 'system'],
      ['phonetic', 'user'],
      ['meaning', 'system'],
    ],
  );

  // 修复 5：托管模式缺少 onChange 时不可编辑；提供回调后可编辑。
  const { resolveDictionaryCorrectionsControl } = await server.ssrLoadModule(
    '/src/useDictionaryCorrections.ts',
  );
  assert.equal(resolveDictionaryCorrectionsControl({ user: {} }).editable, false);
  assert.equal(
    resolveDictionaryCorrectionsControl({ onChange: () => undefined, user: {} }).editable,
    true,
  );
  assert.equal(resolveDictionaryCorrectionsControl(undefined).editable, true);
  const readOnlyMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: { user: { note: { word: 'notte' } } },
      keyword: 'note',
    }),
  );
  // 补丁仍然应用（只读展示），但编辑入口被隐藏，绝不静默保存。
  assert.match(readOnlyMarkup, /notte/u);
  assert.doesNotMatch(readOnlyMarkup, /aria-label="纠错词条/u);

  // 修复 6：IPA 键盘覆盖完整清单——咝音/内爆音/搭嘴音/声调字母。
  const { DICTIONARY_IPA_KEY_GROUPS } = await server.ssrLoadModule('/src/dictionaryIpaKeys.ts');
  const allKeys = DICTIONARY_IPA_KEY_GROUPS.flatMap((group) => group.keys);
  for (const symbol of [
    'ɬ',
    'ɮ',
    'ɓ',
    'ɗ',
    'ʄ',
    'ɠ',
    'ʛ',
    'ʘ',
    'ǀ',
    'ǃ',
    'ǂ',
    'ǁ',
    '˥',
    '˦',
    '˧',
    '˨',
    '˩',
    'ɨ',
    'ʉ',
    'ɯ',
    'ʏ',
    'ɘ',
    'ɵ',
    'ɤ',
    'ɜ',
    'ɞ',
    'ɶ',
    'ä',
    'ʈ',
    'c',
    'q',
    'ʡ',
    'ɖ',
    'ɟ',
    'ɢ',
    'ɕ',
    'ʑ',
    'ɧ',
    'ɱ',
    'ɳ',
    'ɲ',
    'ɴ',
    'ʋ',
    'ɹ',
    'ɻ',
    'ɰ',
    'ʍ',
    'ɭ',
    'ʎ',
    'ʟ',
    'ɫ',
    'ʀ',
    'ɾ',
    'ɽ',
    'ˈ',
    'ˌ',
    'ː',
    'ˑ',
    '̆',
    '̃',
    '̥',
    'ʰ',
    'ʷ',
    'ʲ',
    'ˠ',
    'ˤ',
    'ⁿ',
    'ˡ',
    '̚',
    'ā',
    'ǖ',
    'ń',
  ]) {
    assert.ok(allKeys.includes(symbol), `IPA 键盘缺少符号 ${symbol}`);
  }

  // 修复 7a：词库缺失词条的纠错详情真正应用补丁，而不是停留占位符。
  const ghost = createDictionaryCorrectedDetail('ghost', {
    user: { ghost: { meaning: '幽灵自定义', phonetic: '/ɡoʊst/' } },
  });
  assert.equal(ghost?.detail.sources[0]?.meanings[0]?.definition, '幽灵自定义');
  assert.equal(ghost?.detail.phonetic, '/ɡoʊst/');
  assert.equal(ghost?.changes.length, 2);

  // 修复 7b：宿主提供 sources/meanings 时，变化对比的是提供的数据而非内置词典。
  const providedMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: { user: { 'custom-entry': { meaning: '宿主已纠正释义' } } },
      keyword: 'custom-entry',
      meanings: [{ definition: '宿主原始释义', id: 'custom-1' }],
      sources: [
        {
          id: 'custom',
          label: '宿主数据源',
          meanings: [{ definition: '宿主原始释义', id: 'custom-1' }],
        },
      ],
    }),
  );
  const normalizedProvidedMarkup = providedMarkup.replace(/\u2060/gu, '').replace(/<[^>]+>/gu, '');
  assert.match(normalizedProvidedMarkup, /宿主已纠正释义/u);
  assert.match(providedMarkup, /当前单词已纠错/u);
} finally {
  await server.close();
}
