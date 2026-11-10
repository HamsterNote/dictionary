# 释义点词调度（HAM-195）

`DictionarySearchContent` 在内部建立阅读会话，通过私有 React context 将实际渲染的释义和例句段落注册到共享调度器。同步 resolver 路径保持原有行为，不创建异步任务。公开 API、中文最长匹配、词形还原、点词摘要、放大、错误重试与焦点恢复的能力契约均未改变。

## 队列与取消

- `dictionaryIdleQueue.ts` 在整个模块实例内串行推进候选：多个主窗口或弹层共享最多 1 个在途解析调用。候选迭代和去重同样在空闲切片中执行。
- 浏览器优先使用 `requestIdleCallback`，100 ms 超时避免持续繁忙时永久饿死；单次切片预算 4 ms，剩余空闲时间不足 1 ms 时让出主线程。无此 API 的 WebView 使用 16 ms 定时切片。
- `IntersectionObserver` 识别视口和滚动容器裁剪；每次候选调度重新读取可见优先级，同级按段落注册顺序。无 observer 时使用实时元素边界作为回退。
- 每段独立完成并开放点词，不等待整篇。会话内缓存命中与未命中结果，避免重复查相同候选。缓存随阅读会话释放，不跨 provider 或重试复用。
- 词条或正文变化、组件卸载、重试均中止旧会话；段落卸载单独中止任务。排队任务立即移除；在途 provider 即使忽略取消，其结果也不能回写或推进旧队列。为保持并发上限，新任务会等待该在途调用退出。
- 资源错误保留正文并显示既有重试入口；重试创建新会话，临时失败不缓存为未命中。小窗摘要继续使用原有 AbortController，与正文解析共用 provider，不增加另一套调度。

4 ms 是候选之间的让出预算，不是单次同步 provider、正则 token 提取或解压的硬上限。本改动不引入 worker，不承诺抢占已经开始的同步代码。

## 验证与性能复测

```bash
corepack yarn@1.22.22 run test:dictionary-text
corepack yarn@1.22.22 run test:dictionary-text-browser
corepack yarn@1.22.22 run test:preview-browser
corepack yarn@1.22.22 run benchmark:dictionary-text after
corepack yarn@1.22.22 run check
```

Yarn 1 的 `yarn check` 是内置依赖检查；完整项目脚本须使用 `yarn run check`。

性能夹具使用 48 个段落、每段 24 个唯一英文候选，共 1152 次查询，每次 provider 消耗 0.35 ms 同步 CPU 后兑现 promise。前后使用完全相同的夹具和样式，前版本为 `791019a57d34bc8e2ce5fcfd4f58c8a4501b5ba8`。该受控压力场景用于隔离批量并发产生的主线程阻塞，不代表真实词典查询的绝对耗时；真实数据语义由固定中文/英文对照和浏览器预览回归验证。

基准记录从点击渲染到全部候选可点的总耗时、首个可见段落可点时间、浏览器 renderer 主线程的最长 RunTask、50 ms 以上 longtask 数量，以及逐帧可点词数量曲线。桌面为 1440×900；移动为 390×844、触摸输入、CPU 4 倍降速的 Chromium 模拟，不能代替 iOS/Android 真机验收。原始结果写入 `artifacts/text-resolution-<label>.json`。

定量结果与环境限制记录于同目录的性能报告。
