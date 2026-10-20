# 1.2 旧查询 / v1 payload / callback 基线

> 任务 1.2 完成证据之一。记录本变更开始前，公共旧查询、旧 `Map` 词包、v1 纠错存储
> 与 callback 合同的**行为基线**及源码 hash，作为后续兼容回归的比对基准。
> source hash 机器可读清单见同目录 `legacy-contract-sha256.tsv`。

## A. 公共旧查询基线（`src/lookupEnglishChinese.ts`）

- 入口：`lookupEnglishChinese(query, vocabularyPacks?, exampleSentencePacks?, synonymPacks?, rootPacks?, inflectionPacks?)`。
- 查询键规范化：`trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ')`。
- 词头直接命中后**不再查反向词形**（先 `findEntry`，未命中才走 inflection index）。
- 返回值（`EnglishChineseLookupResult`）：
  - 找到词条：`{ status:'found', kind:'entry', word, meanings, phonetic?, inflections, examples, synonyms, roots }`；
    `phonetic` 仅在源字段非空时出现，且**外包 `/.../`**（`/${phonetic}/`）。
  - 找到词形：`{ status:'found', kind:'inflection', word, meanings }`，`phonetic?: never`。
  - 未找到：`{ status:'not-found', query }`。
- 释义切分：按 `\u001f`（`MEANING_SEPARATOR`）切分，再按 `^([a-z]+)\.\s*(.+)$` 提取 POS；
  生成展示 ID `${word}-${index}`。

## B. 旧词包 / 详情 JSON 合同基线

- `src/englishChineseVocabularyPack.ts`：`entries: ReadonlyMap<word, readonly [phonetic, translation]>`，
  由 TSV 第 2 行起解析（首个 tab 分 word，第二个 tab 分 phonetic/translation）。**不**含新读法层。
- `src/dictionaryData.ts` `getDetail(word, options?) → DictionaryDataDetail | undefined`：
  - JSON-only：`{ word, phonetic?, sources:[{ id, label, href?, examples?, heading?, meanings:[{ definition:string, id, partOfSpeech?, example? }] }] }`。
  - 中文走 `lookupChinese`，英文走 `lookupEnglishChinese`；`language` 选项可强制。
- `src/englishInflectionPack.ts`：已用**数组**保存；正向 `Map<lemma, EnglishInflection[]>`、
  反向 `Map<form, EnglishInflectionSource[]>`；label 表 `{'3','d','i','p','r','s','t'}`。
- 生成器 `scripts/generate_ecdict_inflections.py` 第 88 行排除 `form == word`，
  因此旧反向包**不能**证明所有同形角色不存在（design 已记录此约束）。

## C. v1 纠错 payload / storage 基线（`src/dictionaryCorrections.ts`）

- 类型：`DictionaryCorrectionPatch = { word?: string; phonetic?: string; meaning?: string }`。
- 表：`DictionaryCorrectionMap = Readonly<Record<string, DictionaryCorrectionPatch>>`（键为原始词头）。
- 存储 key：`DICTIONARY_CORRECTION_STORAGE_KEY = 'hamster-dictionary-corrections/v1'`。
- 持久化：`src/dictionaryCorrectionStore.ts` → `localStorage`，值 `JSON.stringify(map)`；
  `load` 经 `sanitizeDictionaryCorrectionMap`，解析失败返回 `{}`，存储异常**原样抛出**。
- 清洗规则：
  - key 长度 1..300；`word`/`meaning` trim 后非空且 ≤1000；
  - `phonetic` **允许空字符串**（有意义的"人工清空"，区别于字段缺失）；
  - 无有效字段的条目被丢弃；结果对象原型为 `null`（防原型污染）。
- 逐字段优先级：`resolveDictionaryCorrection` = 用户字段 > 系统字段 > 词典原文；
  `fieldOrigins` 逐字段记录来源；`disabled:true` 时完全停用。
- 音标专用合并：`mergeDictionaryPhoneticCorrection(existing, next, original)`：
  改回原值则丢弃 phonetic 字段；清空非空原值保留 `''`；其余字段原样保留；全空返回 `null`（删除）。

## D. callback / 受控模式基线（`src/useDictionaryCorrections.ts`）

- 回调签名：`onChange?: (word: string, patch: DictionaryCorrectionPatch | null) => void`。
- 模式解析 `resolveDictionaryCorrectionsControl`：
  - `disabled:true` → 只应用不编辑；
  - 无 `user` 且无 `onChange` → 非托管（managed=false），走本地 `localStorage`；
  - 托管（提供 `user` 或 `onChange`）且**缺 `onChange`** → `editable:false`，保存时抛错，
    **绝不静默保存**。
- 写入语义：`store.save` 成功后才更新内存缓存；失败不产生假成功。
- SSR：不读 `localStorage`，模块作用域不持有用户数据（`useSyncExternalStore` 服务端快照为空）。

## E. 显示相关（本次仅记录，不修改）

- `src/formatDictionaryPhonetic.ts`：非中文一律 `英：${phonetic}`；design 已指出该"英："不是口音
  provenance，属需关注的显示问题。
- `src/phoneticEditing.ts`：音标文本编辑（grapheme 级）纯函数，与读音/口音无关。

## F. 合同源码 hash 基线（`legacy-contract-sha256.tsv`）

| sha256 | bytes | path |
| --- | --- | --- |
| `7bbf264fc384a8bc3c019175f8aabb2b3f1ef9a188b9e1502bcb2888ac4eef8e` | 9643 | src/lookupEnglishChinese.ts |
| `1e33a8b5891d03a6c404743cdfc1291e7af475e6c68c969d6a2dcf61cc0cbedb` | 10928 | src/dictionaryCorrections.ts |
| `c3d88c990cb218a347610b80e52781cfb4356a25baf570e709c1723420a64385` | 5569 | src/useDictionaryCorrections.ts |
| `407d3c6f09986d3b765367713130e096a9961502f02c8c81c6dedd23abf1b19e` | 1168 | src/dictionaryCorrectionStore.ts |
| `718117e672ab6c8930416dc54436077ac17db67a6071226d5d3f329377e49d14` | 6143 | src/dictionaryCorrectionApply.ts |
| `fc8fd7f496f114fc953658fc22f7bca1f2a4cfc0c6c0d775ec71d9971930cd22` | 1180 | src/englishChineseVocabularyPack.ts |
| `844d43634ce6f71830caf2c04631cfeb2cd040c8b34be5dcc3691b79b3db7697` | 2419 | src/englishInflectionPack.ts |
| `7a6085b6c96cc6159dafe3ba968ff9e3cc9f369407a01d8b820053bbbb87ddd7` | 1050 | src/englishInflectionLookup.ts |
| `4713cb3a1706ce986de62478c1c41b03ccdc30ccd7ed63f0f440adb1a35b480a` | 4639 | src/dictionaryData.ts |
| `bf9daed1dfc224c5cfda1c07e13d9a799e2e68428242cc540e40e08fdd687cc5` | 621 | src/systemDictionaryCorrections.ts |
| `80e3c71dedaec56d77ef63aa73e8f461b275a7a9642ee22a0a50a1507beff203` | 2830 | src/phoneticEditing.ts |
| `6d6f9f68e381397a5db5a2b5768add60fdc18f5607bf02e7c6be7b91db455193` | 157 | src/formatDictionaryPhonetic.ts |
