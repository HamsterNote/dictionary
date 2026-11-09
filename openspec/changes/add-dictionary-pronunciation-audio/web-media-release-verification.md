# 浏览器媒体释放回归

2026-11-09，在 HAM-186 原 8096 服务以 Chromium 156.0.8078.4 原始媒体引擎实测。未模拟 Audio、fetch 或媒体事件。

## 问题与修复

hello 真人录音已经出现 playing 和 ended（播放进度约 1.103 秒），随后 releasePlayback 在仍保留 src 的 audio 上调用 load，再撤销 Blob URL，浏览器重新请求失效 URL，产生 ERR_FILE_NOT_FOUND 和媒体 error 4。这个结束后的清理错误与 note 的系统合成失败是独立路径。

现改为 pause 后先 removeAttribute('src')，再 load 清空媒体，最后撤销 URL。该方法在注入的自定义适配器上为可选；没有 DOM 属性操作时只暂停并释放引用，不重新加载旧资源。未修改口音、音源数据、许可或缓存上限。

## 验证

- 共享播放器测试通过，增加结束清理不重载旧 Blob 的断言。
- 改动文件 lint、类型检查和包构建通过；全仓 lint 的既有 4 项错误不在本变更范围。
- 原服务使用新联调包后，真实 Chromium 的 hello 再次产生 playing → ended，随后没有媒体错误；Console errors、page errors 和 failed requests 均为 0。
- 原始事件与请求记录通过 native 仓库的 diagnose-web-speech.mjs 采集，完整 JSON 随 HAM-186 验收附件交付。本地包未发布，不提交机器路径依赖。
- 浏览器运行于 headless 环境，仅确认真实媒体播放事件，未验证人工听感或原生真机。
