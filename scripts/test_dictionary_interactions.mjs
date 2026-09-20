// CMPAA-72 专项：DictionaryContent 独立使用时的正文交互接线，以及中文词包的 O(1) 查找。
// 覆盖四部分：
// 1. 兼容 search 旧 API：不再调用 search、释义保持纯文本、SSR 不把 search 透传到 <section>；
// 2. 只有 resolveEntry + onOpenPreview 同时存在时才渲染交互词按钮；仅 resolveEntry 不渲染；
// 3. JSDOM 真实挂载预览：打开、Escape、外部点击、展开关闭顺序与 originalWord 回调；
// 4. 304196 条中文词包（目标词最后加入）：resolveChineseEntry 只做 Map.get，
//    迭代入口调用次数为 0，且 get 次数恒等于词包数（与词包大小无关）；
// 5. 源码级锁定 DictionaryContent 对 search 的兼容消费写法。
//
// 说明：任务描述里的 `.dictionary-interactive-text__word` 在仓库中并不存在；
// 已阅读 src/DictionaryInteractiveText.tsx 确认实际类名为
// `dictionary-popover__inline-word`（外层语义分组为 `dictionary-popover__semantic-word`），
// 因此交互词断言以实际类名为准。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

// 去掉 Bidi 标记与 HTML 标签，便于对“纯文本内容”做断言。
function normalizeText(markup) {
  return markup.replace(/\u2060/gu, '').replace(/<[^>]+>/gu, '');
}

// 渲染并捕获 React 的 console.error 警告，用于检测 search 被透传到 DOM 属性。
function renderCapturingWarnings(element) {
  const warnings = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };
  try {
    return { markup: renderToStaticMarkup(element), warnings };
  } finally {
    console.error = originalConsoleError;
  }
}

// 逐条打印断言结果，便于审查留档；任何一条失败最终都以退出码 1 结束。
let failures = 0;
function check(label, assertion) {
  try {
    assertion();
    console.log(`PASS  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runMountedDictionaryInteractionChecks() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div><button id="outside">外部按钮</button></body></html>',
    { pretendToBeVisual: true, url: 'http://localhost/' },
  );
  const { window } = dom;
  const { document } = window;

  // 不同 JSDOM 版本对 PointerEvent 的实现不一致；本测试只需要冒泡与 target。
  if (typeof window.PointerEvent !== 'function') {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: window.MouseEvent,
    });
  }

  const browserGlobals = {
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    document,
    Element: window.Element,
    Event: window.Event,
    FocusEvent: window.FocusEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    MutationObserver: window.MutationObserver,
    navigator: window.navigator,
    Node: window.Node,
    PointerEvent: window.PointerEvent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    self: window,
    SVGElement: window.SVGElement,
    window,
  };
  const previousGlobals = new Map();
  for (const [name, value] of Object.entries(browserGlobals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  }

  let root;
  try {
    // React DOM client 与含 portal 的组件均在 browser globals 就绪后加载。
    const [{ createRoot }, { DictionarySearchContent }] = await Promise.all([
      import('react-dom/client'),
      server.ssrLoadModule('/src/DictionarySearchContent.tsx'),
    ]);
    const rootElement = document.getElementById('root');
    const outside = document.getElementById('outside');
    assert.ok(rootElement instanceof window.HTMLElement);
    assert.ok(outside instanceof window.HTMLButtonElement);

    const searchObservations = [];
    root = createRoot(rootElement);
    await act(async () => {
      root.render(
        createElement(DictionarySearchContent, {
          corrections: {
            system: {},
            user: { note: { word: 'notte' } },
          },
          getDetail: () => undefined,
          onSearch: (query) => {
            // 必须在回调内部取样，证明 portal 的卸载先于宿主回调。
            searchObservations.push({
              previewPresent: document.body.querySelector('.dictionary-word-preview') !== null,
              query,
            });
          },
          resolveEntry: (candidate) =>
            candidate === 'note'
              ? { definition: '原始 note 释义', phonetic: '/noʊt/', word: 'note' }
              : undefined,
          sources: [
            {
              id: 'interaction-fixture',
              label: '交互测试',
              meanings: [{ definition: 'Open note here.', id: 'interaction-meaning' }],
            },
          ],
          word: 'fixture',
        }),
      );
    });

    const trigger = rootElement.querySelector('button.dictionary-popover__inline-word');
    assert.ok(trigger instanceof window.HTMLButtonElement);
    assert.equal(trigger.textContent, 'note');

    const dispatch = async (target, event) => {
      await act(async () => {
        target.dispatchEvent(event);
      });
    };
    const openPreview = async () => {
      await dispatch(trigger, new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      const preview = document.body.querySelector('.dictionary-word-preview[role="dialog"]');
      assert.ok(preview instanceof window.HTMLElement);
      return preview;
    };

    const escapePreview = await openPreview();
    check('真实交互：点击释义词打开 document.body portal', () => {
      assert.equal(rootElement.querySelector('.dictionary-word-preview'), null);
      assert.equal(escapePreview.parentElement, document.body);
      assert.equal(escapePreview.querySelector('h3')?.textContent, 'notte');
    });
    await dispatch(
      escapePreview,
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }),
    );
    check('真实交互：Escape 关闭预览并恢复触发词焦点', () => {
      assert.equal(document.body.querySelector('.dictionary-word-preview'), null);
      assert.equal(document.activeElement, trigger);
    });

    await openPreview();
    await dispatch(
      outside,
      new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
    );
    check('真实交互：外部 pointerdown 关闭预览', () => {
      assert.equal(document.body.querySelector('.dictionary-word-preview'), null);
    });

    const expandPreview = await openPreview();
    const expandButton = expandPreview.querySelector('.dictionary-word-preview__expand');
    assert.ok(expandButton instanceof window.HTMLButtonElement);
    assert.equal(expandPreview.querySelector('h3')?.textContent, 'notte');
    assert.equal(expandButton.getAttribute('aria-label'), '在主窗口打开 note');
    await dispatch(
      expandButton,
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    check('真实交互：展开先卸载预览，再以 originalWord 调用 onSearch', () => {
      assert.deepEqual(searchObservations, [{ previewPresent: false, query: 'note' }]);
      assert.equal(document.body.querySelector('.dictionary-word-preview'), null);
    });
  } finally {
    try {
      if (root !== undefined) {
        await act(async () => {
          root.unmount();
        });
      }
    } finally {
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor === undefined) {
          delete globalThis[name];
        } else {
          Object.defineProperty(globalThis, name, descriptor);
        }
      }
    }
  }
}

try {
  const { DictionaryContent } = await server.ssrLoadModule('/src/DictionaryContent.tsx');
  const { resolveChineseEntry } = await server.ssrLoadModule('/src/lookupChinese.ts');

  const interactiveWordPattern = /dictionary-popover__inline-word/u;

  // —— 1. 独立 DictionaryContent + search（旧 API 兼容） ——

  const searchCalls = [];
  // 即使 search 声称能命中任何词，也不应该被独立 DictionaryContent 消费。
  const legacySearch = (query) => {
    searchCalls.push(query);
    return [{ definition: '候选释义', word: query }];
  };
  const providedSources = [
    {
      id: 'test-source',
      label: '测试来源',
      meanings: [{ definition: '目标词语释义', id: 'test-meaning' }],
    },
  ];
  const legacyRender = renderCapturingWarnings(
    createElement(DictionaryContent, {
      keyword: '测试',
      search: legacySearch,
      sources: providedSources,
    }),
  );
  const legacyText = normalizeText(legacyRender.markup);

  check('传 search 时 search 调用数为 0', () => {
    assert.equal(searchCalls.length, 0, `search 实际被调用 ${String(searchCalls.length)} 次`);
  });
  check('传 search 时释义仍是纯文本', () => {
    assert.ok(legacyText.includes('目标词语释义'), `纯文本中缺少释义：${legacyText}`);
  });
  check('传 search 时不渲染交互词按钮（dictionary-popover__inline-word）', () => {
    assert.doesNotMatch(legacyRender.markup, interactiveWordPattern);
  });
  check('传 search 时不渲染语义分组（dictionary-popover__semantic-word）', () => {
    assert.doesNotMatch(legacyRender.markup, /dictionary-popover__semantic-word/u);
  });
  check('SSR 标记不含 search=（不透传到 <section>）', () => {
    assert.doesNotMatch(legacyRender.markup, /search=/u);
  });
  check('传 search 时不产生 React 的 Invalid value for prop 警告', () => {
    const invalidPropWarnings = legacyRender.warnings.filter(
      (warning) => warning.includes('Invalid value for prop') && warning.includes('search'),
    );
    assert.deepEqual(invalidPropWarnings, []);
  });

  // —— 2. resolveEntry + onOpenPreview 才启用交互词按钮 ——

  let previewOpenCalls = 0;
  const resolveEntryCalls = [];
  const resolveEntry = (word) => {
    resolveEntryCalls.push(word);
    return word === '示例' ? { definition: '示例释义', word: '示例' } : undefined;
  };
  const interactiveSources = [
    {
      id: 'interactive-source',
      label: '交互来源',
      meanings: [{ definition: '示例词语', id: 'interactive-meaning' }],
    },
  ];

  const interactiveMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      keyword: '示例',
      onOpenPreview: () => {
        previewOpenCalls += 1;
      },
      resolveEntry,
      sources: interactiveSources,
    }),
  );
  check('resolveEntry + onOpenPreview：渲染交互词按钮', () => {
    assert.match(
      interactiveMarkup,
      /<button[^>]*class="dictionary-popover__inline-word"[^>]*>示例<\/button>/u,
    );
  });
  check('resolveEntry + onOpenPreview：正文文字仍完整保留', () => {
    assert.ok(normalizeText(interactiveMarkup).includes('示例词语'));
  });
  check('resolveEntry + onOpenPreview：SSR 不触发预览回调', () => {
    assert.equal(previewOpenCalls, 0);
  });
  check('resolveEntry + onOpenPreview：resolver 收到待解析词', () => {
    assert.ok(resolveEntryCalls.includes('示例') && resolveEntryCalls.includes('示例词语'));
  });

  const resolveOnlyMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      keyword: '示例',
      resolveEntry,
      sources: interactiveSources,
    }),
  );
  check('仅 resolveEntry（无 onOpenPreview）：不渲染交互词按钮', () => {
    assert.doesNotMatch(resolveOnlyMarkup, interactiveWordPattern);
  });
  check('仅 resolveEntry：正文降级为纯文本且完整保留', () => {
    assert.ok(normalizeText(resolveOnlyMarkup).includes('示例词语'));
  });

  // —— 3. DictionarySearchContent 真实 DOM 交互 ——

  await runMountedDictionaryInteractionChecks();

  // —— 4. 304196 条中文词包：查找必须只走 Map.get ——

  const PACK_SIZE = 304196;
  const TARGET_WORD = '目标词语';
  const counters = { get: 0, iteration: 0, size: 0 };
  const ITERATION_METHODS = new Set(['keys', 'values', 'entries', 'forEach', Symbol.iterator]);

  const entries = new Map();
  const buildStart = performance.now();
  // 占位词条共享同一个值，控制内存占用；键全部唯一。
  const fillerEntry = ['cí diǎn', '词', ['占位释义']];
  for (let index = 0; index < PACK_SIZE - 1; index += 1) {
    entries.set(`词条${String(index)}`, fillerEntry);
  }
  // 目标词最后加入：任何依赖枚举顺序/从头扫描的实现都会退化为最坏情况。
  entries.set(TARGET_WORD, ['mù biāo cí yǔ', '名', ['目标释义']]);
  const buildMilliseconds = performance.now() - buildStart;
  assert.equal(entries.size, PACK_SIZE, '词包条目数应为 304196');

  // 用原始 Map 确认目标词确实是最后插入的键（不计入代理计数）。
  let lastKey;
  for (const key of entries.keys()) lastKey = key;
  assert.equal(lastKey, TARGET_WORD, '目标词应为最后插入的键');

  // Proxy 统计三类访问：
  // - get：Map.prototype.get 被调用的次数；
  // - iteration：keys/values/entries/forEach/Symbol.iterator 任一枚举入口被调用；
  // - size：size 属性被读取的次数（枚举信号，单独统计）。
  const countingEntries = new Proxy(entries, {
    get(target, property, receiver) {
      if (property === 'get') {
        return function countingGet(key) {
          counters.get += 1;
          return target.get(key);
        };
      }
      if (property === 'size') {
        counters.size += 1;
        return Reflect.get(target, property, receiver);
      }
      if (ITERATION_METHODS.has(property)) {
        return function countingIteration(...args) {
          counters.iteration += 1;
          return Reflect.apply(Reflect.get(target, property, receiver), target, args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const largePack = {
    entries: countingEntries,
    entryCount: entries.size,
    gzipBytes: 0,
    id: 'test-large-chinese-pack',
    label: '测试大词包',
  };
  const packs = [largePack];

  const resolveStart = performance.now();
  const found = resolveChineseEntry(TARGET_WORD, packs);
  const resolveMilliseconds = performance.now() - resolveStart;

  check('大词包：目标词命中且释义正确', () => {
    assert.ok(found, '目标词应能被解析');
    assert.equal(found.word, TARGET_WORD);
    assert.equal(found.definition, '目标释义');
  });
  check('大词包：所有迭代入口调用次数为 0', () => {
    assert.equal(counters.iteration, 0, `迭代入口被调用 ${String(counters.iteration)} 次`);
  });
  check('大词包：size 读取次数为 0', () => {
    assert.equal(counters.size, 0, `size 被读取 ${String(counters.size)} 次`);
  });
  check('大词包：get 次数为词包数常数', () => {
    assert.equal(counters.get, packs.length, `get 实际调用 ${String(counters.get)} 次`);
  });

  const getCallsBeforeMiss = counters.get;
  const missing = resolveChineseEntry('不存在的词条', packs);
  check('大词包：未命中查询同样是常数 get 且不迭代', () => {
    assert.equal(missing, undefined);
    assert.equal(counters.get - getCallsBeforeMiss, packs.length);
    assert.equal(counters.iteration, 0);
  });

  // —— 5. 源码级锁定 search 兼容消费 ——

  const contentSource = readFileSync(
    new URL('../src/DictionaryContent.tsx', import.meta.url),
    'utf8',
  );
  check('源码：参数解构消费 search（search: legacySearch）', () => {
    assert.match(contentSource, /search: legacySearch,/u);
  });
  check('源码：函数体显式消费 legacySearch（void legacySearch）', () => {
    assert.match(contentSource, /void legacySearch;/u);
  });
  check('源码：不再把 search 当作默认解析器（无 defaultSearch）', () => {
    assert.doesNotMatch(contentSource, /search as defaultSearch/u);
  });

  console.log(
    `\nINFO  词包构造 ${buildMilliseconds.toFixed(1)} ms（${String(PACK_SIZE)} 条，目标词最后加入），` +
      `resolveChineseEntry 查找 ${resolveMilliseconds.toFixed(3)} ms`,
  );
} finally {
  await server.close();
}

if (failures > 0) {
  console.error(`\n${String(failures)} 项检查未通过`);
  process.exit(1);
}
console.log('\ntest_dictionary_interactions: 全部断言通过');
