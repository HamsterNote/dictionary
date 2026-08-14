# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-14

### Added

- 初始化 `@hamster-note/dictionary`：React 19 + TypeScript 6 + Vite 8 构建的词典悬浮窗组件库。
- 英汉词典核心：内置 5,000 词高频核心，提供 `EnglishChineseDictionaryPopover`、`ChineseDictionaryPopover`、`HamsterDictionary` 主组件与 `DictionaryPopover` 兼容别名。
- 九个英文词包（中考、高考、CET-4、CET-6、考研、IELTS、TOEFL、GRE、BNC）作为独立子路径按需加载，并支持通过 `vocabularyPacks` prop 注入。
- 四个中文词库（`chinese-xinhua`、`chinese-dictionary` 及各自词语扩展包）作为独立异步块按需加载。
- OANC 英文例句、WordNet 近义词与 UniMorph/MorphyNet 派生基词补充，分别作为独立懒加载子路径。
- ECDICT 词形变化与变形词反向索引懒加载包；反向命中只展示来源关系，不混入释义、例句或近义词。
- 可选 Kokoro 英文朗读，位于独立子路径 `@hamster-note/dictionary/kokoro`，仅在首次朗读时加载模型。
- 可拖拽词典窗口，由 `@system-ui-js/multi-drag` 驱动，不干扰输入与文本选择。
- 行内词悬浮预览 `HamsterDictionaryPopover`，支持 hover/click 触发并展开到主窗口。
- 浅色、深色、键盘焦点与减少动态效果适配。
- Demo 支持按勾选词库去重汇总上游版权、许可与审核提示，并下载为可随产品分发的文本文件。
- 中文候选优化：默认显示 18 条、精确匹配置顶并按字数升序。
- 新增中文候选与英文结果来源的自动化测试。

### Fixed

- 修复受控 `query` 与内部状态的同步问题。
- 修复悬停预览展开时焦点被窃取的问题。
- 修复并发朗读时的音频串扰问题。

### Security

- 词库数据生成器仅接受固定来源的本地快照，并在读取前校验 SHA-256，避免不可信数据进入发布包。
