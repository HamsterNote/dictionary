# 给 dictionary-native 的联调交接

- 包名与拟发布版本：`@hamster-note/dictionary@0.1.1-beta.3`。
- 联调 tarball：`hamster-note-dictionary-0.1.1-beta.3.tgz`。
- SHA-256：`f485dfc63a3b4bdf6e5d61d9cfcbf71879d497c9b899e888c41a2a9681e55bad`。
- 纯数据入口：`@hamster-note/dictionary/pronunciation-audio`。
- 浏览器入口：`createPronunciationBrowserController()`，来自 `@hamster-note/dictionary/pronunciation-audio/browser`。
- 共享组件：向 `DictionaryContent` 传入 `pronunciation={controller}`；每个内容实例一个 controller，卸载时 `dispose()`，停止但保留缓存时使用 `stop()`。

覆盖与许可报告见同目录 `coverage.json`、`raw/` 以及包内 `LICENSES/WIKTIONARY-PRONUNCIATION-AUDIO.md`。真实映射仅 `hello`、`apple`、`book`、`cat`、`dog`；其中前三个已在 Chromium 完成真实 MP3 播放流程。合成 fixture 不计入覆盖。

tarball 只用于本次联调，不得把机器路径提交到 native。注册表已有 `0.1.1-beta.2`，但没有本 change 的新入口；`0.1.1-beta.3` 尚未发布。按任务约束本 change 不自动发布，native 的独立合并必须先由发布负责人提供同摘要的正式兼容包，或明确决定另一套不可变依赖方案。回退版本为 `0.1.1-beta.2`（移除新 prop 后可继续使用旧 `pronounce`）。
