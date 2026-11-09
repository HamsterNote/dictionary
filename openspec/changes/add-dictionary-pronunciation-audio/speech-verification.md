# 宿主朗读兜底验证（2026-11-09）

在 `198687b` 基线上追加共享层优先级：可信真人录音匹配时只使用 controller，无匹配录音时调用已注册的 `pronounce`，两者皆无时禁用并显示“暂无读音”。录音网络失败仍保留原错误和手动重试，不自动切换声音。

复用既有回调，导出 `DictionaryPronounce` 类型并增加可选 `AbortSignal`；单参数旧回调保持兼容。共享按钮卸载或有效读法变化时取消请求，忽略过期回调。系统合成按词头发音，不保证复现特定 IPA。

验证结果：

- `yarn typecheck`、`yarn build:package` 通过。
- `yarn test:pronunciation-audio-ui` 通过：真实 Chromium 运行共享组件，验证录音优先不调用回调、无匹配录音调用回调、两者皆无禁用，以及旧回调、纠错、内部切词和来源归因。
- `yarn test:pronunciation-audio` 通过：数据及浏览器 controller 脚本、9 项生成器测试。
- 本次 TypeScript 改动文件的 ESLint 和 Prettier 通过。
- 全仓 `yarn lint` 失败于基线已有的 4 处错误：`scripts/project_system_pronunciation_rules.mjs:253`、`scripts/test_system_pronunciation_rules.mjs:16`、`src/systemDictionaryCorrections.ts:76`、`:78`。已核对 HEAD 中存在相同代码，本次未修改这些文件，也未声称全仓 `yarn check` 通过。
- OpenSpec strict 校验通过。

构建本地联调 tarball（版本字段仍为 `0.1.1-beta.4`，尚未发布）；SHA-256：`f9de514d0bb4de3b01d813d8da3d6b9579bbcb7c32ee078f188160ff549e06f8`。这不是最初的 beta.4 包，消费端发布时须使用实际包含本次变更的发行版本。

native 使用公开包接口注册 expo-speech；没有在 native 复制录音映射、IPA 或许可逻辑。iOS/Android 真机和人工听感不在本次共享层测试范围内。
