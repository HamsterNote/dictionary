# 实施验证记录

验证环境：Node 24.15.0、Python 3.14.4、Chrome for Testing 150.0.7871.115（Linux，无头 Chromium）。

## 通过

- `python3 scripts/generate_pronunciation_audio.py --check --max-requests 0`：3 个真实映射与 20 词报告可从原始响应缓存复现，失败不覆盖 manifest。
- `yarn test:pronunciation-audio`：纯数据、范围匹配、overlay 选择、browser 异步生命周期、缓存及采集器 9 组测试通过，包含 Node/Vite 真实查询桥。
- `yarn test:pronunciation-audio-ui`：真实 Chromium 中通过内部切词、IPA/词头/释义纠错、旧回调、双 prop、键盘、状态、错误焦点和离线归因测试。
- `python3 scripts/test_pronunciation_audio_real.py`：`hello`、`cat`、`dog` 的真实 Commons MP3 均完成 HTTP 200、浏览器解码、`playing`/`ended`；`hello` 同会话断网复播无新请求。
- `yarn build:package`、`yarn build`：类型、库及 demo 构建通过。
- `node scripts/test_pronunciation_audio_package.mjs`：tarball 根入口、纯数据与 browser 子入口导入通过；3 条映射及许可材料存在；根/纯数据依赖闭包无 Audio、Worker 或 Kokoro。
- 本次改动文件的 Prettier 检查、定向 ESLint、`yarn typecheck` 与 `openspec validate add-dictionary-pronunciation-audio --strict` 通过。机器生成 JSON 与原始证据不通过 Prettier 重写。
- `git diff --exit-code -- src/data` 通过，原 ECDICT、音标权威与纠错数据未被声音功能改写。

## 三项审核修复的回归

1. 生成器按列表树保留 IPA 节点、口音与音频的祖先/同口音分支，记录双方行号和口音。新增同段 `/ˈæpəl/` 与 `/ˈapəl/` 不得交叉配对的回归；`apple/book` 已降级，正式映射只保留 `hello/cat/dog`。`--check` 会从原始响应重新关联并拒绝陈旧或矛盾产物。
2. overlay 通过 dictionary 内部 context 上报唯一实际默认读法，携带 entryId、role 和 accent；多读法、未生效读法或身份不一致时禁用。Chromium 验证播放使用 `/overlay/` 而非隐藏旧 IPA，切换 `/overlay-changed/` 会停止旧播放且不再发声。
3. 缓存键包含具体媒体 URL，失败媒体会淘汰。候选循环同时覆盖元数据与 `play()` 启动验证；`NotSupportedError` 等启动解码错误归为 `decode`，而非 network，并继续同一录音的下一表示。手势拒绝与启动超时保持原语义。新增元数据成功但启动失败的 Ogg → MP3 回退、MP3 离线复播、全部失败后的离线拒绝与联网重试回归。

## 基线问题（未由本 change 修改）

Yarn 1 的内置 `yarn check` 仅报告 `Folder in sync`，不会执行 package.json 的同名脚本；因此实际回归使用 `yarn run check`。

修复后的 `yarn run check` 在数据、纠错、发音、browser、Kokoro 和包构建全部通过后，停在全仓 `format:check`：49 个未改动基线文件不符合当前 Prettier。本次新增证据及机器生成 manifest 不计入其中。

`yarn lint` 报告 4 个未改动基线错误：`scripts/project_system_pronunciation_rules.mjs:253`、`scripts/test_system_pronunciation_rules.mjs:16`、`src/systemDictionaryCorrections.ts:76` 和 `:78`。本 change 文件没有 lint 错误。未为通过检查而修改这些无关文件。

## 验证边界

无头 Chromium 的播放事件证明实际网络响应、解码和播放生命周期，不等同于人工听感或 iOS/Android 真机验收。真机与消费端验收由 native 同名 change 记录，不在此虚报通过。

## 发布授权

2026-11-07，修勾在 HAM-186 根线程人工选择 A，并在后续指令中明确授权合并 PR #6、发布 `@hamster-note/dictionary@0.1.1-beta.3`。这是对 tasks 原本“不以本任务自动发布包”限制的人工豁免，不是 agent 自行发布。发布前已确认合并后的 main 为 `02e86ab`，本机 npm 身份为 `wszxdhr`，公共注册表尚无该版本。

实际执行 `npm publish --registry=https://registry.npmjs.org --tag beta` 时，prepack 构建成功，但 npm 以 `EOTP` 要求一次性密码；随后经人工协调完成认证与发布。最终已核实公共 registry 的 `beta` 标签指向 `0.1.1-beta.3`，tarball 可获取。

## beta.4 真实查询契约修复

native 集成发现真实 `getDetail` 会返回带成对 `/` 的 IPA，而 beta.3 sidecar 使用 TSV 裸值，导致 `reading-mismatch`。beta.4 的生成入口通过 `scripts/pronunciation_audio_lookup.mjs` 以 Node/Vite 直接调用真实 `getDetail`，把返回值交给 Python 采集器；Python 不再读取 TSV 或复制斜杠规则。查询接口变化会驱动重新生成和 `--check`，不修改查询接口，也不在 native 去斜杠。

新增回归对正式清单中的 `hello`、`cat`、`dog` 逐条执行真实 `getDetail` → resolver：断言 sidecar IPA 与真实输出完全相等，且三条均返回 available。三条真实 MP3 的 Chromium 播放、离线缓存、共享 UI、采集器、browser、构建和 tarball smoke 均通过。

beta.4 tarball SHA-256 为 `1becf119017b235e257a35f052c5406d79acef7c5e1cd91563e4c0829f27a7fd`。按最新人工指令，本次只提交 provider PR并停在发布前，不执行 npm 发布或触发 OTP。
