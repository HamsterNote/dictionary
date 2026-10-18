# Tasks

第 2–9 组既有离线验收的逐项测试映射、实际命令及退出码见 `evidence/08-offline-acceptance.md`、`evidence/ham37-test-results.json` 与 `evidence/logs/ham37-*`。版本 7085cc4a 已完成 100 词 TOC 试采并触限暂停；10.2–10.4 的历史执行/恢复审计/失败报告见仓库根 `evidence/16-first-round-real-collection.md`。首批 0 MAIN/0 候选不算 IPA 覆盖；5.2 的 hLevel/index 修复与 100 份缓存离线验证现已通过，见仓库根 `evidence/17-real-toc-schema-repair.md`。第二批仅准备新绑定，尚无预算/执行确认。第 11–13 组保持未勾选、未执行。

## 1. 实施授权与不可变基线

2026-10-18 已同意并合入产品经理 Propose 的唯一系统音标权威方向。新增第 13 组及第 11–12 组修订仅作规划，所有新增项保持未勾选；须第 13 组离线能力完成后才进入第 11 组真实发布，第 12 组另需长期预算。7085cc4a 的首次采集已触限，不能借文档合入或修复续跑；第二批使用新冻结版本、隔离路径并另获明确预算/执行确认。此处不授权采集、落库或发布。

- [x] 1.1 开始实施前记录独立实施授权与允许写入范围；当前仅规划授权时所有任务均不可执行，将来 apply 请求也不代替首轮采集、正式发布、长期预算各自授权；完成证据：可核对的用户授权记录与执行边界清单，不将本文件或已完成规划作为执行凭证。（证据：`evidence/00-authorization.md`）
- [x] 1.2 在实施授权内记录 ECDICT TSV、metadata、释义及既有词形/dump 产物 hash，保存旧查询、v1 payload/callback 基线并运行现有 `test:dictionary-data`、`test:dictionary-corrections`、`test:pronunciation-audit`、`test:inflections`、`test:phonetics`；完成证据：基线清单与实际回归日志，不运行原生成器或写入式审计，不改 46,803 词头基线。（证据：`evidence/01-baseline-hashes.md`、`evidence/02-legacy-contract-baseline.md`、`evidence/03-test-run-report.md`、`evidence/logs/`；5 项测试退出码均为 0，运行前后不可变数据 sha256 逐字节一致）

## 2. JSON 合同与持久身份

- [x] 2.1 定义 TypeScript JSON 可序列化合同及 Python 读取合同，分离 observation/evidence、rule、resolved result，并定义 manifest/checkpoint/approval/展示 DTO；完成证据：Node `assert` 与 Python `unittest` 合成数据往返/schema/version 校验，拒绝坏引用、缺许可、把 unknown 当全范围，不引入新框架或后端。（证据：`evidence/04-contracts-identity.md` 小阶段 A、`evidence/05-contract-alignment.md` 及对应日志；19 项合同夹具跨语言结论一致，13 项适配测试与 6 项真实 Node/Python 集成测试通过。无 timestamp 的旧规则保效且待复核，已补身份及规则引用校验。checkpoint DTO 仅审查投影，完整持久恢复仍须按 6.3 单独验收。）
- [x] 2.2 实现 canonical `byId` 的 opaque ID 持久分配、可重建 spellingIndex 与 sourceAliasMap，保留语言/exact spelling 与来源定位证据；完成证据：离线夹具验证重新生成、IPA/POS/拼写更新不重铸 ID，lowercase/NFKC 碰撞不合并身份，锚点变化先核对 alias，不以锚点作永久身份。（证据：`evidence/04-contracts-identity.md` 当前复核、`logs/ham37-identity.log`，Node exit 0。）
- [x] 2.3 建立 `read` base、present、past、past-participle 四个独立稳定 ID 与同一 verb lexeme，提供四角色纠错夹具；完成证据：分别纠错互不覆盖、相同 IPA 不合并，base-only/past-only 不认证 present/participle，明确多角色 applicability 才共享证据；夹具标明 synthetic，不捏造真实来源 IPA，不扩展为全库 grammar。（证据同 2.2；八维共享与 retired 排除回归通过。）
- [x] 2.4 实现审计式 merge redirect 与 split retired/successorIds，重新检查纠错范围；完成证据：Node 夹具覆盖有据合并、唯一 successor 才迁移、一对多 unresolved、历史 ID 可追溯，不自动复制纠错、不借生命周期变更绕过审批。（证据同 2.2；未知第二后继、scope.entry 重映射及交集不放大回归通过。）

## 3. 范围、准入、解析与复核纯函数

- [x] 3.1 实现 known/explicit-all/unknown 及 comparable/disjoint/unresolved 匹配和理由码；完成证据：Node 夹具覆盖语言、entry/lexeme、role、POS、词义、口音及其他条件，未知不是 wildcard、past 不互推 participle，人工只修 IPA 不改变其他字段。（证据：`evidence/06-scope-review.md` 与 `evidence/logs/scope-review-node.log`；主编排核对八维 known/all/unknown、交集非等价、无效范围拒绝和局部比较不冒充完整覆盖，独立运行 Node 测试通过。匹配函数只读 scope，不修改 IPA 或其他字段；逐字段纠错解析仍须按 3.3 独立验收。）
- [x] 3.2 实现版本化标签分类、完整性/notation 准入、默认/补充排序与安全去重；完成证据：Node 夹具覆盖 RP/SSB/GA、未细分 UK/US、无口音单份、地域-only、rare 地域规则、archaic/obsolete、phonemic/phonetic 与 `[]`、损坏/片段、非限制未知标签及未知限定待核验；NFC/实体/边界空白比较保原值，不跨证据/范围/口音去重。
- [x] 3.3 实现同字段同可比范围 user > system > 合格来源 > 旧值解析，保存全部变体、旧值及逐字段 provenance；完成证据：Node 夹具验证新来源无需先判旧错、部分覆盖保其余、失败/缺页/无合格/读法减少不清结果、明确旧错有据退出默认但留历史、旧符号差异不判错、空 phonetic 确认范围后有意 suppression。
- [x] 3.4 实现六个日历月复核与相关语义变化提前提醒，区分创建/核验/导入/批准事件；完成证据：假时钟夹具覆盖 UTC 月末、无 timestamp 保效待复核、不伪造今天、到期不降级、相关 IPA/口音/scope 变化提醒、无关文本不误触，采集/导入/批次批准不刷新核验，撤销/替代须明确确认。

## 4. v1 保护、独立纠错与 opt-in 查询

- [x] 4.1 实现只读 v1 adapter，保留原始 key、word/meaning/phonetic、payload fingerprint 与 unknown scope；完成证据：扩展既有纠错测试验证空 phonetic 为有意清空且不同于缺失、逐字段合并不变、无 timestamp 保持有效，不猜 IPA 归属、不写/删 v1、不复制 patch 给多个 entry。
- [x] 4.2 实现独立 scope resolution 及发布侧逐词保护，绑定当前 patch fingerprint；完成证据：Node 夹具验证旧 phonetic 未归属冻结该词全部新正式 IPA、其他词继续且候选可读，patch 改变使旧 resolution 不适用，只有 word/meaning 不阻来源音标，范围确认不等于批准。
- [x] 4.3 在运行时对当前宿主/本地 v1 执行逐词保护并明确存储读取失败状态；完成证据：假存储/宿主夹具验证全局 sidecar 已发布仍不能覆盖消费者 unresolved 词，读失败不当空表解禁，旧纠错/当前结果保留且候选可读，发布工具不假设能读所有浏览器数据。
- [x] 4.4 提供 entry ID + 明确条件的新纠错 callback/control 与独立版本存储，不复用旧 callback/v1 JSON；完成证据：纠错测试验证无回调不编辑、受控数据归宿主、持久化成功才更新缓存、失败不假成功，读取/展示/升级不写回；实际迁移另获明确操作授权，不自动迁移。
- [x] 4.5 提供 opt-in spelling→entryIds、按 ID 查询、全读法 DTO 与独立 legacy projection；完成证据：扩展 `scripts/test_dictionary_data.mjs` 验证旧 single/JSON 合同、word 导航/历史及宿主 getDetail/phonetic 所有权不变，多 entry 顺序不影响旧值，仅唯一无损映射或明确核验且版本绑定投影可用，仍过来源/审批门槛，`[]` 不套 `/.../`。

## 5. 独立 Python 按词解析与 HTTP 适配

- [x] 5.1 建立 Python 3.12 标准库工具入口，分离 HTTP adapter、HTMLParser 结构提取、离线重解析与候选生成；完成证据：工具帮助/模块边界及离线 unittest，默认不联网、不加载巨型 dump、不依赖 Kaikki/requests/新后端/新框架，旧 dump/inflections 生成器及产物不变。
- [x] 5.2 实现 Action API parse/tocdata 动态选择 English 且 hLevel=2，再获取完整 English 展开文本；完成证据：假 HTTP JSON 夹具覆盖 English 非 index 1、多语言、缺页/缺 English、可选对照不可用，不写死 section=1、不自行展开模板、不使缺页清空正式结果。（真实 schema 修复及版本/语言补闸：严格 hLevel=2、index 定位，TOC 同请求 tocdata|revid，MAIN oldid+index/text|revid 且 revision 必须一致、正文唯一 English h2 根；100 份真实 TOC 离线全部通过、35 词 index/number 不同，零 dispatch；332 项 Python 及 Node 集成退出 0。仓库根 `evidence/17-real-toc-schema-repair.md`、`evidence/18-revision-language-binding.md` 和逐词附件。无真实 MAIN/新采集成功声明。）
- [x] 5.3 实现结构栈提取多个 Etymology/Pronunciation/POS/form 的 IPA、父级 qualifiers、全部原 tags 与路径；完成证据：synthetic HTML unittest 验证多层关联、邻音频不借口音、关联不明保 unresolved、片段留证据、缺失 POS/词义/role 不猜，保留全部观测而非只取首项。（证据：`evidence/05-parser-recovery.md` 与 `evidence/logs/parser-extract.log`，39 项结构测试通过；主编排独立负例复核合法嵌套父标签、内部标签隔离、EOF 残片及未知限制标签变化通过。正式标签准入仍待 3.2，不将完整观测冒充默认合格读法。）
- [x] 5.4 实现串行低速、有效 contact User-Agent 检查、显式间隔/有限重试及退避；完成证据：假 HTTP/假时钟 unittest 验证 429/503 Retry-After、不可用时至少 5 秒指数退避、无并发且重试受预算；真实联网只可在第 10 组独立采集授权后发生，缺 UA 或只有规划/apply 同意时不得请求。

## 6. 流式预算、持久账本与来源证据

- [x] 6.1 实现 streaming body/gzip 解压限额与请求分类计账，分报网络 bytes、解压 bytes、请求数；完成证据：假 streaming response unittest 覆盖 ALL 主/TOC/辅助/错误/重试响应、gzip 高膨胀、读块/输出限额，20 MiB 触限立刻停读/关闭、不解析截断 JSON/HTML，恰好额度但完整性未明时暂停、不额外读取补全。
- [x] 6.2 实现 distinct head 开始前持久占额和逐词状态机，首轮最多开始 100 词；完成证据：Python 夹具验证失败/缺页/no-qualified 计额、同词重试不加 distinct 但响应计费，第 100 词必要请求在 byte 限额内完成或失败后暂停、第 101 词不启动，触限不补辅助/重试、不自动开新 run。
- [x] 6.3 实现 checkpoint/ledger 同批恢复与版本校验，保留名额、bytes、请求、失败/in-flight 及暂停原因；完成证据：崩溃/重启夹具验证 40 词/8 MiB 从原累计恢复、任一触限同批保持暂停、消费不确定 fail closed、不自动退回预扣预算、不因 schema/extractor/rule 升级清零；新增预算/批次须独立明确授权。
- [x] 6.4 保存不可变 page/history/revision、提取时间、提取器/规则版本、HTTP hash 与 IPA+qualifier+applicability fingerprint，支持带来源许可的完整响应缓存离线重解析；完成证据：Python 夹具验证 same revid 展开语义变化可识别、无关文本不冒充 IPA 变化、截断不入成功缓存、历史证据不覆盖，不承诺 oldid 冻结模板或完整历史复现。

## 7. 候选报告、版本批准与原子发布工具

- [x] 7.1 生成所有尝试/受影响词的固定候选与差异报告，默认 JSON+Markdown 作为等价可审查内部格式而非用户选定格式；完成证据：离线报告夹具区分新增/替代/保留/补充/旧错排除/待核验/失败/no change，列同 scope 依据、unknown、人工保留、source/history/license 与当前正式值，不把采集成功当核验/覆盖/发布成功。
- [x] 7.2 实现 candidate 内容 hash、base manifest、identity/source/rule/projection 必要版本与固定纳入/排除名单的 approval 记录及核对入口；完成证据：离线夹具验证仅明确批准有效，用户能核对差异/拟发布内容、excluded/unapproved 不变、scope 不代批准、后批不复用、不提供 autoapprove；真实批准记录只能来自第 11 组明确操作。
- [x] 7.3 实现发布前版本绑定重校验与重 diff 路径；完成证据：离线夹具覆盖 IPA/scope/纠错归属/名单实质变化、版本标识未变仍拒旧批准、baseline 变而 IPA 相同仍重 diff/重批，仅排版/空白且实质输入不变批准仍有效，不把报告展示文件 hash 当候选身份。
- [x] 7.4 完整校验不可变 manifest/资产后原子替换正式 pointer，消费者只读同一 snapshot；完成证据：离线故障夹具证明无半批/半词，坏引用/hash/license/projection 阻发布，unresolved 只阻对应词、blocked/excluded/no change 保旧结果，候选/checkpoint 不进正式入口；测试仅合成隔离目录，真实正式写入须第 11 组独立发布批准。
- [x] 7.5 实现 manifest 回滚与历史保留，不触碰独立运行时人工纠错；完成证据：离线夹具验证切回旧 snapshot 保留全部证据/候选/批准链及新人工纠错，baseline 改后旧待发布批准不复用；真实回滚另获针对目标 manifest 的明确操作授权并留记录，演练不是正式授权。

## 8. 专业 UI lane 与独立许可分发

- [x] 8.1 在实施授权内由主编排安排 designer 评估 DTO 驱动的身份/多读法、纠错范围、核验与归因入口，普通布局/文案由该 lane 决定；完成证据：评估产物逐项对应四角色、default/supplemental/unknown、待复核和 source/history/license 合同，实质规格/架构变更先报告确认，不包含 TTS 或全应用重设计。
- [x] 8.2 按评估实现 opt-in renderer 及限定范围编辑/核验，保原定界 IPA、role 与口音/地域/rare/archaic/obsolete/unknown 标签；完成证据：SSR/受控交互回归与人工展示记录验证未知口音不伪装 UK，新路径不凭旧“英：”断言推口音，旧路径文案按真实未知语义评估调整而不改数据合同，声音只调用原 pronounce(word)，不宣称播放四角色异音/指定 IPA。
- [x] 8.3 提供独立 CC BY-SA 4.0 sidecar LICENSE/notice 与逐项可达归因，接入 `package.json` 现有 dist/THIRD_PARTY_NOTICES.md/LICENSES 白名单及必要导出；完成证据：本地分发清单与构建检查含许可、source/history/license/变更标记，UI/宿主可读而非只在缓存，MIT 工具/应用及原 ECDICT notices 不改许可、候选不误打包，不执行 npm 发布。

## 9. 离线集成、兼容回归与构建证据

- [x] 9.1 接入新 Node `assert` + Vite SSR 与 Python `unittest` 入口，沿用既有依赖且新测试默认零网络；完成证据：新增实际脚本名称/调用与离线日志，synthetic 数据贯通解析→身份/范围→候选→假批准→合成正式 snapshot→宿主保护；假批准仅测试数据，不能进入真实批准入口。
- [x] 9.2 运行已有 `pnpm run test:dictionary-data`、`pnpm run test:dictionary-corrections`、`pnpm run test:pronunciation-audit`、`pnpm run test:inflections`、`pnpm run test:phonetics` 并核对第 1 组 hash；完成证据：实际回归日志与不可变报告，失败如实解释，不改 TSV/metadata/释义、旧生成器规则、审计计数或 dump 基线制造通过。
- [x] 9.3 实施阶段运行已有 `pnpm run typecheck`、`pnpm run build:types`、`pnpm run build:lib`、`pnpm run build:demo` 并检查导出/许可/SSR/改动范围；完成证据：命令日志、分发清单及无 TTS/学习/历史身份误改的审查；用既有子脚本避免顶层 build 的 yarn/clean 链，不扩成包管理器迁移，构建通过不授权联网/发布。

## 10. 独立授权后的真实首轮试采

- [x] 10.1 离线实施与第 9 组证据完成后提交具体首轮词头、真实 UA/contact、调用及落盘范围，取得仅首轮采集的独立明确授权；完成证据：用户确认绑定清单/调用/100 distinct heads 和 20 MiB ALL 解压响应上限，无确认停止此组，不复制规划同意或 apply 请求作为凭证。（最终确认 `01a14e5a-0cd6-7e9e-b259-02e1a80f8fdb`，执行指令 `01a14e5b-0cfa-70d5-9151-e9dea3b9a1f2`；7085cc4a 授权预检 exit 0。证据见仓库根 `evidence/16-first-round-real-collection.md` 与本批 reports/evidence.json。）
- [x] 10.2 仅在 10.1 授权有效时串行低速执行首轮并持久记账，任一限额暂停、不补成功词、不启动第 101 词/新 run；完成证据：真实 checkpoint、逐请求账本、逐词状态及实际网络/解压/request 报告，截断无有效候选、正式 manifest 未写、ECDICT/v1 未改，采集完成不授权发布。（真实 apply exit 2，100 TOC/0 MAIN，224908 network bytes/1688166 decoded bytes；distinct-head-budget 持久暂停，无额外词或补抓。完整账本/缓存见批次附件；解析缺陷不算成功覆盖。）
- [x] 10.3 在原采集授权内演示停止/恢复或审计实际中断状态，不为演示额外联网；完成证据：同批计数不重置、未触限才继续、触限/不确定消费仍暂停的记录；无实际中断则以离线演练加真实 checkpoint 审计说明、不声称真实恢复发生，不自动申请/使用新额度。（无真实中断/恢复；8 项离线测试 exit 0，真实 checkpoint/registry 审计通过，触限后只读 CLI preflight exit 2 且零写入；见仓库根 evidence/16。）
- [x] 10.4 汇总真实首轮所有尝试词的候选/失败/no change/范围不明和来源许可，量测请求、网络、解压成本与观测覆盖；完成证据：固定候选 JSON+Markdown 与真实测量报告，synthetic/真实证据分开、不保证全库准确率/流量/覆盖率，正式结果不变，报告不是批准。（四份 reports 已生成；0 候选/0 no change/100 unresolved-parser-schema，与原始 no-qualified 状态分列；来源/历史/许可逐词列明，源响应与 checkpoint 一字未改。）

## 11. 人工范围确认与逐批正式发布

- [ ] 11.1 提交旧 phonetic（含有意清空）及必要范围不明的逐项对照，只按用户明确确认记录 scope resolution/纠错撤销或替代及可选独立核验事件；完成证据：绑定当前 patch fingerprint 的确认记录，未确认词保护、不批量补时间/复制多 entry，scope 确认后仍未发布，归属变更重生成差异。
- [ ] 11.2 在第 13 组离线能力验收后，提交固定候选、scope/纠错归属、词头及规则纳入/排除名单、系统权威/兼容投影/归因版本、目标内容版本和当前正式 baseline 的最终差异，取得该版本独立明确落库与发布批准；完成证据：修勾或其明确授权审批人的稳定身份、真实确认引用、时间与明确操作、candidate hash/base/全部实质摘要，整批可排除词或角色，无批准停止，规划/采集/范围确认不能替代，排版变化不重复批准。
- [ ] 11.3 仅在 11.2 批准有效时持久落库获准系统纠正、生成兼容 JSON 及 overlay、以相同输入重建并激活完整 release bundle；完成证据：获准源码变更集、规则/投影/归因摘要、构建日志与产物清单、release pointer 前后版本；baseline 或实质输入改变返回 diff/重批，excluded/unapproved/受阻范围/no change 保旧结果，不能仅改 JSON 或 sidecar 就宣称产品生效，不改 TSV/生成快照。
- [ ] 11.4 按首轮固定 100 词逐项核验正式产品及准备完整版本回滚说明；完成证据：每词原值/证据/核验/批准/阻塞/旧接口值/overlay 角色值/实际 release 的验收表，核验/批准/落库/生效词头与规则数分报，归因可达、用户保护和声音保持，阻塞项不计全词完成；给出目标旧 bundle、影响及绑定授权要求，不主动真实回滚。

## 12. 首轮量测后的长期预算与月度轮换

- [ ] 12.1 首轮真实质量/成本验收后提交每批及每月 heads/attempts/ALL 解压字节、时间窗口、单并发、重试、存储与人工复核容量限额，另获明确范围、预算及执行授权；完成证据：首轮合格率/失败率/产品生效率、请求/网络/解压量、核验耗时与去重队列建议，3,786（含 ASCII 2,386）及遗留记法 33,962 分列，不重复计首轮或 ASCII 子集、不承诺一次全库；未批准 scheduled disabled，不沿用首轮预算。
- [ ] 12.2 在 12.1 授权后实现并离线验证获准队列内月度初次核验、覆盖后轮换及重渲染调度，真实启用前核对有效授权；完成证据：假时钟/假 HTTP 验证串行单批、单批与月度取较小剩余额度、same revid 重 render、触限停止且不重置、缺额度默认禁用、只产候选而不自动发布；46,803 仅作库盘点基线，启用不越批准队列。
- [ ] 12.3 仅在有效长期执行授权/预算内运行后续月度候选流程，每批发布分别执行第 11 组版本绑定核验与独立批准；完成证据：该月账本、覆盖/轮换状态、固定差异及各批独立批准/发布或未批准未发布记录，旧批准不复用、实质变化重 diff/重批、触限不扩大、定时任务永不自动发布。

## 13. 系统落库与同源交付增量（须先于第 11 组真实发布）

- [ ] 13.1 在独立实施授权内扩展现有系统 rule 合同及版本引用，规划并实现唯一 `dictionarySystemPronunciationRules.json` 权威维护入口；完成证据：Node/Python 合成夹具验证原词头、target/scope、原值/修正值、证据、核验者时间、状态与批准引用，工作树草稿不能激活，缺真实批准不得写正式。
- [ ] 13.2 保真导入旧三条勘误及历史依据，建立旧 JSON phonetic 的确定性兼容投影，保留 word/meaning；完成证据：旧值/回调/v1/用户优先回归，未知时间/许可/范围不伪造，旧 patch fingerprint 保护生效，read 四角色互不污染；仅唯一无损或明确核验版本投影通过，多条任取 first 和直接手改投影被拒绝。
- [ ] 13.3 使审计 `verifiedErrors` 引用同一权威核验记录，移除新增真值常量维护路径，分离核验/批准/落库/产品生效统计；完成证据：`test:pronunciation-audit` 与只读审计比对同值同范围及状态引用，未批准不生效、启发式不判错，原始 packs/hash 与分桶规则不变，三条历史依据不丢失。
- [ ] 13.4 为旧投影与 overlay 统一提供逐项归因及独立许可分发，更新 `SYSTEM_CORRECTIONS.md` 维护说明；完成证据：包清单、旧视图/宿主与 overlay 均能取得 page/history/许可/变更声明，缺许可或缺引用拒新增正式规则，历史引用不冒充新 CC 许可，原应用/ECDICT notices 保留。
- [ ] 13.5 扩展现有 approval/publication 合同到系统权威版本、词/角色列表、投影/归因、内容版本和 baseline，校验审批者身份与确认引用；完成证据：离线夹具覆盖真确认缺失、伪批准、IPA/scope/名单/基线变化拒旧批准及排版变化保持有效，后批不能复用前批授权。
- [ ] 13.6 实现 staging 派生与同输入产品构建、不可变 release bundle 和完整版本原子激活，接入版本检查；完成证据：扩展 `test_pronunciation_publication.mjs` 与 query 测试证明生成/构建/指针故障、旧构建新 sidecar、资产或归因损坏均不暴露混合结果，旧客户端固定旧完整版本；只在合成隔离目录操作。
- [ ] 13.7 实现完整 release 目标绑定回滚并保留历史；完成证据：合成演练同时恢复旧构建/系统投影/overlay/归因，不删除独立用户纠错或批准证据，目标 hash/授权不符不切换，回滚 baseline 使旧待发布批准失效；本项不授权真实回滚。
- [ ] 13.8 分离采集冻结与正式纠错允许清单，执行落库链离线集成、兼容回归、类型检查和构建；完成证据：`yarn test:dictionary-corrections`、`yarn test:pronunciation-audit`、`yarn test:dictionary-data`、`yarn test:pronunciation-overlay`、`python3 -B scripts/run_pronunciation_python_tests.py`、`yarn typecheck`、`yarn build:types`、`yarn build:lib`、`yarn build:demo` 的实际退出码及打包检查；采集 55/57/19 文件冻结仍有效，发布仅改获准纠错资产且所有 ECDICT/释义/词形/旧 dump hash 不变，旧基线不改；合成证据不冒充首轮真实纠正。
