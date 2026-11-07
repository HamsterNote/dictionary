# 给 dictionary-native 的联调交接

- 包名与待发布版本：`@hamster-note/dictionary@0.1.1-beta.4`。
- 联调 tarball：`hamster-note-dictionary-0.1.1-beta.4.tgz`。
- SHA-256：`1becf119017b235e257a35f052c5406d79acef7c5e1cd91563e4c0829f27a7fd`。
- 纯数据入口：`@hamster-note/dictionary/pronunciation-audio`。
- 浏览器入口：`createPronunciationBrowserController()`，来自 `@hamster-note/dictionary/pronunciation-audio/browser`。
- 共享组件：向 `DictionaryContent` 传入 `pronunciation={controller}`；每个内容实例一个 controller，卸载时 `dispose()`，停止但保留缓存时使用 `stop()`。

覆盖与许可报告见同目录 `coverage.json`、`raw/` 以及包内 `LICENSES/WIKTIONARY-PRONUNCIATION-AUDIO.md`。真实映射仅 `hello`、`cat`、`dog`，sidecar 的 IPA 与真实 `getDetail` 输出（含成对 `/`）逐条一致，三者均已在 Chromium 完成真实 MP3 播放流程。合成 fixture 不计入覆盖。

tarball 只用于联调，不得把机器路径提交到 native。beta.3 已发布但存在真实查询斜杠与 sidecar 不一致的问题，native 不应继续使用；beta.4 是修复该接口契约的候选版本。本任务只提交 beta.4 PR，停在发布前，由人工协调发布。回退到旧 `pronounce` 可使用 beta.2。
