# 实施验证记录

验证环境：Node 24.15.0、Python 3.14.4、Chrome for Testing 150.0.7871.115（Linux，无头 Chromium）。

## 通过

- `python3 scripts/generate_pronunciation_audio.py --check`：5 个真实映射与 20 词报告可复现；正式生成器使用原始响应缓存，失败不覆盖 manifest。
- `yarn test:pronunciation-audio`：纯数据、范围匹配、browser 异步生命周期、缓存及采集器 7 组测试通过。
- `yarn test:pronunciation-audio-ui`：真实 Chromium 中通过内部切词、IPA/词头/释义纠错、旧回调、双 prop、键盘、状态、错误焦点和离线归因测试。
- `python3 scripts/test_pronunciation_audio_real.py`：`hello`、`apple`、`book` 的真实 Commons MP3 均完成 HTTP 200、浏览器解码、`playing`/`ended`；`hello` 同会话断网复播无新请求。
- `yarn build:package`、`yarn build`：类型、库及 demo 构建通过。
- `node scripts/test_pronunciation_audio_package.mjs`：tarball 根入口、纯数据与 browser 子入口导入通过；许可材料存在；根/纯数据依赖闭包无 Audio、Worker 或 Kokoro。
- 所有本次改动文件的 Prettier 检查、定向 ESLint、`yarn typecheck` 与 `openspec validate add-dictionary-pronunciation-audio --strict` 通过。
- `git diff --exit-code -- src/data` 通过，原 ECDICT、音标权威与纠错数据未被声音功能改写。

## 基线问题（未由本 change 修改）

Yarn 1 的内置 `yarn check` 仅报告 `Folder in sync`，不会执行 package.json 的同名脚本；因此实际回归使用 `yarn run check`。

`yarn run check` 在上述数据、纠错、发音、browser、Kokoro 和包构建全部通过后，停在全仓 `format:check`：49 个未改动基线文件不符合当前 Prettier。本次新增证据目录不计入其中。

`yarn lint` 最终仍报告 4 个未改动基线错误：`scripts/project_system_pronunciation_rules.mjs:253`、`scripts/test_system_pronunciation_rules.mjs:16`、`src/systemDictionaryCorrections.ts:76` 和 `:78`。本 change 文件没有 lint 错误。未为通过检查而修改这些无关文件。

## 验证边界

无头 Chromium 的播放事件证明实际网络响应、解码和播放生命周期，不等同于人工听感或 iOS/Android 真机验收。真机与消费端验收由 native 同名 change 记录，不在此虚报通过。
