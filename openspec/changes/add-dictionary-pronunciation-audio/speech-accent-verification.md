# 宿主朗读口音契约验收

日期：2026-11-09。本变更只包含 dictionary 的回调类型、共享组件接线、来源规则与测试；不包含 native 的音色选择或调参实现，也不补造词库口音标签。

## 来源与兼容性

`pronounce(word, signal?, options?)` 第三参数为可选 `DictionaryPronounceOptions`：language 可为 en-US/en-GB，languageSource 为 overlay-accent/unknown。当前唯一可用 overlay 默认读法的 `readings[].accent.class` 为 us-unspecified / uk-unspecified 时分别下发 en-US / en-GB。沿用现有解析器对唯一 default 读法、语言 en、身份和阻断状态的校验。无录音 controller 时也能传递口音。

普通 ECDICT 只有单一 phonetic，无地区字段；多读法、未指定地区或普通音标保持未知，不带 language。不根据 r、元音、拼写或 UI “英：”推断地区。native 消费方在未知时约定 en-US，以延续原默认设置；这不是对词条的地区判断。合成不保证复现具体 IPA。

旧一参/二参回调兼容。真人录音优先，仅在无可信录音时调用宿主回调；两者皆无仍禁用并提示暂无读音。

## 验证结果

- 类型检查、改动文件 lint、格式检查、OpenSpec 严格校验与包构建通过。
- `node scripts/test_pronunciation_audio_data.mjs` 验证明确美音、英音、未知的回调元数据，同时回归录音映射。
- `python3 scripts/test_pronunciation_audio_ui.py` 在真实 Chromium 中验证共享组件下发三种口音状态，以及录音优先、旧回调、纠错、停止与来源反馈。口音样本为明确标记的合成测试数据，不作为真实单词的地区证据。
- `node scripts/test_pronunciation_audio_browser.mjs` 与 `node scripts/test_pronunciation_renderer.mjs` 通过。
- 全仓 lint 未通过：未改的 `scripts/project_system_pronunciation_rules.mjs`、`scripts/test_system_pronunciation_rules.mjs` 各一处未使用变量，以及 `src/systemDictionaryCorrections.ts` 两处多余可选链，共 4 项。本 PR 未修改这些文件，不声称全仓检查通过。
- 未实测 iOS/Android 真机或人工听感；宿主设备验收由 native 任务记录。

## 联调包

已构建未发布的 beta.4 联调 tarball，SHA-256：`ddcbca5fe621bfbf8ead73f94dca66daee2c843d30fb78d579afc7618a84d93e`。native 通过包依赖消费本契约；本 PR 不提交本地路径依赖、不执行 npm 发布。
