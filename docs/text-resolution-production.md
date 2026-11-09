# Production 对照与读取器重复校验（HAM-195 第三轮）

本轮先排除测法噪声，再定位 production 下仍存在的热点。三组对照各运行三次，均不启用 tracing、CPU profiler、React profiler 或截图；通过浏览器 Long Tasks API 和连续 rAF 时间戳记录观察值。

- `dev-untraced`：刷新后的 Web `6265128`、native `63a210e`，官方 beta.7，原 dev 服务。
- `prod-beta7`：同一版代码的生产构建；Web 使用 Vite production，native 使用 production WebView 加 Expo Web production export。
- `prod-fixed`：Web 代码相同，native 使用 `ddc8702` 的读取器接线修复，仍为官方 beta.7 依赖。

三组均在 19502（Web）和 19501（native 浏览器壳）测量。桌面 1440×900、CPU 1×，移动模拟 390×844、触摸、主线程 CPU 4×；Worker 不按主线程 4× 节流。场景为“行”冷打开、滚动到底再回首段、首个点词预览、输入“行走”和热打开。冷打开指四词库初始化完成后的首次查询，不含页面启动或启用全部词库。

## 先区分开发态与生产态

下表为每个操作窗口的最长已观察长任务，列出三次调用的值（ms）。`<50` 表示未观察到达到 50 ms 的任务，不表示任务耗时为零，也不能精确测出阈值以下的最长任务。

| 移动模拟场景  | dev，无 tracing | prod，无 tracing | 本轮接线修复后 prod，无 tracing |
| ------------- | --------------- | ---------------- | ------------------------------- |
| Web 冷打开    | 175 / 176 / 185 | 55 / 63 / 74     | 60 / 81 / 59                    |
| Web 滚动      | <50 / <50 / <50 | <50 / <50 / <50  | <50 / <50 / <50                 |
| Web 预览      | 104 / 122 / 105 | <50 / <50 / <50  | <50 / <50 / <50                 |
| Web 输入      | 161 / 107 / 100 | <50 / <50 / <50  | <50 / <50 / <50                 |
| Web 热打开    | 116 / 98 / 123  | <50 / <50 / <50  | <50 / <50 / <50                 |
| native 冷打开 | 136 / 125 / 126 | 149 / 128 / 124  | <50 / <50 / <50                 |
| native 滚动   | <50 / <50 / <50 | <50 / <50 / <50  | <50 / <50 / <50                 |
| native 预览   | <50 / <50 / <50 | <50 / <50 / <50  | <50 / <50 / <50                 |
| native 输入   | <50 / <50 / <50 | <50 / <50 / <50  | <50 / <50 / <50                 |
| native 热打开 | <50 / <50 / <50 | <50 / <50 / <50  | <50 / <50 / <50                 |

桌面两组 production 的两个宿主、五个动作、每动作三次均无 ≥50 ms 任务。dev 桌面 Web 冷打开有一次 51 ms，其余桌面动作无 ≥50 ms 任务。

Web 输入的开发态开销明显，生产版本已低于长任务阈值；Web 冷打开仍约 55–81 ms。本轮没有改 Web 渲染代码，不把两次 production 采样的波动声称为优化收益。此前 dev + tracing 下的 584 / 293 ms 等数值应作为诊断数据，不能充当 production 基线或代码回归证据。

## Production 下剩余热点与修复

native 生产版本的冷打开仍有 124–149 ms 任务，不能归因于 React 开发态。完成不挂 tracing 的基线后，另开一次诊断录制：最长相关主线程 microtask checkpoint 为 138.8 ms，约 102.8 ms 的 CPU 自采样落在 SHA-256 的 `process`，相同任务内其余 SHA 辅助函数也占有采样。该值是这段任务内的采样估计，不是整篇累计值或额外的单次基准。

根因是 `apps/memorize-web/src/lib/dictionaryResourceReader.ts` 在主线程校验压缩资源；随后 `OfflineDictionaryResourceStore` 的既有 Worker 又校验相同字节。当前读取器只执行传输长度、资源标识/分块元数据、会话与顺序检查；压缩 SHA-256、解压长度和原始 SHA-256 都由共享 store 在内容对外可用前完成。Worker 不可用时沿用同一校验算法的同步降级。原生宿主的资源允许清单与校验也保留，未新增 native 调度器或 Worker。

这次改变的是应用内部接线，公开组件/provider API、资源格式、预览/放大契约不变，仍使用正式 beta.7，无需发布新共享包。读取器不是独立的可信内容入口，业务始终通过共享 store 读取。

修复后 native 冷打开三次均无 ≥50 ms 任务。连续 rAF 最大间隔仍分别为 66.7 / 100.0 / 66.7 ms（修复前为 150.0 / 133.2 / 133.2 ms）；若干短任务、绘制、浏览器调度和自动化也可能推迟帧，**没有长任务不等于没有掉帧**。Web 修复后冷打开最大帧间隔为 50.0 / 66.8 / 66.7 ms。这里没有证明真机所有动作都“不卡”，仍应以生产环境和真机验收。

## 验证与复现

native `yarn check` 全通过：壳层 53、内容 158 项，以及格式、lint、类型、内容与 WebView 构建。读取器与真实共享 store 的单元集成覆盖同长度篡改、失败缓存恢复和长度拒绝；真实 production 服务上的离线 E2E 桌面/移动 6/6 通过，新增 Worker 拒绝损坏字节、保留查询并恢复重试。WebView HTML 为 9,828,538 bytes。dictionary 本轮只新增测量脚本与报告，变更文件 lint/format 通过，未修改既有 50 个格式问题及 4 个 lint 错误。

生产构建及测量命令：

```bash
# dictionary：在根路径部署 production demo
yarn vite build --config vite.demo.config.ts --base /
# dictionary-native：内嵌内容和外壳均 production
yarn webview:build
yarn expo export --platform web --output-dir ../native-production-beta7
# 分别把两个静态产物目录服务到 19502 / 19501 后，从 dictionary 执行
node scripts/benchmark_dictionary_production.mjs prod-beta7
# 换上接线修复的 native production 产物，其他条件相同
node scripts/benchmark_dictionary_production.mjs prod-fixed
# production 服务上的功能回归，从 dictionary-native 执行
REUSE_PREVIEW=1 WEB_PREVIEW_PORT=19501 yarn test:web e2e/dictionary-offline.spec.ts
```

原始结果：[dev，无 tracing](performance/text-production-dev-untraced.json)、[prod 基线](performance/text-production-prod-beta7.json)、[prod 接线修复后](performance/text-production-prod-fixed.json)。每组包含 60 个操作窗口（两个宿主 × 两种视口 × 三次 × 五动作）、长任务起止和帧间隔；脚本另外保留所请求脚本列表，并拒绝 production 中的 Vite/React-refresh 或 Metro dev 入口。诊断 trace/profile 单独位于 `artifacts/hotspots-prod-native-diagnostic/`，不混入这三组计量数据。

操作窗口包含自动化等待和就绪等待，不是纯计算总耗时；Long Tasks API 阈值为 50 ms，JSON 中最长观察值 `0` 只表示未捕获达到阈值的任务。rAF 记录的是连续回调间隔，不能当作输入到像素的精确延迟。本组是单台共享 Linux 主机的 Chromium 模拟、每场景三次样本，不能推出统计显著性或替代 iOS/Android 真机验收。
