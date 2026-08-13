# @hamster-note/dictionary

仓鼠笔记的 React 19 词典悬浮窗组件，使用 TypeScript 6 与 Vite 8 构建。

## 特性

- 可控的 `open` 状态，便于接入选词、搜索或编辑器交互。
- 可控搜索输入与内置 5,000 词高频英汉核心，可直接展示命中和未命中状态。
- 中考、高考、CET-4、CET-6、考研、IELTS、TOEFL、GRE 与 BNC 作为独立子路径按需加载，并可通过 `vocabularyPacks` prop 注入。
- 搜索框上方提供独立拖动区域，由 `@system-ui-js/multi-drag` 驱动，不干扰输入与文本选择。
- 支持多个释义、词性、例句、音标与来源。
- 内置浅色、深色、键盘焦点与减少动态效果适配。
- 组件源码与 Demo 分离，npm 构建输出到 `dist/`，Pages Demo 输出到 `demo-dist/`。

## 安装

```bash
yarn add @hamster-note/dictionary react react-dom
```

## 使用

```tsx
import { useState } from 'react';
import { EnglishChineseDictionaryPopover } from '@hamster-note/dictionary';
import { ieltsVocabularyPack } from '@hamster-note/dictionary/vocabulary-packs/ielts';
import '@hamster-note/dictionary/style.css';

export function Example() {
  const [query, setQuery] = useState('note');
  return (
    <EnglishChineseDictionaryPopover
      onClose={() => undefined}
      onQueryChange={setQuery}
      open
      query={query}
      vocabularyPacks={[ieltsVocabularyPack]}
    />
  );
}
```

`EnglishChineseDictionaryPopover` 负责查询并把结果传给底层 `DictionaryPopover`。`vocabularyPacks` 接受只读词包数组；不传时只使用内置核心。若需要完全控制释义、来源或远程查询，可继续直接使用纯展示组件 `DictionaryPopover`。

内置的 `lookupEnglishChinese(query, vocabularyPacks?)` 是同步、离线的精确查询。根入口只包含按 `frq` 与 `bnc` 排名选出的 5,000 个高频词。八个考试包使用 ECDICT 上游原生标签；BNC 包则包含 `bnc > 0` 的英国国家语料库排名词，并按排名升序排列。所有可选包仅在显式导入时进入应用，考试包不是考试机构发布的官方词表。词包均剔除核心重复项，但彼此允许重叠；运行时按核心优先和传入顺序命中。

当前构建中，根入口约 `211 kB` gzip；BNC 互补包包含 40,470 词，数据快照约 `1.25 MiB` gzip，独立 JS 入口约 `1.32 MiB` gzip。Demo 显示的“最终大小”是根入口、词包数据和模块开销的保守累加估算，不含 React 与宿主应用代码。

Demo 按用途分为四组：基础学段（中考、高考）、国内英语考试（CET-4、CET-6、考研）、留学考试（IELTS、TOEFL、GRE）和语料词频（BNC）。这些分组只影响选择界面，不改变各子路径的独立发布与加载方式。

按需加载可使用静态 `import()`：

```tsx
const loadGre = () =>
  import('@hamster-note/dictionary/vocabulary-packs/gre').then(
    ({ greVocabularyPack }) => greVocabularyPack,
  );
```

BNC 可按独立子路径加载：`@hamster-note/dictionary/vocabulary-packs/bnc`。它采用 ECDICT 的 BNC 排名字段，不是单独的考试标签词表。

ECDICT 没有 TEM-4/TEM-8 标签，因此本包不把 GRE 或 CET-6 冒充为专八词表。数据来源、授权条件及上游权利风险见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，商用前请先审核。

### 重新生成词表

生成器只接受项目已审核的 ECDICT CSV 快照，并会在读取前校验 SHA-256：

```bash
yarn generate:dictionary /path/to/ECDICT/ecdict.csv
```

脚本固定使用 ECDICT commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`，输出核心、八个 ECDICT 上游原生标签 TSV、BNC 排名 TSV 和类型安全元数据清单。运行环境需要 Python 3.12+ 与 [uv](https://docs.astral.sh/uv/)；生成文件应随源码提交，以便普通安装和构建不依赖网络或 Python。

## 开发命令

| 命令                             | 说明                                        |
| -------------------------------- | ------------------------------------------- |
| `yarn dev`                       | 在 `0.0.0.0:9489` 启动 Demo，支持局域网访问 |
| `yarn build`                     | 构建组件库、类型声明和 Pages Demo           |
| `yarn build:package`             | 清理并构建 npm 发布所需的 `dist/`           |
| `yarn build:lib`                 | 仅构建组件库到 `dist/`                      |
| `yarn build:demo`                | 仅构建 Demo 到 `demo-dist/`                 |
| `yarn generate:dictionary <CSV>` | 校验并重新生成核心及九个可选词汇包          |
| `yarn preview`                   | 在 `0.0.0.0:9489` 预览生产版 Demo           |
| `yarn typecheck`                 | 运行 TypeScript 项目引用检查                |
| `yarn lint`                      | 运行 ESLint，警告也视为失败                 |
| `yarn format`                    | 使用 Prettier 格式化项目                    |
| `yarn run check`                 | 执行格式、Lint、类型与完整构建门禁          |

## GitHub Pages

推送 `main` 分支后，`.github/workflows/deploy-demo.yml` 会构建并发布 Demo：

<https://hamsternote.github.io/dictionary/>

## License

MIT，详见 [LICENSE](./LICENSE)。
