// CMPAA-72：验证「清除此词纠错」整补丁删除与受控大小写真实键修复。
// 覆盖四部分：
// 1. 读取与写入共用真实键：`Note` 复用、删除、新词规范化键；
// 2. useDictionaryCorrections 的 save/reset：受控模式按真实键回调 onChange；
// 3. 非受控本地存储：预置真实键 `Note` 时 save/reset('note') 命中 `Note`，
//    reset 后持久化结果完全清空；新词仍写入规范化键；
// 4. DictionaryContent 实际应用大小写不同的受控补丁；
// 5. Dialog 的兼容 reset 回调合同与 Content 的接线合同。
// 说明：仓库没有 DOM 测试环境（无 jsdom/testing-library），第 4 部分按源码
// 断言接线形状，其余部分均为真实模块的行为断言。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const {
    DICTIONARY_CORRECTION_STORAGE_KEY,
    mergeDictionaryPhoneticCorrection,
    normalizeDictionaryCorrectionKey,
    resolveDictionaryCorrection,
    resolveDictionaryCorrectionWriteKey,
  } = await server.ssrLoadModule('/src/dictionaryCorrections.ts');
  const { DictionaryContent } = await server.ssrLoadModule('/src/DictionaryContent.tsx');
  const { useDictionaryCorrections } = await server.ssrLoadModule(
    '/src/useDictionaryCorrections.ts',
  );

  // —— 1. 纯 helper：受控 user 表的真实键必须复用 ——

  const managedUser = {
    Note: { meaning: '旧释义', phonetic: '/nəʊt/', word: 'Notte' },
  };

  // 读取必须和写入使用同一真实键，否则保存音标时会把原 word/meaning 丢掉。
  const resolvedManaged = resolveDictionaryCorrection('note', { user: managedUser });
  assert.equal(resolvedManaged?.key, 'Note');
  assert.deepEqual(resolvedManaged?.patch, managedUser.Note);
  assert.deepEqual(resolvedManaged?.fieldOrigins, {
    meaning: 'user',
    phonetic: 'user',
    word: 'user',
  });

  // Given 宿主 user 表存在真实键 `Note`；When 以同一词头写入；Then 沿用 `Note`（更新不产生重复条目）。
  assert.equal(resolveDictionaryCorrectionWriteKey('Note', managedUser), 'Note');
  // Given 词头大小写/空白与真实键不一致；When 写入；Then 仍命中等价真实键（删除能清掉原条目）。
  assert.equal(resolveDictionaryCorrectionWriteKey('note', managedUser), 'Note');
  assert.equal(resolveDictionaryCorrectionWriteKey(' Note ', managedUser), 'Note');
  // Given 表中只有规范化键；When 写入；Then 沿用该规范化键。
  assert.equal(resolveDictionaryCorrectionWriteKey('Note', { note: { phonetic: '/x/' } }), 'note');
  // Given 新词（表中无等价条目）；When 写入；Then 使用规范化键。
  assert.equal(resolveDictionaryCorrectionWriteKey('Note', {}), 'note');
  assert.equal(resolveDictionaryCorrectionWriteKey('NewWord', undefined), 'newword');
  assert.equal(resolveDictionaryCorrectionWriteKey('心安', {}), '心安');
  assert.equal(resolveDictionaryCorrectionWriteKey('心安', { 心安: { word: '新安' } }), '心安');
  // 规范化语义与 normalizeDictionaryCorrectionKey 保持一致。
  assert.equal(
    resolveDictionaryCorrectionWriteKey('Ｈｅｌｌｏ　World', undefined),
    normalizeDictionaryCorrectionKey('Ｈｅｌｌｏ　World'),
  );

  // —— 2. 受控管理器 save/reset 回调 onChange 的键 ——

  const onChangeCalls = [];
  let managed;
  renderToStaticMarkup(
    createElement(function ManagedProbe() {
      managed = useDictionaryCorrections({
        onChange: (word, patch) => {
          onChangeCalls.push([word, patch]);
        },
        user: managedUser,
      });
      return null;
    }),
  );
  assert.equal(managed.managed, true);

  // Given 用规范化词头更新 `Note`；When 保存音标补丁；Then onChange 仍收到真实键 `Note`。
  managed.save('note', { phonetic: '/new/' });
  assert.deepEqual(onChangeCalls.at(-1), ['Note', { phonetic: '/new/' }]);

  // Given 用规范化词头清除 `Note`；When reset；Then回调真实键与 null，即整条补丁删除。
  managed.reset('note');
  assert.deepEqual(onChangeCalls.at(-1), ['Note', null]);

  // Given 新词；When 保存；Then onChange 收到规范化键。
  managed.save('NewWord', { phonetic: '/x/' });
  assert.deepEqual(onChangeCalls.at(-1), ['newword', { phonetic: '/x/' }]);

  // —— 3. 非受控本地存储：真实键命中清空与新词规范化键 ——

  const memory = new Map();
  // 必须在首次触发本地缓存之前预置（模块级缓存惰性创建并读取 localStorage）。
  // 真实键 `Note` 与查询词头 `note` 规范化后等价，但字符串本身不同。
  memory.set(
    DICTIONARY_CORRECTION_STORAGE_KEY,
    JSON.stringify({ Note: { meaning: '预置释义', phonetic: '/nəʊt/', word: 'Notte' } }),
  );
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, value),
      },
    },
  });
  let local;
  renderToStaticMarkup(
    createElement(function LocalProbe() {
      local = useDictionaryCorrections();
      return null;
    }),
  );
  // Given 本地存储已有真实键 `Note`；When 用规范化词头保存；Then 更新真实键，不新建 `note`。
  local.save('note', { phonetic: '/new/' });
  assert.deepEqual(JSON.parse(memory.get(DICTIONARY_CORRECTION_STORAGE_KEY)), {
    Note: { phonetic: '/new/' },
  });

  // 回归：Given 本地存储预置 `Note`；When reset('note')；
  // Then 真正命中的 `Note` 被删除，持久化结果完全清空，既不残留 `Note` 也不产生 `note`。
  local.reset('note');
  assert.deepEqual(JSON.parse(memory.get(DICTIONARY_CORRECTION_STORAGE_KEY)), {});

  // Given 本地模式、表中无等价条目（新词）；When 保存大写词头；Then 仍写入规范化键。
  local.save('Note', { phonetic: '/x/' });
  assert.deepEqual(Object.keys(JSON.parse(memory.get(DICTIONARY_CORRECTION_STORAGE_KEY))), [
    'note',
  ]);
  local.reset('Note');
  assert.deepEqual(JSON.parse(memory.get(DICTIONARY_CORRECTION_STORAGE_KEY)), {});
  delete globalThis.window;

  // —— 4. 真实读取、渲染与保存合并均保留完整补丁 ——

  const mergedManagedPatch = mergeDictionaryPhoneticCorrection(
    resolveDictionaryCorrection('note', { user: managedUser })?.patch,
    '/new/',
    '/original/',
  );
  assert.deepEqual(mergedManagedPatch, {
    meaning: '旧释义',
    phonetic: '/new/',
    word: 'Notte',
  });

  const managedMarkup = renderToStaticMarkup(
    createElement(DictionaryContent, {
      corrections: { onChange: () => undefined, user: managedUser },
      getDetail: () => ({
        phonetic: '/original/',
        sources: [
          {
            id: 'dictionary',
            label: '词典',
            meanings: [{ definition: '原释义', id: 'meaning' }],
          },
        ],
        word: 'note',
      }),
      keyword: 'note',
    }),
  );
  const managedText = managedMarkup.replace(/\u2060/gu, '');
  assert.match(managedText, />Notte</u, '应渲染真实键 Note 下的纠正词头');
  assert.match(managedText, /旧释义/u, '应渲染真实键 Note 下的纠正释义');
  assert.match(managedText, /英：\/nəʊt\//u, '应渲染真实键 Note 下的纠正音标');
  assert.match(managedText, /当前单词已纠错/u, '应提供该用户补丁的详情与删除入口');

  // 保存改回原音标：只删 phonetic，保留 word/meaning。

  assert.deepEqual(
    mergeDictionaryPhoneticCorrection(
      { meaning: '自定义释义', phonetic: '/old/', word: 'notte' },
      '/original/',
      '/original/',
    ),
    { meaning: '自定义释义', word: 'notte' },
  );
  assert.equal(mergeDictionaryPhoneticCorrection(undefined, '/original/', '/original/'), null);

  // —— 5. Dialog 与 Content 的兼容接线合同（源码级补充断言） ——

  const dialogSource = readFileSync(
    new URL('../src/DictionaryCorrectionDialog.tsx', import.meta.url),
    'utf8',
  );
  const contentSource = readFileSync(
    new URL('../src/DictionaryContentCorrection.tsx', import.meta.url),
    'utf8',
  );

  // 新调用方可传独立 onReset；旧调用方仍可只实现 onSave(string | null)。
  assert.match(dialogSource, /readonly onReset\?: \(\(\) => void\) \| undefined;/u);
  assert.match(dialogSource, /readonly onSave: \(phoneticPatch: string \| null\) => void;/u);

  // reset 优先整条删除；旧调用方未传 onReset 时保持 onSave(null) 回退。
  const resetBody = dialogSource.match(/const reset = \(\): void => \{[\s\S]*?\n {2}\};/u);
  assert.ok(resetBody, '未找到 Dialog 的 reset 实现');
  assert.match(resetBody[0], /if \(onReset !== undefined\) onReset\(\);/u);
  assert.match(resetBody[0], /else onSave\(null\);/u);
  assert.match(resetBody[0], /onClose\(\);/u);

  // 保存回原音标维持旧 onSave(null) 语义。
  const saveBody = dialogSource.match(/const save = \(\): void => \{[\s\S]*?\n {2}\};/u);
  assert.ok(saveBody, '未找到 Dialog 的 save 实现');
  assert.match(saveBody[0], /onSave\(trimmed === originalPhonetic \? null : trimmed\);/u);

  // 「清除此词纠错」按钮必须绑定 reset。
  assert.match(
    dialogSource,
    /<Button ghost onClick=\{reset\} type="button">\s*清除此词纠错\s*<\/Button>/u,
  );

  // Content 清除接线：onReset 整条删除该词补丁，不走音标合并。
  assert.match(
    contentSource,
    /onReset=\{\(\) => \{[\s\S]*?store\.reset\(activeKeyword\);[\s\S]*?\}\}/u,
  );

  // Content 保存接线：音标补丁仍交给 mergeDictionaryPhoneticCorrection 合并。
  assert.match(
    contentSource,
    /mergeDictionaryPhoneticCorrection\(\s*existingUserPatch,\s*phoneticPatch \?\? originalPhonetic,\s*originalPhonetic,?\s*\)/u,
  );
} finally {
  await server.close();
}

console.log('test_dictionary_correction_controls: 全部断言通过');
