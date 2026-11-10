# HAM-200 验收与归档

当前审核修复包已升至 `0.1.1-beta.9-ham200.5`，恢复真实主窗口长释义内部滚动；变更、两端 before/after 数据与复现见 [主窗口滚动回归](main-scroll-regression.md)。以下保留原验收/归档时的版本与结果。

2026-11-10，用户在 HAM-200 确认验收通过，进入代码审核。用户可见变更：小窗以 4px 间距锚定实际命中词，多词性全部释义可内部滚动查看，词头/音标贴左、放大按钮贴右，并可通过「支持解释内点词汇」开关持久化控制点词；关闭时不新增候选解析。

共享包为 `0.1.1-beta.9-ham200.4`，包含已验收的头部对齐修复。产品源码提交 `a191f8e715e64ac0c3a67f1c9c3582f4a207f3b9`；native 使用同一 vendor 包，SHA-256 `5f3d52e341bb6916f65224d7285ef5ace292f795f41b50d57016e1d77414ddf2`。归档只涉及规格和文档，不重新打包或发布 npm。

## 规格与证据

`stabilize-definition-word-preview` 的唯一规划根在 dictionary-native；通过 OpenSpec CLI 内置同步/归档流程更新主规格，归档到该仓 `openspec/changes/archive/2026-11-10-stabilize-definition-word-preview/`，主规格为 `openspec/specs/definition-word-preview/spec.md`。本仓不复制另一份 delta 或改动其他 active change。

- 网页 PR：https://github.com/HamsterNote/dictionary/pull/14
- 内嵌集成、主规格及归档 PR：https://github.com/HamsterNote/dictionary-native/pull/19
- 正文几何、CLS、偏好和追加定位/详情证据：`docs/definition-word-preview/`、`docs/preview-addendum.md`、`docs/preview-addendum-evidence/`。
- HAM-200 评论附件：`HAM-200-evidence.zip`、`HAM-200-preview-addendum-evidence.zip`、`HAM-200-header-alignment-evidence.zip`，保留原始 JSON、截图、包/提交来源与检查日志。

`.3` 的原生完整 Web E2E 为 61 通过、11 项按原条件跳过、0 失败；`.4` 头部修复后，两端各 193 条原预览矩阵、16 组/192 帧对齐检查通过，native `yarn check` 通过（216 项单测及构建）。上述均为已交付历史验证，本次归档不重复宣称新跑功能测试。共享仓原有 49 个格式文件及 4 个历史 lint 错误继续如实保留。

## 本轮归档检查

在 native 规划根执行 `openspec archive stabilize-definition-word-preview --yes --json`，由 CLI 同时完成规格同步和归档，未手动改写主规格或移动 change。`--yes` 执行用户已明确授权的带残余真机风险归档，不将未完成任务改为通过。

`openspec validate --specs --strict --json`：4/4 主规格通过。逐项复核 7 条 delta 要求已完整进入主规格，原有查询身份要求及 Purpose 未变，主规格共 8 条要求；归档的 5 个文件与归档前内容逐字节一致，active change 列表已移除本 change，任务仍为 26/28。本轮变更仅为规格同步、归档和两仓收尾文档，文档执行定向 Prettier 检查及 `git diff --check`。

## iOS/Android 残余风险与补验责任

归档时任务仍为 26/28；5.3 和 8.3 保持未勾选，不把用户的 Web/iframe 验收或 Chromium 移动视口当作真机通过。未覆盖的风险为 WKWebView/Android WebView 的实际字体与断行、视觉视口/键盘/缩放、触摸与焦点、进程重启后的原生偏好持久化，以及设备上的空闲调度和取消性能。

协调责任人为小助手：设备环境可用时安排未参与本次实现的 Mac 操作员进行 iOS 真机验收，并安排具备 Android 真机的测试人员进行 Android WebView 验收；两平台均应在原生正式发布前完成。前提是有可安装的代码审核后候选构建、真实 iOS/Android 设备，以及记录调用计数/性能与屏幕证据的调试环境。构建须核实当前共享包 `.4` 或其经审核的后继版本，记录两仓提交和包哈希。

验收范围沿用归档任务 5.3/8.3 和 design 第 6–8 节：记录设备/OS/WebView 版本、字体、DPR、包版本；验证开关 false 重启持久化和零新增解析，解析中关闭/快速切词/离页/隐藏/迟到结果，候选并发峰值 1、idle/fallback、最长主线程阻塞及就绪曲线；补测逐字符几何 ≤0.1px、换行不变、CLS（不支持时标 N/A）、4±1px gap/8px 边界、边缘翻转/极小空间降级、全部词性及最后义项内部可达、头部对齐与放大身份。

执行人员将逐平台原始数据、截图、调用/性能日志和构建来源回传 HAM-200，由小助手核对范围后记录设备验收结论；两平台证据未齐前不宣称 5.3/8.3 完成。若发现回归，由资深软件工程师跟进修复，再由设备验收人员复测。此残余设备验证不阻塞本轮已通过的 Web/iframe 验收及代码审核。
