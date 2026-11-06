# Proposal

## Why

HAM-186 要求查词结果可播放单词读音。`dictionary` 已有 `pronounce(word)` 按钮接口，但缺少可供轻量 WebView 使用的真人音频映射；现有 Kokoro 方案首次需下载约 92 MB 模型，不能直接满足这个场景。

## What Changes

- 在 `dictionary` 增加独立、版本化的发音音频 sidecar、范围匹配及无 React/DOM 依赖的数据入口；音标、词条身份和音源映射均由本仓库管理。
- 音源结论：首选 Wiktionary 指向的 Wikimedia Commons 真人录音，逐文件校验来源、作者与许可，仅接纳公有领域、CC0、CC BY 3.0/4.0、CC BY-SA 3.0/4.0 且归因完整的文件。公开可播放不等于可再分发，Wiktionary 文本许可也不等于音频许可。理由是来源可追溯、许可可核对，且不必运行大模型；代价是覆盖不全、Commons 无可用性保证及部分地区不可达。
- 默认在线按点击取音频，优先播放同一会话已缓存的 Blob；本期不承诺冷启动离线朗读，不内置全量音频包。无映射显示“暂无读音”；离线未缓存显示“联网后可播放”；下载、解码或播放失败显示可重试错误，始终保留音标和释义。
- 在本仓库增加独立浏览器播放适配器，并扩展共享按钮的加载、播放、不可用和失败反馈；保持旧 `pronounce(word)` 兼容。默认不启用 AI/TTS 降级：现有 Kokoro 保留为可选适配器，不冒充当前 IPA 的精确发音。
- 明确假设：本期播放当前英文词条的单词读音，不逐个朗读 IPA 符号；只为有明确对应证据的读法提供音频，不猜测同形词、口音或用户自定义 IPA 的读音。学习/复习页和中文朗读不在本期。

## Capabilities

### New Capabilities

- `dictionary-pronunciation-audio`：独立音频资源合同、许可与条目/读法范围、按需播放、缓存及共享交互反馈。

### Modified Capabilities

无。`dictionary-entry-identity` 与 `dictionary-pronunciation-overlay` 的 IPA 权威、范围、纠错和发布合同保持原义；本能力只是消费其当前有效结果，不因取音频改变 IPA。

## Impact

涉及拟新增的 `src/pronunciation-audio/`、独立浏览器适配入口、生成/校验脚本与测试、`src/DictionaryContent.tsx`、`src/PronunciationButton.tsx`、包导出及 `THIRD_PARTY_NOTICES.md`。不得手编音频 URL 或把映射塞入 ECDICT TSV/音标权威文件。

配套消费端方案位于 `dictionary-native` 的同名 change `add-dictionary-pronunciation-audio`；两仓各自在自己的 OpenSpec 根内实施。先交付并发布 dictionary 的兼容增量包，再由 native 更新内容 workspace 依赖接入；本次仅产出提案，不发布。与 `publish-pronunciation-corrections` 并行但不代办其 IPA 发布或采集审批。
