import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// 说明：本文件只做“精简专项”验证——
// 1. 纠错内容钩子的合并规则：自定义 sources/meanings 优先，音标独立回退 getDetail，显式 phonetic 覆盖它；
// 2. 英文包装组件复用已解析详情，并显式接入 O(1) resolver。
const hamsterDictionaryStubId = 'virtual:hamster-dictionary-test-double';
const resolvedHamsterDictionaryStubId = `\0${hamsterDictionaryStubId}`;
const server = await createServer({
  logLevel: 'error',
  plugins: [
    {
      enforce: 'pre',
      load(id) {
        if (id !== resolvedHamsterDictionaryStubId) return undefined;
        return `
          import { createElement } from 'react';
          import { DictionaryContent } from '/src/DictionaryContent.tsx';

          let lastProps;
          export function getLastHamsterDictionaryProps() {
            return lastProps;
          }
          export function resetLastHamsterDictionaryProps() {
            lastProps = undefined;
          }
          export function HamsterDictionary(props) {
            lastProps = props;
            return createElement(DictionaryContent, {
              getDetail: props.getDetail,
              keyword: props.query ?? props.word,
              onOpenPreview: props.resolveEntry ? () => undefined : undefined,
              phonetic: props.phonetic,
              pronounce: props.pronounce,
              resolveEntry: props.resolveEntry,
              sources: props.sources,
            });
          }
        `;
      },
      name: 'hamster-dictionary-test-double',
      resolveId(source, importer) {
        if (source === hamsterDictionaryStubId) return resolvedHamsterDictionaryStubId;
        if (
          source === './HamsterDictionary' &&
          importer?.endsWith('/src/EnglishChineseDictionaryPopover.tsx')
        ) {
          return resolvedHamsterDictionaryStubId;
        }
        return undefined;
      },
    },
  ],
  server: { middlewareMode: true },
});

// 去掉 Bidi 标记与 HTML 标签，便于对“纯文本内容”做断言。
function normalizeText(markup) {
  return markup.replace(/\u2060/gu, '').replace(/<[^>]+>/gu, '');
}

// 把音标等字面量安全地嵌入正则。
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

try {
  const { DictionaryContent } = await server.ssrLoadModule('/src/DictionaryContent.tsx');
  const { EnglishChineseDictionaryPopover } = await server.ssrLoadModule(
    '/src/EnglishChineseDictionaryPopover.tsx',
  );
  const { getLastHamsterDictionaryProps, resetLastHamsterDictionaryProps } =
    await server.ssrLoadModule(hamsterDictionaryStubId);
  const { getDetail } = await server.ssrLoadModule('/src/dictionaryData.ts');
  // 单独加载 lookupEnglishChinese：这里只验证 resolver 的入参契约（forms/index），
  // 传入小体积自定义词包，避免加载 src/data 下的核心词包。
  const { resolveEnglishChineseEntry } = await server.ssrLoadModule('/src/lookupEnglishChinese.ts');

  const detailWord = getDetail('note');
  assert.ok(detailWord, '内置词条 note 应存在，用于验证音标回退');
  assert.ok(detailWord.phonetic, '内置词条 note 应带音标');
  const detailPhonetic = detailWord.phonetic;
  const detailDefinition = detailWord.sources[0]?.meanings[0]?.definition;
  assert.equal(typeof detailDefinition, 'string');
  const phoneticRowPattern = new RegExp(
    `dictionary-popover__phonetic">英：${escapeRegExp(detailPhonetic)}<`,
    'u',
  );

  const customSources = [
    {
      id: 'custom-source',
      label: '宿主数据源',
      meanings: [{ definition: '宿主自定义释义', id: 'custom-meaning' }],
    },
  ];
  const pronounceCalls = [];

  // —— 用例 1：自定义 sources + getDetail 返回音标 + pronounce ——
  // 期望：显示自定义来源与释义、显示 getDetail 的音标文本与发音按钮，
  // 且不泄漏 detail 内置释义。
  let detailCalls = 0;
  const customGetDetail = (word) => {
    detailCalls += 1;
    assert.equal(word, 'note');
    return detailWord;
  };
  const customMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      getDetail: customGetDetail,
      keyword: 'note',
      pronounce: (word) => {
        pronounceCalls.push(word);
        return Promise.resolve();
      },
      sources: customSources,
    }),
  );
  const customText = normalizeText(customMarkup);
  // 音标独立回退：即使来源/释义由宿主提供，音标仍来自 getDetail。
  assert.equal(detailCalls, 1, '提供自定义 sources 时仍应解析 getDetail 以取得音标基准');
  assert.match(customMarkup, /dictionary-popover__source-heading/u, '应渲染来源分组');
  assert.match(customText, /宿主数据源/u, '应显示宿主来源标签');
  assert.match(customText, /宿主自定义释义/u, '应显示宿主自定义释义');
  assert.match(customMarkup, /class="dictionary-popover__phonetic"/u, '应渲染音标行');
  assert.match(customMarkup, phoneticRowPattern, '应显示 getDetail 回退的音标文本');
  assert.match(customMarkup, /dictionary-popover__pronunciation/u, '应渲染发音按钮');
  assert.match(customMarkup, /aria-label="朗读 note"/u, '发音按钮 aria-label 应指向关键词');
  assert.doesNotMatch(customText, new RegExp(detailDefinition, 'u'), '不应输出 detail 内置释义');
  assert.equal(pronounceCalls.length, 0, 'SSR 渲染不触发发音回调');

  // —— 用例 2：纠错补丁仍应叠加到自定义 sources 的释义上 ——
  const patchedMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: { user: { note: { meaning: '宿主已纠正释义' } } },
      getDetail: customGetDetail,
      keyword: 'note',
      sources: customSources,
    }),
  );
  const patchedText = normalizeText(patchedMarkup);
  assert.match(patchedText, /宿主已纠正释义/u, '纠错补丁应覆盖自定义 sources 的首条释义');
  assert.doesNotMatch(patchedText, /宿主自定义释义/u, '被补丁覆盖的旧释义不应残留');
  assert.match(patchedMarkup, /当前单词已纠错/u, '应显示纠错入口');
  assert.match(patchedMarkup, phoneticRowPattern, '纠错后音标仍应回退 getDetail');

  // —— 用例 3：缺失词 + 纠错，不依赖 getDetail ——
  // 期望：完整输出纠错来源、纠错释义、纠错音标与发音按钮，且不显示内置/空状态。
  const ghostMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: {
        onChange: () => undefined,
        user: { ghost: { meaning: '幽灵自定义', phonetic: '/ɡoʊst/' } },
      },
      getDetail: () => undefined,
      keyword: 'ghost',
      pronounce: () => Promise.resolve(),
    }),
  );
  const ghostText = normalizeText(ghostMarkup);
  assert.match(ghostText, /幽灵自定义/u, '缺失词应显示纠错释义');
  assert.match(ghostText, /用户纠错/u, '缺失词应显示纠错来源标签');
  assert.match(ghostMarkup, /英：\/ɡoʊst\//u, '缺失词应显示纠错音标');
  assert.match(ghostMarkup, /aria-label="朗读 ghost"/u, '缺失词应渲染发音按钮');
  assert.doesNotMatch(ghostText, /（原词库无此词条）/u, '释义已被补丁覆盖，不应出现缺失占位符');
  assert.doesNotMatch(ghostText, /没有找到释义/u, '不应落入空状态');

  // —— 用例 4：显式 phonetic 覆盖 detail 音标 ——
  const explicitPhoneticMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      getDetail: customGetDetail,
      keyword: 'note',
      phonetic: '/explicit/',
      sources: customSources,
    }),
  );
  const explicitPhoneticText = normalizeText(explicitPhoneticMarkup);
  assert.match(explicitPhoneticText, /英：\/explicit\//u, '显式 phonetic 应覆盖 detail 音标');
  assert.ok(!explicitPhoneticText.includes(`英：${detailPhonetic}`), 'detail 音标不应再出现');

  // —— 用例 5：英文包装组件复用详情音标，避免自定义来源触发第二次查询 ——
  resetLastHamsterDictionaryProps();
  let wrapperDetailCalls = 0;
  const wrapperMarkup = renderToStaticMarkup(
    createElement(EnglishChineseDictionaryPopover, {
      getDetail: (word) => {
        wrapperDetailCalls += 1;
        assert.equal(word, 'note');
        return detailWord;
      },
      open: true,
      pronounce: () => Promise.resolve(),
      query: 'note',
      resolveEntry: () => undefined,
      search: () => [],
      sources: customSources,
    }),
  );
  const wrapperText = normalizeText(wrapperMarkup);
  assert.equal(wrapperDetailCalls, 1, '包装组件应复用同一次 getDetail 的音标结果');
  assert.match(wrapperText, /宿主自定义释义/u, '包装组件应保留宿主自定义释义');
  assert.match(wrapperMarkup, phoneticRowPattern, '包装组件应显示详情音标');
  assert.match(wrapperMarkup, /aria-label="朗读 note"/u, '包装组件应保留发音按钮');
  assert.doesNotMatch(wrapperText, new RegExp(detailDefinition, 'u'), '包装组件不应泄漏内置释义');
  const wrapperProps = getLastHamsterDictionaryProps();
  assert.equal(wrapperProps?.phonetic, detailPhonetic, '包装组件应把已解析详情音标传给内容层');
  assert.equal(wrapperProps?.sources, customSources, '包装组件应原样传递宿主来源');
  assert.equal(
    typeof wrapperProps?.resolveEntry,
    'function',
    '包装组件应向主窗口传入精确 resolver',
  );

  // 显式空音标也是有效覆盖值，不应被中间层 truthy 判断吞掉并回退到词典音标。
  resetLastHamsterDictionaryProps();
  let emptyPhoneticDetailCalls = 0;
  const emptyPhoneticMarkup = renderToStaticMarkup(
    createElement(EnglishChineseDictionaryPopover, {
      getDetail: () => {
        emptyPhoneticDetailCalls += 1;
        return detailWord;
      },
      open: true,
      phonetic: '',
      pronounce: () => Promise.resolve(),
      query: 'note',
      resolveEntry: () => undefined,
      search: () => [],
      sources: customSources,
    }),
  );
  assert.equal(emptyPhoneticDetailCalls, 1, '显式空音标不应导致内容层再次查询详情');
  assert.doesNotMatch(emptyPhoneticMarkup, /dictionary-popover__phonetic/u);
  assert.doesNotMatch(emptyPhoneticMarkup, /dictionary-popover__pronunciation/u);
  assert.equal(
    getLastHamsterDictionaryProps()?.phonetic,
    '',
    '包装组件应保留显式空音标，而不是回退详情音标',
  );

  // resolver 的组件接线再用源码形状作补充锁定。
  const wrapperSource = readFileSync(
    new URL('../src/EnglishChineseDictionaryPopover.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    wrapperSource,
    /import \{ resolveEnglishChineseEntry \} from '\.\/lookupEnglishChinese';/u,
    '包装组件应导入 resolveEnglishChineseEntry',
  );
  assert.match(wrapperSource, /props\.resolveEntry/u, '包装组件应读取 props.resolveEntry');
  assert.match(
    wrapperSource,
    /providedResolveEntry\s*\?\?\s*\(\(word\)\s*=>\s*resolveEnglishChineseEntry\(word, vocabularyPacks,/u,
    '默认 resolver 应以 vocabularyPacks 作为第二参数',
  );
  assert.match(
    wrapperSource,
    /forms:\s*inflectionFormsPacks,\s*index:\s*inflectionIndexPacks,/u,
    '默认 resolver 应携带 forms/index 变形包',
  );
  const resolveEntryBlock = wrapperSource.slice(
    wrapperSource.indexOf('const resolveEntry = useMemo('),
    wrapperSource.indexOf('const getDetail = useMemo'),
  );
  assert.ok(resolveEntryBlock.length > 0, '应存在 resolveEntry 的 useMemo');
  for (const dependency of [
    'inflectionFormsPacks',
    'inflectionIndexPacks',
    'providedResolveEntry',
    'vocabularyPacks',
  ]) {
    assert.match(resolveEntryBlock, new RegExp(`\\b${dependency}\\b`, 'u'));
  }
  assert.match(
    wrapperSource,
    /query=\{query\}\s*resolveEntry=\{resolveEntry\}\s*search=\{search\}/u,
    '应将显式 resolveEntry 传给 HamsterDictionary',
  );

  // —— 附加：resolver 入参契约与显式覆盖（运行时，轻量） ——
  const customPack = {
    entries: new Map([['customword', ['ˈkʌstəm', 'adj. 自定义的']]]),
    entryCount: 1,
    gzipBytes: 0,
    id: 'test-pack',
    label: '测试词包',
  };
  const customResolved = resolveEnglishChineseEntry('customword', [customPack]);
  assert.equal(customResolved?.word, 'customword');
  assert.equal(customResolved?.phonetic, '/ˈkʌstəm/');
  assert.equal(customResolved?.definition, '自定义的');
  assert.equal(resolveEnglishChineseEntry('missingword', [customPack]), undefined);
  // 词包缺失但变形索引命中：resolver 仍应给出摘要，供行内预览使用。
  const inflectedResolved = resolveEnglishChineseEntry('customwords', [customPack], {
    index: [
      {
        entries: new Map([['customwords', [{ kind: 's', lemma: 'customword' }]]]),
        entryCount: 1,
        gzipBytes: 0,
        id: 'test-index',
        label: '测试变形索引',
      },
    ],
  });
  assert.equal(inflectedResolved?.word, 'customwords');
  assert.match(inflectedResolved?.definition ?? '', /customword/u, '变形解析应引用原形词');
  assert.equal(inflectedResolved?.phonetic, undefined, '变形摘要没有独立音标');
} finally {
  await server.close();
}
