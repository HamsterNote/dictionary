# 释义点词布局与偏好（HAM-200）

公开组件 `DictionaryContent`、`DictionarySearchContent`、`HamsterDictionary` 及中英文包装支持受控布尔 `definitionWordPreviewEnabled`，省略时为 true。宿主在偏好 hydrate 前传 false；关闭会在候选生成之前短路，并取消旧 session、丢弃迟到结果、关闭小窗。主词条查询及释义外独立查词入口不受影响。

共享偏好键为 `hamster-note:dictionary-preferences:v1`，格式为 `{"version":1,"definitionWordPreviewEnabled":false}`。`decodeDictionaryPreferences` 严格验证版本与布尔；缺键/缺字段默认 true，损坏记录抛错且不会自动覆盖。`createDictionaryPreferencesStore` 对损坏记录暂用 true 并保留警告；I/O 读取失败暂停点词，写失败保留选择并标为未保存。宿主可注入同步或异步 `getItem/setItem`，调用 `load` 后订阅。浏览器宿主可在 effect 内创建 `createBrowserDictionaryPreferencesStore`，卸载时 `dispose`；同源页面/实例同步，组件自身不访问浏览器持久化。

渲染先对完整原文应用一次断行保护并映射 UTF-16 offset；查询仍使用原文。可点元素是字体与断行继承、零 margin/padding/border 的 inline span，使用 ARIA button、原文可访问名称及 Enter/Space。跨行小窗锚定点击片段；Escape 恢复焦点。状态区域从首帧起预留 52px，显隐不推动正文。关闭导致入口移除时，焦点移交本实例正文，使用 preventScroll。

HAM-195 的 `dictionaryIdleQueue.ts`、`dictionaryTextCandidates.ts` 和 `dictionaryTextResolutionSession.ts` 未修改；原全局串行、空闲/16ms fallback、4ms 协作片及可见优先均保留。

## 验证与实测

```bash
yarn test:dictionary-text
yarn test:dictionary-text-browser
yarn test:preview-browser
yarn test:definition-layout
yarn typecheck
yarn run check
```

最后一条必须写 `yarn run check`：Yarn 1 的 `yarn check` 是内置依赖完整性命令，不会运行项目 check 脚本。

浏览器脚本使用固定资源快照中「行」的完整释义和混排边界样本，1440×900、390×844，亮/暗主题各 3 个冷会话。hold/release resolver，字体 ready 后按原文 offset（忽略显示层 WORD JOINER）逐 rAF 收集字形、容器及换行 offset；保留包括 recent input 的原始 layout-shift entries，按会话窗口计算标准 CLS。测量脚本对修复后几何差 ≤0.1px、换行一致、CLS=0 设断言。

数据与截图输出 `artifacts/definition-layout-before/`、`artifacts/definition-layout-after/`；状态转换、固定坐标点词记录分别为 `artifacts/definition-states.json`、`artifacts/definition-interactions.json`。原始数据随 HAM-200 评论附件交付；摘要见本目录 acceptance.md。

回测 beta.8 时应在原提交检出中使用相同 fixture/测量脚本，仅替换测试脚本，不替换产品源码。before 与 after 必须来自各自对应的实现；移动 Chromium 模拟不等于设备 WebView。
