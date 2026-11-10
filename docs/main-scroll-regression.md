# HAM-200 主窗口长释义滚动审核修复（ham200.5）

共享产品源码 `fd481e98f217ca3a202c00e22e6b2346d012579c`；包 `0.1.1-beta.9-ham200.5`，SHA-256 `15398893e5a6f0ec4a80bfc7bbb1640605f46a6d0e604e4ad6c37ca9dd557a3d`。native 固定消费同一产物，没有增加宿主滚动补丁。此前 `.3`/`.4` 数据保留为历史采样，本轮数据见 `main-scroll-evidence/before.json`、`after.json`、`metadata.json`；完整截图与日志随 HAM-200 的 `HAM-200-main-scroll-evidence.zip` 交付。

## 根因与修复

`DictionarySearchContent` 的包装 div 即使用 `display: contents`，仍在 DOM 中阻断原主窗口直接子选择器。普通 `.dictionary-content` 的 `overflow: visible` 因而生效，60 条义项从主窗口溢出并撑高文档。

包装层改用明确的 `.dictionary-search-content`，移除 `display: contents`；主窗口下以完整直接子路径连接 flex 列布局，包装层和正文均允许 `min-height: 0` 收缩，搜索/状态槽不收缩，结果区单独 `overflow-y: auto`。独立正文保留自然流布局。不改 HAM-195 队列、候选算法或会话核心。

## 真实容器实测

Linux / Chromium 156.0.8078.4、DPR 1，1440×844 和 390×844；真实 `HamsterDictionary` 容器，60 条义项。每端 6 个用例：默认高度点词关闭/开启，以及开启、无搜索框、自定义 maxHeight=480。开启涵盖 pending→ready；用真实鼠标滚轮滚到第 60 条。

两种宽度结果一致：

| 配置          | 版本 | 主窗高度 | results clientHeight / scrollHeight | 文档高度 | overflow-y |
| ------------- | ---- | -------- | ----------------------------------- | -------- | ---------- |
| 默认开/关     | .4   | 812px    | 2554 / 2554px                       | 2785px   | visible    |
| 默认开/关     | .5   | 812px    | 544 / 2554px                        | 844px    | auto       |
| 480px、无搜索 | .4   | 480px    | 2554 / 2554px                       | 2737px   | visible    |
| 480px、无搜索 | .5   | 480px    | 260 / 2554px                        | 844px    | auto       |

修复后结果区实际高度为 544.40625 / 260.40625px；最终 scrollTop 为 2010 / 2294px。最后一条由不可见变为可见，页面 scrollY 始终 0，主窗、词头、搜索框和拖动条 rect 在内部滚动前后完全相等；pending/ready 结果区 rect 相等。关闭场景 resolverCalls=0，非隐藏下划线代替停解析。内嵌用例实际安装 `.5` 包并加载 memorize-web CSS，通过 iframe 运行；before 使用原 `.4` vendor 对照，未以源码替代安装包。

## 复现与回归

```bash
yarn test:main-scroll-browser
yarn test:definition-layout
yarn test:dictionary-text-browser
yarn test:preview-browser
yarn test:preview-contract
yarn typecheck
yarn build:package
node scripts/check_package_versions.mjs
```

主窗回归脚本为 `scripts/test_main_scroll_browser.mjs`，fixture 为 `scripts/fixtures/main-scroll.tsx`。原 `.4` before 在 native 可用 `DEFINITION_BASELINE_PACKAGE=<解包后的package目录> node scripts/test_main_scroll_browser.mjs before` 复测，解包目录需能解析项目依赖。源码 before 来自修复前工作树；before 模式只验证初始溢出，不声称已执行滚动。

两端原预览合同各 193 条通过（4±1px、8px、全词性/末条可达、翻转和极小空间降级）。「行」亮暗/桌面移动共 12 次每端冷测：最大字符/容器差 0.03125px、CLS 0、换行变化 0；状态/焦点/关闭零新增解析和坐标点击回归通过。native `yarn check` 通过：根 58、memorize-web 158 项单测及格式、lint、类型、WebView 构建。共享仓定向 lint、类型、构建与包版本检查通过，历史全量格式/lint 问题保持原记录。

demo 链路原先假定短词条仍能打开小窗；恢复滚动后该结果区只有 124.984375px，按原合同进入双侧不足 128px 的空间降级。测试现先验证主窗口的可访问提示及无浮层，再切回长词条验证放大、连续点词、竞态、Escape、外部点击与移动视口；未改变定位算法或放宽极小空间门槛。原超时和最终通过日志均保留。

首次共享交互脚本的 Space 后立即采样断言出现 scrollY=6px；独立重跑及完整 `test:definition-layout` 重跑通过，首次日志保留在附件，不将首次运行描述为通过。未重复全量 native Web E2E。iOS/Android 真机 5.3/8.3 仍按 `preview-closeout.md` 的原责任人与发布前条件补验。
