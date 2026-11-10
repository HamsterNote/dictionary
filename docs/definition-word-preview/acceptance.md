# HAM-200 实测记录

修复包 `0.1.1-beta.9-ham200.2`；产品源码提交 `72a8fbbf47330a7b707eca2d0cbf5dffb506e34a`。beta.8 基线提交 `cb7cbc6aa328abdf843089bfa11e2fa9b7089251`。完整原始证据随 issue 评论附件交付；本目录 before.json / after.json 保存逐次摘要。

Chromium 156.0.8078.4 / Linux，DPR 1；1440×900 与 390×844、亮/暗主题，各 3 次冷会话。使用已提交中文快照「行」的全部释义，另加混排/标点样本，真实 createDictionaryProvider（汉字+词语包）；仅在 resolver 外部 hold/release 控制时序，未替换查询返回值。截图后等待 600ms 再开始观测，避免截图导致的近期输入标记影响 CLS；原始 entries 仍全部保留。

| 视口     | beta.8 标准 CLS      | 修复后标准 CLS | beta.8 最大矩形差 | 修复后最大矩形差 | 修复后换行变化 |
| -------- | -------------------- | -------------- | ----------------- | ---------------- | -------------- |
| 1440×900 | 0.008450445816186557 | 0              | 576.984375px      | 0.03125px        | 0              |
| 390×844  | 0.02926184646945636  | 0              | 262.5px           | 0.03125px        | 0              |

同一视口 6 次结果一致。最大矩形差同时统计正文容器及逐字符 x/y/width/height，不只是段落高度；原始行首尾 offset 和逐帧数据可复核。修复后 layout-shift entries 为空，未用 recent-input 过滤隐藏位移。

状态测试对 pending/error/retry/hover/focus/false/true 逐字符比较，均 ≤0.1px，并比较字体、行高、字重、字距、断行及零盒模型。两视口各 3 个靠近行尾坐标各点击 10 次，前 3 次处于 pending 无动作，release 后只打开对应词；另验证触摸、Enter/Space、Escape、关闭后无鼠标/触摸/键盘激活、焦点移交且不滚动。详见 definition-states.json 与 definition-interactions.json。

关闭冷启动、关闭后新词条的异步 provider 候选调用计数均为 0；同步 resolver 调用计数也为 0。解析中关闭：已有一次 I/O 释放后总调用仍为 1，无后续候选或旧 DOM 回写。开关并非只隐藏装饰。

HAM-195 回归 test:dictionary-text、test:dictionary-text-browser、test:preview-browser 通过；并发峰值 1，idle/timer fallback、可见优先与取消断言通过。benchmark 1 次采样（共享 Linux 主机，非隔离性能结论）：桌面 before/after 最长主线程任务 118.36/70.288ms、首屏就绪 217.30/157.40ms；4× CPU 移动模拟为 873.263/277.249ms、1055.70/418.40ms。完整就绪曲线随附件保留。

`yarn run check` 的所有功能测试通过（含离线资源、中文/词形、纠错身份、录音及 Kokoro）；门禁在历史格式问题处停止：本分支 49 个文件，未修改基线 50 个文件（本次顺便格式化了修改到的资源 manifest）。基线与当前完整 lint 均有同样 4 个历史错误：两个未使用变量和 systemDictionaryCorrections.ts 两处多余 optional chain。未修改这些无关内容。修改文件单独 lint、typecheck、类型与库构建、公开参数/偏好导出、包版本一致性检查通过。

tarball SHA-256：`2ed21a27da1269f32eafe2ef40b12a619f0e7c15609cda45560cb20c9bec8c90`。用同一 dist 重复 npm pack 产生完全相同哈希；native 两个依赖声明与 lockfile 固定到同一 vendor 包，无需 npm 发布权限即可复现。

真实 iOS/Android WebView 未执行：当前运行环境为 Linux，MobileBuildMCP list_sims 返回 xcrun ENOENT，且无 adb/emulator。浏览器移动视口不作为设备验收通过证据。
