# Design

## Context

动机见 proposal.md。基线 `421d6c1` 中，`DictionaryContent` 用 `activeKeyword` 调用可选的 `pronounce(word)`；`PronunciationButton` 仅有 idle/busy/error。`getDetail` 返回 `word/phonetic/sources`，没有音频资源。`src/pronunciation-overlay/` 已有独立 entryId、role、读法引用和来源范围；其正式发布仍有配套 change，不可假定 native 已装有这些新接口。旧音标生成器只抽 IPA，不能据其文本许可直接接纳声音。

## Goals / Non-Goals

**Goals:** 用可版本化 sidecar 将当前有效词条/读法与可分发录音关联，提供轻量消费入口，隔离音频网络失败。

**Non-Goals:** 不修改 IPA 权威、原始 ECDICT 或既有音标发布审批；不为整库建立新身份；不默认使用模型或系统 TTS，不提供永久离线包、后台播放及全库覆盖承诺。

## Decisions

### 仓库与模块边界

| 层                    | 责任与拟落点                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dictionary 数据生成   | 新增 `scripts/generate_pronunciation_audio.*`、原始响应缓存与 fixture，按明确词表获取 Wiktionary 音频关联及 Commons 文件元信息，生成独立 sidecar/覆盖报告             |
| dictionary 纯数据     | 新增 `src/pronunciation-audio/` 与包子入口 `@hamster-note/dictionary/pronunciation-audio`，负责合同、校验、索引、匹配和不可用原因；不得导入 DOM、React、Worker 或模型 |
| dictionary 浏览器适配 | 新增独立子入口 `@hamster-note/dictionary/pronunciation-audio/browser`，负责 fetch/Blob/HTMLAudio、超时、缓存、取消与资源释放；按需导入，不污染根入口或 Metro          |
| dictionary 共享 UI    | 扩展 `DictionaryContent` 与 `PronunciationButton` 消费新 controller；用纠错后的当前有效展示上下文解析，而非原始搜索拼写                                               |
| dictionary-native     | 更新内容 workspace 依赖；创建、传入、停止和释放 controller；不包含 URL 模板、IPA 常量表、口音猜测或许可规则                                                           |

这比在 native 建声音补丁表或仅接入 Kokoro 更能保持数据一致。两仓同名 change 相互配套，但每份 tasks 只修改本仓。

### 映射合同与安全匹配

拟定义 JSON 合同 `pronunciation-audio/1`：manifestVersion、entries、assets、来源与许可记录。asset 包含稳定 assetId、Commons 文件页/文件 revision 与 digest、作者、许可名/链接、原始或转码变更声明、候选 HTTPS 媒体地址/MIME。映射包含 language、原始词头、显式范围（entryId/role/readingRef/accent，如存在）、对应当前 IPA 的指纹及来源关联证据。assetId 不以 IPA 充当词条身份。

匹配输入包含有效展示的 word、language、phonetic、可选身份/读法/口音。输出为 `available`（同一读法的有序媒体候选及归因）或 `unavailable`（not-found、scope-unknown、reading-mismatch、unsupported-language 等）。已有稳定身份时按身份与范围验证；旧单值接口只在有显式核验的唯一兼容映射且 IPA 指纹一致时可用。IPA 相同只是必要校验之一，不单独证明适用范围。`read` 多角色、UK/US、来源仅知拼写、用户改 IPA 后不匹配时拒绝任取第一项。用户只改释义不撤销有效映射，改词头需重新核对。音频失败从不写 IPA 或清除旧值。

新 controller 供共享组件调用，解析接收**已应用用户/系统纠错后的上下文**，暴露 resolve、play、stop、dispose 及状态订阅；`DictionaryContent` 新增可选 `pronunciation` prop，旧 `pronounce(word)` 保持兼容。两者同时传入时新 prop 优先且只渲染一个入口；都未传入时保持原样。不将网络请求塞进同步 `getDetail`。新功能只针对有有效音标的英文条目。

### 音源、采集与许可

选择依据（2026-11-06 已读取官方说明，未进行真实音频采集或设备播放验证）：

- https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia ：媒体逐文件许可，须按许可归因；可外链但官方不推荐依赖 hotlink，且不保证许可信息准确性。
- https://www.mediawiki.org/wiki/API:Imageinfo ：`url/mime/sha1/extmetadata` 可提供文件定位、格式与许可元数据；extmetadata 是 HTML，须清洗并少量按需请求。
- https://commons.wikimedia.org/wiki/File:En-us-hello.ogg ：实例说明有公开真人录音和来源信息；本轮仅验证文件页可访问，尚不能把它视作当前 IPA 已核验的映射或跨平台格式已通过。

不使用按文件名拼接的猜测 URL。后续生成器沿官方按词关联查 Commons，复用可用的本地采集缓存/限速基础设施，不启动全库 dump。串行请求、有标识的 User-Agent、限额与 Retry-After；失败停止本次采集并保留原 manifest。初版冻结 20 词候选集：hello、note、apple、book、world、water、cat、dog、learn、word、dictionary、pronunciation、read、lead、live、record、wind、close、minute、present。逐词记录匹配/许可/格式缺口，至少 3 个独立词条有真实证据且可播放才可交付首版；歧义词允许明确不可用，不用 synthetic 证据补覆盖。此覆盖目标为方案假设，不是用户已确认的整库目标。

接纳公有领域/CC0 或 CC BY / CC BY-SA 3.0/4.0，记录具体许可与作者；许可模糊、非商业限定、无作者或无明确再分发依据时排除。PD 记录声明依据，不套 CC0 名称。Wiktionary 文本关联的归因与音频本身归因分别保留。`THIRD_PARTY_NOTICES.md` 和包内许可材料覆盖随包元数据；共享 UI 的“音频来源”提供可复制来源页、作者、许可与变更说明，不依赖打开外站才能读到基本归因。不得把音频许可扩散为代码许可。

备选：商业有道/Forvo 等端点需另行授权及可用性确认；公开词典 API 不能替代逐文件许可核验；Kokoro 仍可独立使用，但拼写 TTS 不保证匹配同形词 IPA，92 MB 下载与 Worker 也与本期单文件壳不匹配。故默认链路只在同一合格录音的兼容媒体表示之间降级，最终无声，不悄悄换口音或合成读法。

### 在线、缓存与播放生命周期

随包分发小型映射和许可元数据；查词不联网，点击后才向已核验的 HTTPS 媒体地址发请求。v1 直接使用 Commons 已确认的媒体/官方转码地址，清晰接受 hotlink、地区网络及上游限流风险；不在本期新增 CDN/代理服务。无需令牌，第三方只收到音频请求所需信息，不发送学习数据。只允许经过校验的官方媒体 host，验证重定向后的地址；不支持任意字符串 URL 作为 native 指令。

优先选择平台实际支持的格式（`canPlayType` 加真实播放结果），MP3 优先，Ogg 等仅在支持时使用。只能用元数据中实际存在且归因完整的等价转码；没有兼容格式就返回 unsupported-format，不凭原文件名推导 `.mp3`。fetch → 验证大小/MIME → Blob → HTMLAudio；CORS/下载/解码失败不走绕过限制的备用路径。

每个内容实例一个播放器。cache key 包含 manifestVersion、assetId 和文件 digest；内存 LRU 最多 20 项/10 MiB，单文件上限 2 MiB，超限不缓存且按资源错误结束；不写学习存档或依赖系统 HTTP 缓存承诺。已成功缓存的 Blob 可在同一实例断网后复播，重载即不保证。缓存先查；已知离线且未缓存显示提示，否则实际请求结果决定失败，`navigator.onLine` 只是提示。

资源准备总截止时间 10 秒（同读法格式候选共享预算），播放启动等待最多 5 秒；录音接受时长上限 30 秒，播放看门狗为元数据时长加 5 秒、且最多 35 秒，防止 ended 永不到达造成永久忙碌。没有后台自动重试；按钮重试重新由用户发起。新请求替换旧请求，使用请求世代和 AbortController 忽略过期结果；只保留一段正在播放的音频。stop 停止/取消并复位，dispose 额外清缓存、释放对象 URL、移除监听。音频已开始前发生浏览器手势限制时显示“请再次点击播放”，缓存保留供下一次手势使用。

共享 UI 状态为 unavailable / idle / loading / playing / error。无映射禁用按钮并附“暂无读音”；离线缺缓存给“联网后可播放”；其余错误保留可点击重试。加载可显示“正在准备读音”，播放显示“正在播放”，重复点击同条目不排队。按钮具可读名称、键盘操作、aria-busy 与 aria-live；错误不抢焦点。不在音标一改变时自动播放。

## Risks / Trade-offs

- [初版覆盖有限] → 冻结候选词表并随包记录 coverage，明确 unavailable，避免“全库可朗读”的验收口径。
- [Commons 不可达/CORS/限流] → 点击才请求、超时可重试、会话缓存；不影响离线查词，不引入未经授权音源。
- [iOS Ogg 与手势差异] → 元数据中存在的兼容转码、实际设备验收；不支持时如实失败，不以浏览器单测替代原生验证。
- [现有 IPA 发布尚未覆盖消费端] → 优先唯一且已核验的旧接口映射，扩展身份存在时再消费；不得推进其他 change 的发布或回退到拼写猜测。

## Migration Plan

先完成字典数据合同/真实样本与回归，再构建两个独立子入口和兼容 UI，通过 package export/类型/DOM 隔离检查；随后由发布负责人发布新兼容版本，供 native 同名 change 锁定消费。撤销时 native 移除新 prop 或回退包版本，旧 `pronounce` 继续有效；sidecar 可随包回退且不迁移学习数据。本轮不执行这些实施与发布动作。
