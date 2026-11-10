# HAM-200 小窗追加验收

用户已于 2026-11-10 验收通过；OpenSpec 归档、正式 PR 交付及真机残余风险安排见 [收尾记录](preview-closeout.md)。以下保留各轮实际采样版本与验证结果。

当前共享版本 `0.1.1-beta.9-ham200.4`（头部对齐修复见下文）。以下定位/全量释义追加验收采样于 `0.1.1-beta.9-ham200.3`，产品实现提交 `13d2e5948e949db5e3ab5091617699e8f3a1785d`。继续 PR #14；native PR #19 消费同一 vendor 包。原几何/偏好键与 HAM-195 队列及 session 核心未变。

## 根因与实现

原固定 marker 在带 transform 的祖先中，使用 viewport 坐标设置 left/top 后，marker 的 rect 又包含祖先位移，浮层计算重复应用偏移。旧版 fixture 中四种视口/主题组合的边框间距均为 161px。现在在 body portal 中直接定位小窗，不再依赖该 marker；入场只改变透明度，首个可见帧即满足位置合同。

pointer 按 x/y 选择实际可见行片段，键盘重选首个可见行；文档、visualViewport、裁剪祖先及同源宿主 iframe 的可视交集统一到内容 viewport 坐标。4px gap、8px 边距、下放/上翻/较大侧限高采用确定公式；双侧均不足 128px 或安全宽度不足 120px 时不展示浮层，发布可访问提示。监听祖先滚动、尺寸/DOM/视觉视口，并逐帧跟随 transform；锚点隐藏/卸载、文档隐藏则关闭。定位不滚动原页面，Escape 使用 preventScroll 恢复焦点。

用户打开小窗后才取 `provider.getDetail` 或同步 getDetail，独立请求代次与 AbortSignal 丢弃迟到结果；候选仍只取轻量 summary。来源新增可选 kind，内置 definitions 与 inflections/examples/synonyms/roots 明确分开；旧自定义来源未给 kind 时按 definitions 兼容。按词性首次出现排序，同组保留全部原文、顺序、重复和来源，无词性组排最后。纠错沿用详情规则，仅修改相应字段和首义项，不覆盖其他组。长内容由内部正文滚动，header/放大保持可达。

详情加载/失败时摘要明确标注，失败可重试；无有效详情时标「摘要（暂无完整释义）」，摘要也无时显示「暂无释义」。独立 HamsterDictionaryPopover 增加可选 getDetail，并复用同一分组/定位视图；summary-only 宿主保持显式降级。放大始终使用纠错前 originalWord。

## 实测与复现

Chromium 156.0.8078.4 / Linux，DPR 1。1440×900 与 390×844、亮暗主题，中心及四角/加载扩高各三次冷开窗；另测两侧不足、极小宽/高、跨行第二行、键盘首行、非零页面/祖先滚动、200% 实际 pageScaleFactor、视口缩小和锚点隐藏。包含持续逐帧记录，覆盖首个可见帧。

| 项目                                | 修复前             | 修复后              |
| ----------------------------------- | ------------------ | ------------------- |
| 中心词 border gap                   | 161px              | 4px                 |
| 可见帧 gap 范围                     | 未满足合同         | 4px–4px             |
| 最小视口边距                        | 基线仅记录中心样本 | 8px                 |
| 固定详情样本                        | 无详情请求，仅摘要 | 29 条完整义项、4 组 |
| 原「行」正文最大差 / CLS / 换行变化 | 首轮已有基线       | 0.03125px / 0 / 0   |

固定样本含三种非空词性、同组多条、跨来源同组、无词性和空白义项；实际顺序为 v.[A,C]、n.[B,E]、adj.[24条]、未标注[D]。最后一条和放大操作均可访问。另测同步/legacy/无文本/纠错、hover 重入、A 晚于 B、失败重试、关闭开关/隐藏/卸载后的迟到返回。

```bash
yarn test:preview-contract
node scripts/measure_preview_contract.mjs after
yarn test:dictionary-text-browser
yarn test:preview-browser
yarn test:definition-layout
```

`docs/preview-addendum-evidence/` 保存逐次摘要。原始 `artifacts/preview-contract-{before,after}` 中的截图和 frames.json 保存 A/V/S、natural/actual size、B/T、side、gap；正文原始数据在 `artifacts/definition-layout-after`。原始文件与检查日志随 HAM-200 评论附件交付。before 实际受测为原 `.2`，不把当前源码标为 before。

共享功能检查通过；完整 `yarn run check` 仍在 49 个历史格式文件停止；全量 lint 的 4 个历史错误在原基线已复现。变更文件 lint、类型和包构建通过。原有正文、设置持久化、关闭零新增解析、固定坐标点词、空闲串行和取消检查继续通过。

iOS/Android 真机仍未执行：Linux 环境无 xcrun/adb/emulator，移动 Chromium/200%缩放不等价于设备验证。OpenSpec 5.3 与含设备要求的 8.3 保持未勾选。

## 头部对齐修复（ham200.4）

Popover 组件库的 `.hn-popover` 默认 `align-items: center`；垂直布局下头部以内容宽度居中，`justify-content: space-between` 没有可分配空间。不存在隐藏发音按钮占位。小窗现在明确 `align-items: stretch`，头部文字列 `flex: 1; min-width: 0`，长词/音标可换行；放大按钮移除原有 `-8px` 外边距，保持 44×44px 点击区域并对齐内容右边界。不修改锚点与定位计算。

Chromium 156、DPR 1，1440×900 / 390×844、亮暗主题；受控 `it` + 音标 + 两组义项样本，另测长词长音标、无放大按钮、右下边缘上翻。每阶段 16 组、192 个可见帧：

| 指标（相对 16px 内边距后的内容边界） | .3          | .4  |
| ------------------------------------ | ----------- | --- |
| `it` 词头/音标左侧额外空白           | 72.546875px | 0px |
| 头部右侧额外空白                     | 72.546875px | 0px |
| 放大按钮盒子右侧额外空白             | 64.546875px | 0px |
| header 横向溢出                      | 8px         | 0px |
| 所有样本锚点间距                     | 4px         | 4px |

修复后长词、无按钮样本同样两侧对齐，header/body 横向溢出 0px；右下边缘仍上翻，最小视口边距 8px。截图与逐帧 `metrics.json` 随 HAM-200 的 `HAM-200-header-alignment-evidence.zip` 交付；其中测量脚本与 fixture 可复制回 `scripts/` 和 `scripts/fixtures/` 复测（HTML 路径 `artifacts/header-alignment/index.html`）。这组受控样本验证盒模型，未替代之前真实 provider 与真机验收。

验证：`yarn test:preview-contract`（193 条原有浏览器矩阵）、`yarn build:types`、`yarn build:lib`、包/manifest/runtime 版本一致性以及变更文件 Prettier 检查通过。
