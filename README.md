# @hamster-note/dictionary

仓鼠笔记的 React 19 词典悬浮窗组件，使用 TypeScript 6 与 Vite 8 构建。

> [!IMPORTANT]
> **词库商用与版权声明：**本项目现有词库来源以允许商业使用的开源许可或开放使用声明提供，但不同来源可能要求保留版权与许可文本、署名、相同方式共享或额外审核。请勿将“开源可商用”理解为“无需履行许可义务”或“数据权利零风险”。在 [在线 Demo](https://hamsternote.github.io/dictionary/) 勾选计划使用的词库后，点击页面左侧的 **“下载所选词库版权声明”**，将生成的文件随产品保留；同时请阅读 [完整第三方数据与风险说明](./THIRD_PARTY_NOTICES.md)，并在正式商业发布前按你的使用场景独立审核。本说明不构成法律意见。

## 特性

- 可控的 `open` 状态，便于接入选词、搜索或编辑器交互。
- 可控搜索输入与内置 5,000 词高频英汉核心，可直接展示命中和未命中状态。
- 中考、高考、CET-4、CET-6、考研、IELTS、TOEFL、GRE 与 BNC 作为独立子路径按需加载，并可通过 `vocabularyPacks` prop 注入。
- 可按需启用覆盖高频核心及九个英文词包的 OANC 例句、WordNet 近义词与 UniMorph/MorphyNet 派生基词补充；例句每个命中词最多显示 2 条。
- ECDICT 词形变化与变形词反向索引分别作为独立懒加载包；反向命中只显示“是 xx 的进行时”等来源关系，不混入释义、例句或近义词。
- `chinese-xinhua`、`chinese-dictionary` 及其两个词语扩展包各自使用独立子路径，只有显式导入后才会加载数据。
- 搜索框上方提供独立拖动区域，由 `@system-ui-js/multi-drag` 驱动，不干扰输入与文本选择。
- 支持多个释义、词性、例句、音标与来源。
- 可选接入 Kokoro 英文朗读；未传朗读回调时不显示图标，模型仅在首次朗读时加载。
- 内置浅色、深色、键盘焦点与减少动态效果适配。
- 组件源码与 Demo 分离，npm 构建输出到 `dist/`，Pages Demo 输出到 `demo-dist/`。
- Demo 可按当前勾选词库去重汇总上游版权、许可与审核提示，并下载为可随产品分发的文本文件。

## 下载所选词库版权声明

1. 打开 [在线 Demo](https://hamsternote.github.io/dictionary/)。
2. 在“可选词库”中勾选你的产品会启用的中文词典、英文词包、例句或近义词补充；内置的 ECDICT 5,000 词核心会自动计入，无需另选。
3. 等待所选资源加载完成后，点击“下载所选词库版权声明”。生成文件会先列出当前启用资源，再按实际数据源去重拼接声明；英文词包复用一份 ECDICT 声明，例句与近义词补充分别加入 OANC 与 WordNet 声明。
4. 审核下载内容及 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，按适用协议将版权、许可和署名信息随你的产品保留。若改变勾选项，请重新下载。

下载文件只覆盖 Demo 中的**词库数据源**。如果你的产品还启用 Kokoro 朗读或分发其他运行依赖，请同时处理 `THIRD_PARTY_NOTICES.md` 中对应的软件、模型及依赖声明。部分上游仓库虽然采用开放许可，但数据可能整合自授权链不完整的外部来源；正式商业发布前仍应根据产品、地区和分发方式完成独立法务与内容审核。

## 安装

```bash
yarn add @hamster-note/dictionary react react-dom
```

## 使用

```tsx
import { useState } from 'react';
import { EnglishChineseDictionaryPopover } from '@hamster-note/dictionary';
import { ieltsExampleSentencePack } from '@hamster-note/dictionary/example-sentence-packs/ielts';
import { ieltsRootPack } from '@hamster-note/dictionary/root-packs/ielts';
import { ieltsSynonymPack } from '@hamster-note/dictionary/synonym-packs/ielts';
import { ieltsVocabularyPack } from '@hamster-note/dictionary/vocabulary-packs/ielts';
import '@hamster-note/dictionary/style.css';

export function Example() {
  const [query, setQuery] = useState('note');
  return (
    <EnglishChineseDictionaryPopover
      exampleSentencePacks={[ieltsExampleSentencePack]}
      onClose={() => undefined}
      onQueryChange={setQuery}
      open
      query={query}
      rootPacks={[ieltsRootPack]}
      synonymPacks={[ieltsSynonymPack]}
      vocabularyPacks={[ieltsVocabularyPack]}
    />
  );
}
```

`EnglishChineseDictionaryPopover` 负责查询并把结果传给底层主组件 `HamsterDictionary`（`DictionaryPopover` 是它的向后兼容别名，功能完全一致）。`vocabularyPacks` 接受只读词包数组；不传时只使用内置核心。`exampleSentencePacks`、`synonymPacks`、`rootPacks`、`inflectionFormsPacks` 与 `inflectionIndexPacks` 分别注入例句、近义词、派生基词、词形变化和反向索引，不传时对应数据不会进入应用。这里的“派生基词”是 MorphyNet 记录的构词关系，不是历史语言学意义上的词源学词根。若需要完全控制释义、来源或远程查询，可继续直接使用纯展示组件 `HamsterDictionary`。

主组件 `HamsterDictionary` 额外支持以下 props：

- `position` / `defaultPosition`：主窗位置支持受控与非受控两种模式。传入 `position` 时位置完全由外部控制，并通过 `onPositionChange` 回传拖动后的坐标；不传 `position` 而只传 `defaultPosition` 时，内部自行管理位置。
- `maxWidth` / `maxHeight`：限制主窗的最大宽度与高度（单位 px）。
- `style`：透传到主窗的 CSS 内联样式。

### 行内词悬浮预览

`HamsterDictionaryPopover` 是套在文字外面的 Popover：把任意文字包进组件后，悬停或点击即可预览该词条，点击展开按钮（或悬停模式下直接点击文字）会打开主窗口查询完整释义：

```tsx
import { HamsterDictionaryPopover } from '@hamster-note/dictionary';

<HamsterDictionaryPopover
  entry={entry} // DictionaryEntrySummary，例如 resolveEntry('durable')
  onExpand={(word) => navigation.search(word)} // 打开主窗口
  trigger="hover" // 或 "click"；悬停模式下点击文字也会打开主窗口
>
  durable
</HamsterDictionaryPopover>;
```

`HamsterDictionaryPopover` 的 props：`children`（被包裹的文字）、`entry`（要预览的词条）、`onExpand`（打开主窗口的回调）、`trigger`（`'hover'` | `'click'`，默认 `'hover'`）、`showExpandButton`（是否显示预览内的展开按钮，默认 `true`）、`corrections`（词条纠错配置，见下节）。

### 词条纠错

词条旁的主题色“纠错”按钮会打开一个模态对话框。**本期界面仅支持纠正音标**：音标字段禁用系统软键盘（`readOnly` + `inputMode="none"`），打开时焦点直接落在音标输入框，输入完全通过对话框底部的分组 IPA 键盘完成。键盘覆盖完整 IPA 清单——单元音、双元音、清浊辅音、鼻音、近音与流音、重音与长度符号（ˈ ˌ ː ˑ）、声调与变音符（如 ̃ ̥ ʰ ˤ），并附带带声调拼音字母；支持 ← → 移动光标与 ⌫ 按字素删除，键盘操作不会让焦点或光标离开输入框。对话框具备焦点陷阱、Escape 关闭与焦点还原，保存失败会显示真实错误而不是假成功。

纠错以 JSON 补丁保存，键为**原始词头字符串**，字段均为可选：

```json
{
  "note": { "word": "notte", "phonetic": "/nəʊt/", "meaning": "自定义释义" }
}
```

展示时逐字段应用 **用户补丁 > 系统补丁 > 词典原文**（字段级合并：用户只改音标时，其余字段仍可来自系统补丁）；查找、搜索候选、导航历史与来源命中始终使用原始词头，纠错拼写只影响显示。保存音标修改会与既有用户补丁合并，保留已存储的 `word`/`meaning` 字段。音标被纠错的词条在音标后显示可点击的“已纠错”，其余字段被纠错时在来源分组上方显示“当前单词已纠错”，点击后打开模态弹窗，逐字段列出原始值与纠错内容及其来源（我的纠错 / 系统纠错）。纠错覆盖主窗词头、音标与首条释义、搜索候选、行内迷你预览与 `HamsterDictionaryPopover`，包括宿主通过 `meanings`/`sources` 提供的自定义数据。

持久化与宿主集成：

- **默认（非受控）**：不传 `corrections` 时，补丁写入当前浏览器 profile 的 `localStorage`（键 `hamster-dictionary-corrections/v1`），同一页面的多个词典实例实时同步；SSR 渲染不读取任何用户状态。组件没有账号或跨设备同步体系；`localStorage` 的作用域是当前设备与浏览器 profile。若需要按用户、按设备或跨设备隔离/共享，请用下面的托管模式自行控制作用域。
- **宿主托管**：传入 `corrections={{ user, system, onChange, disabled }}` 完全接管数据。`user`/`system` 为上述 JSON 形状（键可先用 `normalizeDictionaryCorrectionKey` 规范化，拉丁词头按 `en-US` 小写、中文不大小写折叠）；`onChange(originalWord, patch | null)` 在保存或清除时回调，抛错即视为失败；`disabled: true` 停用纠错入口并暂停所有补丁。
- **系统补丁**：包内导出 `SYSTEM_DICTIONARY_CORRECTIONS`，数据本体是随包分发的 `dictionarySystemCorrections.json`。当前收录已核实的勘误（如 `curiosity` 音标）；填写方式见 `src/data/SYSTEM_CORRECTIONS.md`，后续条目须逐条注明来源并评审。
- **自定义存储**：`createDictionaryCorrectionStore(storage)` 可把纠错表落到任意实现 `getItem`/`setItem` 的存储；`createLocalDictionaryCorrectionStore()` 是默认的 localStorage 实现。

```tsx
import { useState } from 'react';
import type { DictionaryCorrectionMap } from '@hamster-note/dictionary';
import { HamsterDictionary } from '@hamster-note/dictionary';

export function ManagedCorrections() {
  const [user, setUser] = useState<DictionaryCorrectionMap>({});
  return (
    <HamsterDictionary
      corrections={{
        user,
        onChange: (word, patch) => {
          setUser((current) => {
            if (patch === null) {
              const { [word]: _removed, ...rest } = current;
              return rest;
            }
            return { ...current, [word]: patch };
          });
        },
      }}
      open
      query="note"
      word="note"
    />
  );
}
```

### 可选 Kokoro 英文朗读

朗读功能默认关闭。只有传入 `pronounce` 回调且当前词条有音标时，音标后才显示朗读按钮。官方 Kokoro 适配器位于独立子入口，不会进入词典根入口：

```tsx
import { useEffect, useRef } from 'react';
import { EnglishChineseDictionaryPopover } from '@hamster-note/dictionary';
import type { KokoroPronouncer } from '@hamster-note/dictionary/kokoro';

export function SpeakingDictionary() {
  const pronouncerRef = useRef<KokoroPronouncer>();

  useEffect(
    () => () => {
      pronouncerRef.current?.dispose();
    },
    [],
  );

  const pronounce = async (word: string) => {
    const pronouncer =
      pronouncerRef.current ??
      (await import('@hamster-note/dictionary/kokoro')).createKokoroPronouncer({ cacheSize: 10 });
    pronouncerRef.current = pronouncer;
    await pronouncer.pronounce(word);
  };

  return <EnglishChineseDictionaryPopover open pronounce={pronounce} query="note" />;
}
```

首次调用 `pronounce` 时才会创建 module Worker；Worker 随后加载 `kokoro-js`，并从 Hugging Face 下载约 92 MB 的 `Kokoro-82M-v1.0-ONNX` q8 英文模型。后续朗读复用同一模型，并默认缓存最近使用的 10 个读音；可通过 `createKokoroPronouncer({ cacheSize })` 调整数量，设为 `0` 可关闭缓存。关闭功能或卸载宿主界面时应调用 `dispose()`，以停止音频、清空读音缓存、终止 Worker 并释放对象 URL。模型下载需要网络，生成过程在浏览器 WASM Worker 中执行。

中文查询使用并行的 `ChineseDictionaryPopover` 与 `dictionaryPacks` 接口。根入口只提供查询逻辑和组件，不静态引入任何中文数据：

```tsx
import { useState } from 'react';
import { ChineseDictionaryPopover } from '@hamster-note/dictionary';
import { chineseDictionaryPack } from '@hamster-note/dictionary/dictionary-packs/chinese-dictionary';
import { chineseDictionaryWordsDictionaryPack } from '@hamster-note/dictionary/dictionary-packs/chinese-dictionary-words';

export function ChineseExample() {
  const [query, setQuery] = useState('学');
  return (
    <ChineseDictionaryPopover
      dictionaryPacks={[chineseDictionaryPack, chineseDictionaryWordsDictionaryPack]}
      onClose={() => undefined}
      onQueryChange={setQuery}
      open
      query={query}
    />
  );
}
```

内置的 `lookupEnglishChinese(query, vocabularyPacks?, exampleSentencePacks?, synonymPacks?, rootPacks?, inflectionPacks?)` 是同步、离线的精确查询。根入口只包含按 `frq` 与 `bnc` 排名选出的 5,000 个高频词。八个考试包使用 ECDICT 上游原生标签；BNC 包则包含 `bnc > 0` 的英国国家语料库排名词，并按排名升序排列。所有可选包仅在显式导入时进入应用，考试包不是考试机构发布的官方词表。词包均剔除核心重复项，但彼此允许重叠；运行时按核心优先和传入顺序命中。

当前构建中，根入口约 `220 kB` gzip；BNC 互补包包含 40,470 词，构建块约 `1.32 MiB` gzip。OANC 例句包覆盖对应词包中实际找到自然句的词头，例如核心包覆盖 4,991 词、约 `399 kB` gzip，BNC 包覆盖 32,440 词、约 `2.89 MiB` gzip。中文资源中，`chinese-dictionary` 包含 3,500 个常用汉字，数据快照约 `384 kB` gzip；其 `chinese-dictionary-words` 扩展包包含 304,196 个去重词头，约 `11.66 MB` gzip。`chinese-xinhua` 包含 45,705 个去重后的汉字与成语词头，约 `5.67 MB` gzip；其 `chinese-xinhua-words` 扩展包包含 264,346 个去重词头，约 `8.80 MB` gzip。四个中文包均为独立异步块，不进入根入口。Demo 显示的是根入口与已启用数据快照的 gzip 估算，不等同于构建后 JS 块大小，也不含 React 与宿主应用代码。

Demo 增加“中文词典”分组，并保留基础学段、国内英语考试、留学考试和语料词频四个英汉分组。“英语例句补充”和“WordNet 近义词补充”各只有一个全局选项；启用后只懒加载核心及当前已选英文词包对应的数据块。受影响英文词包会以蓝字标出补充内容，并把对应 gzip 增量计入该词包显示大小。这些分组只影响选择界面，不改变各子路径的独立发布与加载方式。查询包含汉字时使用已启用的中文词库，否则使用英汉核心与已启用的英语词包。

按需加载可使用静态 `import()`：

```tsx
const loadGre = () =>
  import('@hamster-note/dictionary/vocabulary-packs/gre').then(
    ({ greVocabularyPack }) => greVocabularyPack,
  );
```

BNC 可按独立子路径加载：`@hamster-note/dictionary/vocabulary-packs/bnc`。它采用 ECDICT 的 BNC 排名字段，不是单独的考试标签词表。

例句补充包也使用静态可分析的独立子路径。以下导入只加载高频核心词的例句；其余包将 `core` 替换为 `zk`、`gk`、`cet4`、`cet6`、`ky`、`ielts`、`toefl`、`gre` 或 `bnc`：

```tsx
const loadCoreExamples = () =>
  import('@hamster-note/dictionary/example-sentence-packs/core').then(
    ({ coreExampleSentencePack }) => coreExampleSentencePack,
  );
```

WordNet 近义词也使用相同的十个独立子路径。来源固定为 `https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz`；以下导入只加载高频核心词的近义词：

```tsx
const loadCoreSynonyms = () =>
  import('@hamster-note/dictionary/synonym-packs/core').then(
    ({ coreSynonymPack }) => coreSynonymPack,
  );
```

UniMorph/MorphyNet 派生基词使用相同的十个独立子路径。以下导入只加载高频核心词对应的构词关系，不会把其余数据带入根入口：

```tsx
const loadCoreRoots = () =>
  import('@hamster-note/dictionary/root-packs/core').then(({ coreRootPack }) => coreRootPack);
```

ECDICT 词形变化与反向查询使用两个全局子路径，可分别启用：

```tsx
const formsPack = await import('@hamster-note/dictionary/inflection-packs/forms').then(
  ({ ecdictInflectionFormsPack }) => ecdictInflectionFormsPack,
);
const indexPack = await import('@hamster-note/dictionary/inflection-packs/reverse').then(
  ({ ecdictInflectionIndexPack }) => ecdictInflectionIndexPack,
);
```

中文词库也可在用户启用功能时动态加载：

```tsx
const loadXinhua = () =>
  import('@hamster-note/dictionary/dictionary-packs/chinese-xinhua').then(
    ({ chineseXinhuaDictionaryPack }) => chineseXinhuaDictionaryPack,
  );

const loadXinhuaWords = () =>
  import('@hamster-note/dictionary/dictionary-packs/chinese-xinhua-words').then(
    ({ chineseXinhuaWordsDictionaryPack }) => chineseXinhuaWordsDictionaryPack,
  );
```

ECDICT 没有 TEM-4/TEM-8 标签，因此本包不把 GRE 或 CET-6 冒充为专八词表。数据来源、授权条件及上游权利风险见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，商用前请先审核。

### 重新生成词表

生成器只接受项目已审核的 ECDICT CSV 快照，并会在读取前校验 SHA-256：

```bash
yarn generate:dictionary /path/to/ECDICT/ecdict.csv
yarn generate:inflections /path/to/ECDICT/ecdict.csv
yarn test:inflections
```

脚本固定使用 ECDICT commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`，输出核心、八个 ECDICT 上游原生标签 TSV、BNC 排名 TSV 和类型安全元数据清单。运行环境需要 Python 3.12+ 与 [uv](https://docs.astral.sh/uv/)；生成文件应随源码提交，以便普通安装和构建不依赖网络或 Python。

中文生成器同样只接受本地审核快照，并在读取前校验六个 SHA-256。参数依次为 chinese-xinhua 的 `word.json`、`idiom.json`、`ci.json`，以及 chinese-dictionary 的 `char_common_base.json`、`char_common_detail.json`、`word.json`：

```bash
yarn generate:chinese-dictionaries \
  /path/to/chinese-xinhua/data/word.json \
  /path/to/chinese-xinhua/data/idiom.json \
  /path/to/chinese-xinhua/data/ci.json \
  /path/to/chinese-dictionary/character/common/char_common_base.json \
  /path/to/chinese-dictionary/character/common/char_common_detail.json \
  /path/to/chinese-dictionary/word/word.json
```

脚本固定 chinese-xinhua commit `fe6d6c2e8baa82187f4c96bbe042e43f96c05666` 与 chinese-dictionary commit `e804ada333b68afddfdccbe8dcc938a72da157a7`，输出四个紧凑 TSV 和元数据清单。生成过程不联网；上游数据来源和商用风险见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

OANC 例句生成器只接受本地 `OANC_GrAF.zip` 固定快照，并校验 SHA-256。它按 GrAF 句界提取原文，过滤 URL、邮箱、过短或过长内容，再按十个英文词包分别输出；每个词最多保留 2 条稳定排序、完整词形匹配的例句：

```bash
yarn generate:examples /path/to/OANC_GrAF.zip
yarn test:examples
```

固定快照 SHA-256 为 `5a26559a1becba41a527cb674fff4fb9c4fb70b276f60422c4f07a0ef23fd867`。生成过程不联网，原始约 625 MiB ZIP 不进入仓库。

WordNet 近义词生成器只接受从固定来源下载的本地 `wn3.1.dict.tar.gz`，并校验 SHA-256。它解析四类词性的 synset，将同一 synset 中的词形生成为互为近义词关系，再按十个英文词包输出：

```bash
yarn generate:synonyms /path/to/wn3.1.dict.tar.gz
yarn test:synonyms
```

固定来源为 `https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz`，固定快照 SHA-256 为 `3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a`。生成过程不联网，原始约 15.60 MiB 归档不进入 npm 包。

UniMorph 派生基词生成器只接受固定 commit 的本地 `eng.derivations.tsv`，并校验 SHA-256。它解析 MorphyNet 派生关系，再按十个英文词包输出五列 TSV。CityLex 仅可作为本地覆盖率交叉验证词表，不参与产物筛选，也不会把 CityLex 聚合的非商业、GPL 或专有来源数据写入发布包：

```bash
yarn generate:roots /path/to/unimorph/eng.derivations.tsv /path/to/citylex.tsv
yarn test:roots
```

固定 UniMorph commit 为 `66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b`，输入 SHA-256 为 `743fff8ddb3ff26ae413af1fa859806106ffff69628be4cb7ed4d34f677deed2`。派生数据采用 CC BY-SA 3.0，分发时须履行署名、许可证链接、修改说明及相同方式共享义务。

## 开发命令

| 命令                                            | 说明                                         |
| ----------------------------------------------- | -------------------------------------------- |
| `yarn dev`                                      | 在 `0.0.0.0:9489` 启动 Demo，支持局域网访问  |
| `yarn build`                                    | 构建组件库、类型声明和 Pages Demo            |
| `yarn build:package`                            | 清理并构建 npm 发布所需的 `dist/`            |
| `yarn build:lib`                                | 仅构建组件库到 `dist/`                       |
| `yarn build:demo`                               | 仅构建 Demo 到 `demo-dist/`                  |
| `yarn generate:dictionary <CSV>`                | 校验并重新生成核心及九个可选词汇包           |
| `yarn generate:chinese-dictionaries <六个快照>` | 校验并重新生成四个中文词库                   |
| `yarn generate:examples <OANC ZIP>`             | 校验并重新生成十个英文例句补充包             |
| `yarn generate:inflections <ECDICT CSV>`        | 校验并重新生成词形与反向索引懒加载包         |
| `yarn generate:synonyms <WordNet tar.gz>`       | 校验并重新生成十个英文近义词补充包           |
| `yarn generate:roots <UniMorph TSV> [CityLex]`  | 校验并重新生成十个英文派生基词补充包         |
| `yarn test:examples`                            | 运行 OANC 例句生成器夹具测试                 |
| `yarn test:inflections`                         | 运行 ECDICT 词形生成器夹具测试               |
| `yarn test:synonyms`                            | 运行 WordNet 近义词生成器夹具测试            |
| `yarn test:roots`                               | 运行 UniMorph 派生基词生成器夹具测试         |
| `yarn test:dictionary-corrections`              | 运行词条纠错纯逻辑与渲染回归测试             |
| `yarn preview`                                  | 在 `0.0.0.0:9489` 预览生产版 Demo            |
| `yarn typecheck`                                | 运行 TypeScript 项目引用检查                 |
| `yarn lint`                                     | 运行 ESLint，警告也视为失败                  |
| `yarn format`                                   | 使用 Prettier 格式化项目                     |
| `yarn run check`                                | 执行例句审计、格式、Lint、类型与完整构建门禁 |

## GitHub Pages

推送 `main` 分支后，`.github/workflows/deploy-demo.yml` 会构建并发布 Demo：

<https://hamsternote.github.io/dictionary/>

## License

本项目代码采用 MIT，详见 [LICENSE](./LICENSE)。捆绑词典数据的来源、上游许可与尚待确认的权利风险另见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
