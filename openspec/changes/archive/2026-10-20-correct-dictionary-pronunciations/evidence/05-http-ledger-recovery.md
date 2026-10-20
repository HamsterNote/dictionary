# HTTP + 持久账本恢复阶段证据（Phase B：问题 3/4/5/7/9 + HTTP 完整性）

本文件是 OpenSpec change `correct-dictionary-pronunciations` 的**有限范围**恢复
证据：在 Phase A（HTTP transport 问题 1/2/6/10）基础上，修 HTTP exact 边界误判，
并实现请求级持久账本协议与账本严格不变量（oracle 问题 3/4/5/7/9）。
**不声称** tasks 5.1–5.4 或 6.1–6.4 整体完成；问题 8（授权记录/CLI 参数严格
校验）与合同终态对齐仍留待后续阶段（见文末）。

## Phase A 修正：exact 触限不再误判 complete

原实现对 gzip 恰好产出 == 额度时因 `decompressor.eof` 误判 `complete=True`。
`decompressor.eof` 只证明**当前 gzip member** 结束，不证明 HTTP body 已 EOF——
后续 chunk 仍可能有下一个 member（concat）。现改为：触限即 `close`/`pause`、
不补读；未读到 reader 返回 `b""`（真 EOF）之前 `complete` 恒为 `False`，
不 parse/cache。主编排复现用例
`BoundedStreamReader().read(BytesIO(gzip.compress(b'abc')).read, remaining=3, gzip_encoded=True)`
现返回 `complete=False` / `truncated=True`（见测试）。

同时补齐 response 协议缺失/计账异常时的 close 保障：`_reader_for` 失败、
`record_response_bytes` 异常、读取异常等所有路径都先 `close(response)`。

## 本轮写入范围

- `scripts/wiktionary_per_word/http_adapter.py`（journal hooks、exact 修正、close 保障）
- `scripts/wiktionary_per_word/ledger.py`（请求级持久协议、resume 门槛、严格不变量、create 拒覆盖）
- `scripts/wiktionary_per_word/collector.py`（journal 接线、ActionApiError 收尾、稳定 report）
- `scripts/wiktionary_per_word/action_api.py`（错误分类：missing/retriable/structural、head 透传）
- `scripts/refresh_wiktionary_pronunciations.py`（**仅** `run_apply` checkpoint load/resume 与必要 `Collector(endpoint=...)`）
- `scripts/test_wiktionary_per_word_http.py` / `..._transport.py` / `..._ledger.py`（既有）/ 新增 `..._persistence.py`
- `evidence/05-http-ledger-recovery.md` + `evidence/logs/http-ledger-*.log`

## 第二轮：state-safety 负例修复（oracle 复测 7 问题，本轮真正落盘）

独立 oracle 复测指出：**既有 77 项全绿不证明安全**。本轮针对 7 个实测问题修复并
新增 `scripts/test_wiktionary_per_word_state_safety.py`（28 项负例 / 正向端到端），
四套目标测试与既有 `_http.py`/`_transport.py`/`_ledger.py`/`_persistence.py` 仍全绿：

| 问题 | 修复 | 新增负例 |
| --- | --- | --- |
| P0-1 预置 QUEUED（started=False）绕 distinct 预算；`finish_word` 凭空造 started 终态 | `start_word` 统一所有 `started=False`（新词 **与** 预置 queued）先做配额检查 + 持久占额；`finish_word` 拒绝不存在/未 started/非 in-flight；不变量新增“终态/ in-flight 必须 started” | 预置队列 N/N+1、未 started 收尾拒绝、终态测试 |
| P0-2 transport “未知消费”仍重试，`request_started` 无条件覆盖 active，最终 EXTRACTED | **更正（第三轮）**：transport 无 response **≠** known-zero——泛化 `TransportError`/`TimeoutError`/`OSError`（含 CLI URLError/timeout）一律 unknown → 立即 `consumption-uncertain` durable 暂停 + 抛、禁止重试；仅显式 `KnownZeroTransportError` 才 known-zero 有限重试；`request_started` 先 `assert_can_request` + 拒覆盖未结算 active；请求单调 `requestSeq` id，`request_accounted` 校验 id/head/kind/operation，不得清别 request | known-zero 重试不标 uncertain、泛化异常只 dispatch 一次、未结算 active 拒 dispatch、id 不匹配拒清 |
| P1-3 `http.client.IncompleteRead` 等非 OSError read 异常漏计 | `BoundedStreamReader` 捕获普通 `Exception`（**不**捕获 BaseException，不吞 KeyboardInterrupt/SystemExit）；已知部分 bytes 计账并持久 uncertain 暂停、不重试；`_close` best-effort，close 抛 OSError 不抢 accounted 并记录 reason | 已知 chunk+partial、gzip 已知 member+partial、close 抛 OSError |
| P1-4 恢复 `run_batch(heads)` 重抓终态 | **更正（第三轮）**：`run_batch` 在 resume 队列中跳过终态词（不重抓/不重计费）；`collect_word` 保留“同词重试不增 distinct”语义（显式重试）；不自动 retry FAILED（spec 未授权不加功能） | run_batch skip、40 heads/8 MiB 经 `run_apply` load/resume/run_batch 端到端只抓第 41 词、41 继续且费用不 reset |
| P1-5 `_decode_json` 只 parse 不校 mapping（`[]`/`null`/`str` → AttributeError 留 in-flight） | 根 / parse / parse.tocdata / sections / text 各层 strict 结构 → `ActionApiError` → collector 持久 FAILED 收尾，不假 MISSING | 非对象根（4 种）、sections 非 list、缺 tocdata、text 非 mapping |
| P1-6 `unsupported-encoding`/`incomplete-response` 仅靠未清 active 重启 fail closed | 两者加入 `BUDGET_PAUSE_REASONS`（durable 暂停，resume 直接拒）；`request_started` 的 `assert_can_request` 在暂停时拒 dispatch；新 adapter 不得覆盖未结算 active | unsupported/incomplete durable 暂停 + resume 拒、新 adapter 拒 dispatch |
| P2-7 HTTP 200 `maxlag` 重试但 budget retry/error 为 0 | **更正（第三轮）**：retry limiter 改为 **logical operation** {batchId,head,wordAttempt,kind}——HTTP(known-zero/429/503) 与 HTTP200 maxlag 共享**同一 operation** 上限；`RunBudget.retry_count` 仅全批累计审计；TOC/MAIN 各自 fetch+decode/APIerror 循环，MAIN 错误绝不重跑 TOC；claim 在 sleep/dispatch 前持久，崩溃/持久失败无免费重试 | generic 只 1 + durable pause、known-zero/302/maxlag/503/两词独立/MAIN-only/claim 持久 no-free |

**未做**（明确剩余，不得据此宣称完成）：

- 仍**未**实现问题 8 的 strict authorization / CLI 参数校验（maxHeads<=100、
  maxDecoded<=20MiB、purpose/approver/time、heads SHA256、official endpoint host/path、
  reserved/local contact 拒绝、interval 正低速强制）。
- 仍**未**实现唯一授权绑定 batch / lease / CAS / headSHA / 跨路径 registry（问题 3 余部）。
- 合同终态机械对齐：**已由父 lane 2.1 验收**（复用父已有证据，非本轮重跑）——
  adapter 13 / cross 6 / Python 19 / Node OK，**0 skip**；本文件不另行声称。
- 未真实联网、未运行 `--apply` 真实采集、未发布/迁移、未启用调度；**未勾选 tasks 5/6**。

本轮写入：`http_adapter.py` / `ledger.py` / `collector.py` / `action_api.py`、
新增 `test_wiktionary_per_word_state_safety.py`、`evidence/logs/state-safety-*.log`、
本文件。CLI `refresh_wiktionary_pronunciations.py` 第二轮未改（`run_apply` 的
load/resume 逻辑本就存在，skip 终态由 collector 幂等实现）。

> 注：第三轮已把“跳过终态”从 `collect_word` 移到 `run_batch`（保留同词重试语义），
> 并修改了 CLI `_build_urllib_transport`（NoRedirect）与 `--apply` NO-GO 守卫；
> 第二轮的“CLI 本轮未改”仅适用于第二轮。

**未写**：`contracts.py`/`contracts.ts`/`identity.ts`/`json.ts`（fix-3）、
`html_extract.py`/`scope_model.py`/`evidence.py`/`offline_reparse.py`（fix-4 活跃）、
`contract_adapter.py`、`tasks.md`、`package.json`、旧数据/旧生成器。未真实联网、
未运行 `--apply`、未建真实 authorization、zero 新依赖。

## 第三轮：known-zero / NoRedirect / logical-operation retry limiter（小阶段 A，仅 2 项终态拒绝）

独立 oracle 复测：既有 105 项全绿仍有两个**终态拒绝**。本轮只修此 2 项 + retry limiter，
新增 `scripts/test_wiktionary_per_word_operation_retry.py`（9 项，含 7 决定性用例）。
**ora2 已 accept 的原 7 中 5 项未重修。**

| 终态拒绝 | 修复 |
| --- | --- |
| P0 transport 无 response 被当作 known-zero 而重试 | 泛化 `TransportError`/`TimeoutError`/`OSError`（含 CLI `URLError`/timeout）一律 **unknown**：保留可证消费、`consumption-uncertain` durable 暂停 + 抛、**禁止重试**；仅显式 `KnownZeroTransportError` 才有限重试。`budget.error_count`/`retry_count` 与 operation 计账一致 |
| P0 CLI `urlopen` 自动 follow 3xx：隐藏 `fp.read`/错误体、多请求、扩 endpoint | `_build_urllib_transport` 改用**私有 opener + `_NoRedirectHandler`**：3xx 作为**单个**响应有界读取/计账后失败，不跟第二 host；MediaWiki `redirects=1`（页面标题重定向）保留 |
| P1 retry limiter：HTTP fetch-local attempts 与 API 全批 `retry_count` 不共享 | 改为 **logical operation** `{batchId,head,wordAttempt,kind}`：`BatchCheckpoint.operations` 持久 `operationId/head/kind/attempt/retries`；`retry_limit` 落盘（resume 不重置）。`claim_retry` 要求 operation-local `< retry_limit`、批次未暂停、字节有剩余，local+batch 同时自增并在 sleep/dispatch **前**持久；持久失败回滚且不得 dispatch。HTTP(known-zero/429/503) 与 HTTP200 maxlag 共享同一 operation 上限；`RunBudget.retry_count` 仅全批审计。`action_api` TOC/MAIN **各自** fetch+decode/APIerror 循环，MAIN 错误绝不重跑 TOC |
| CLI `--apply` NO-GO | strict authorization（caps / config binding / registry / flock / CAS）未实现前，`main` 的 `--apply` **显式拒绝**（exit 2，零网络），不再靠流程约定；内部 fake 测试走 `run_apply` 直连不走真实入口 |

新增 7 决定性用例（`test_wiktionary_per_word_operation_retry.py`）：generic 只 1 + durable
pause；显式 known-zero 可重试且持久；302 单 dispatch + body 计账；maxlag→503 max1 最多
retry1；两词 operation 独立且累计相加；MAIN 只重抓 MAIN；claim 持久失败/崩溃 resume 无
免费重试。另有 transport 层 `WrapperRedirectTest`（真实标准库 opener 用 mock，不可真网）。

**仍 pending（本轮不假装完成）**：strict authorization caps/config binding/registry/flock/
CAS（Phase B，独立实施）；full internal 6.3 的 authorization fingerprint/active/retry/
registry/generation 最终验收；唯一授权绑定 batch / 跨路径 registry。

## 关键实现（问题 → 修复，含崩溃时机）

| 问题 | 修复 | 崩溃时机持久状态 |
| --- | --- | --- |
| 3 create 每次覆盖 checkpoint 清 40heads/8MiB | `BatchLedger.create` **拒绝已存在路径**；CLI `run_apply` 已有 checkpoint 走 `load()`+`resume()`，绝不 create 覆盖 | 旧文件字节不变 |
| 4 load 后 `resumable=False` 但入口不检 | `start_word`/`assert_can_request`/`request_started` 均 `_require_resumable()`；`resume()` 检测 `active_request` 与 IN_FLIGHT，消费不确定则持久暂停 fail closed | 未经 resume 无法请求 |
| 5 请求消费仅内存、中途异常漏记/不 close | `HttpAdapter` journal：dispatch **前** `request_started` 持久 attempt/category/in-flight；完整读取后 `request_accounted` **先持久** network/decoded 再解析/cache；异常保已知 bytes 标 `uncertain` 不重试；持久失败 `JournalError` 且不清 in-flight | 请求前：`activeRequest` 非空；读中：`uncertain=True`+pause；计账后：bytes 已持久；clear 前：`activeRequest` 尚存 → resume 阻断 |
| 7 第 100 词终态不 pause、可再请求 / 第 101 抛异常覆 ledger | `finish_word` 终态且名额用尽立即持久 `distinct-head-budget`；`start_word` 已暂停即拒；`run_batch` 捕获 `ResumeRejected` 转**稳定** `paused_reason`/`stopped_before`，不抛异常覆 ledger | 第 100 词必要 TOC/MAIN 在 bytes 允许下完结后立即 pause |
| 9 load 不校 budget/计数/started/分类 | `BatchCheckpoint.from_json` 严格不变量：额度精确匹配、非负 int 非 bool、`started` 集合一致、触限必须有暂停态、`requests_by_kind` 之和 ≤ attempts；违反即 `CheckpointInvariantError`，**绝不修值/清零/取大** | — |
| 11 结构错误留 in-flight / 全当 missing | `action_api.classify_api_error`：仅真实 missing 码 → `MISSING`；maxlag 等 → `RetryableActionApiError` 受预算有限重试；其余结构错误 → `ActionApiError` 由 collector 持久 `FAILED` 收尾，不留 in-flight | 坏 JSON：响应已计账、`activeRequest` 已清 |

`RunBudget` 计数原语在 Phase A 已拆为 `begin_attempt`/`record_response_bytes`/
`note_retry`/`note_error`（attempt 与成功 response 分开）；账本通过
`request_accounted` 持久化已知 bytes。Java 式强校验（严格不变量）不绕。

## 测试覆盖（含负例 / 崩溃模拟）

- HTTP：exact 触限不复判 complete（单 member/分 chunk 第二 member/concat exact/
  高膨胀）、response 协议缺失/计账异常 close、mid-read 保已知 bytes 不重试。
- 持久账本（新增 `test_wiktionary_per_word_persistence.py`，22 项）：
  dispatch 前 `activeRequest` 持久；坏 JSON 先计账后收尾且 in-flight 已清；
  reader 失败持久 `uncertain`+pause；崩溃于 clear 前 resume 被拒；journal 持久
  失败 `JournalError` fail closed；load 未经 resume 不得 start/请求；40 heads/8 MiB
  恢复不 reset；触限 resume 被拒；版本升级不 reset（文件字节不变）；create 拒覆盖；
  第 100 词终态立即 pause、第 101 不开始且稳定 report、暂停后不得请求旧词；
  结构错误 → FAILED 无 in-flight、真实 missing → MISSING、maxlag 受限重试；
  严格不变量负例（额度不等/布尔/负数/started 不一致/触限无暂停/分类超限）。
- 既有 `test_wiktionary_per_word_ledger.py`、`_http.py`、`_transport.py` 全部保持通过。
- **第二轮新增** `test_wiktionary_per_word_state_safety.py`（28 项）覆盖 oracle 7 问题
  负例与正向端到端（预置队列绕预算、未知/零消费 transport、IncompleteRead/close 失败、
  恢复 skip 终态 40 heads/8 MiB、strict JSON 各层、durable 暂停、maxlag 计账）。
  四套目标测试 + 新增合计 **105** 项全绿（见 `logs/state-safety-combined.log`）。
- **第三轮新增** `test_wiktionary_per_word_operation_retry.py`（9 项，含 7 决定性用例）：
  generic 只 1 + durable pause、显式 known-zero 可重试、302 单 dispatch + body 计账、
  maxlag→503 max1 最多 retry1、两词 operation 独立且累计相加、MAIN 只重抓 MAIN、
  claim 持久失败/崩溃 resume 无免费重试。http/transport/ledger/persistence/state_safety
  + operation_retry 合计 **117** 项全绿（见 `logs/transport-retry-combined.log`）。

## 命令与退出码

环境：`python3 --version` = 3.14.4（仅标准库）。

| 命令 | 日志 | 退出码 |
| --- | --- | --- |
| `python3 test_wiktionary_per_word_http.py` | `logs/http-ledger-http.log` | 0 |
| `python3 test_wiktionary_per_word_transport.py` | `logs/http-ledger-transport.log` | 0 |
| `python3 test_wiktionary_per_word_ledger.py` | `logs/http-ledger-ledger.log` | 0 |
| `python3 test_wiktionary_per_word_persistence.py` | `logs/http-ledger-persistence.log` | 0 |
| `python3 -m unittest <http transport ledger persistence>` | `logs/http-ledger-combined.log` | 0（77 tests OK） |
| `python3 -m compileall -q <本轮模块与测试>` | `logs/http-ledger-compile.log` | 0 |
| `python3 refresh_wiktionary_pronunciations.py --help` / `--apply`（单独） | `logs/http-ledger-cli.log` | 0 / 2（拒绝，零网络） |
| `python3 -m unittest <http transport ledger persistence state_safety>` | `logs/state-safety-combined.log` | 0（105 tests OK） |
| `python3 -m unittest test_wiktionary_per_word_state_safety` | `logs/state-safety-new.log` | 0（28 tests OK） |
| `python3 -m compileall -q <本轮模块与测试>` | `logs/state-safety-compile.log` | 0 |
| `python3 refresh_wiktionary_pronunciations.py --help` / `--apply`（本轮复核） | `logs/state-safety-cli.log` | 0 / 2（拒绝，零网络） |
| `python3 -m unittest <http transport ledger persistence state_safety operation_retry>` | `logs/transport-retry-combined.log` | 0（117 tests OK） |
| `python3 -m unittest test_wiktionary_per_word_operation_retry` | `logs/transport-retry-operation-retry.log` | 0（9 tests OK） |
| `python3 -m unittest test_wiktionary_per_word_transport` | `logs/transport-retry-transport.log` | 0（12 tests OK） |
| `python3 -m unittest test_wiktionary_per_word_http` | `logs/transport-retry-http.log` | 0（34 tests OK） |
| `python3 -m compileall -q <本轮模块与测试>` | `logs/transport-retry-compile.log` | 0 |
| `python3 refresh_wiktionary_pronunciations.py --help` / `--apply`（第三轮） | `logs/transport-retry-cli.log` | 0 / 2（NO-GO 显式拒绝，零网络） |

汇总：http 34、transport 12、ledger 12、persistence 22、state_safety 28、operation_retry 9（combined 117）。

## 本 lane 文件 sha256

| 文件 | sha256（第三轮） |
| --- | --- |
| `wiktionary_per_word/http_adapter.py` | `1ec99044fb92bc57acd63dff4017826dccd260809d1d6c6d84fba73c0412befa` |
| `wiktionary_per_word/ledger.py` | `18fd6d429a9a10e083afa9549772b310d1b9b9ec55194075a78de426039f1184` |
| `wiktionary_per_word/collector.py` | `d55f403d96456ac15e93c1cf6a220bf1a01d11865870d5fde84b64630357a33c` |
| `wiktionary_per_word/action_api.py` | `8a3a0b763f105665a4cd19dc8b136ab7db1a2c152fd4eb62c30f0a1fcd692ab1` |
| `refresh_wiktionary_pronunciations.py` | `118d4e24f3c3bb05a9e8ca7177770b28413a76366deabca8bf87f1cd8df860aa` |
| `test_wiktionary_per_word_http.py` | `a5bf4feae7d2d09feca7a3c3e8baf9a94fdb6bd401aa71ff7f136902e0a1f904` |
| `test_wiktionary_per_word_transport.py` | `38311a0ec872391bdaeefe6810da6b27618f6897f07b2bbe7f69aa42d623833a` |
| `test_wiktionary_per_word_ledger.py` | `5a775a10a339d2a251ea7c7a6ec59d8a28bdd03fae16808948131542296cac75`（未改） |
| `test_wiktionary_per_word_persistence.py` | `22430bd314eb328be30d555aa9198bd64d6891b7e8a5853fe4582518bfffc985`（未改） |
| `test_wiktionary_per_word_state_safety.py` | `058d238d2062a50b3941890b7927c119a11a6220fb7ebf175255bbf34e072227` |
| `test_wiktionary_per_word_operation_retry.py` | `37cf3075154a555f522e6d9c17708c2461ca9d3efd4b95af866f22a42004d538` |

`contract_adapter.py` 本轮未改（mtime 保持 10-08）。

## 未达 / 明确边界（不得据本文件宣称完成）

- **问题 8（授权记录 / CLI 参数严格校验）未实现**：现 `BatchAuthorization` 仍只有
  最小字段，`granted`/`source`/额度校验为弱校验；**未**实现 strict JSON 类型、
  `maxHeads<=100`/`maxDecoded<=20MiB` 上限、purpose/approver/time/唯一 batch、
  heads list SHA256、官方 endpoint host/path、reserved/local contact 拒绝、
  interval 正低速强制等。当前 authorization **不得当作可执行的真实采集凭证**。
  因此本轮 `main` 的 `--apply` 是**显式 NO-GO 拒绝**（exit 2，零网络），Phase B
  strict authorization（caps/config binding/registry/flock/CAS）独立实施前不可执行。
- **问题 3 的“同授权重开重置额度”防护未做**：仅做到 create 拒覆盖 + load/resume；
  唯一授权绑定 batch / 跨路径授权消耗 registry 留下一阶段。
- ~~问题 4/5 的完整 fail-closed 语义~~：**第二轮已统一**——`incomplete-response` /
  `unsupported-encoding` / `journal-persist-failed` 已纳入 `BUDGET_PAUSE_REASONS`
  成为 durable 暂停，resume 直接拒绝；`request_started` 暂停时拒 dispatch。
- **合同终态机械对齐**：**已由父 lane 2.1 验收**（adapter 13 / cross 6 / Python 19 /
  Node OK，0 skip；复用父已有证据，非本轮重跑）。checkpoint DTO 仅 summary；full
  internal 6.3 的 authorization fingerprint / active / retry / registry / generation
  仍待**最终验收**。
- **fix-4 活跃文件**：`evidence.py`/`offline_reparse.py`/`html_extract.py` 与
  `test_wiktionary_per_word_offline.py`/`_evidence.py` 由另一 lane 正在编辑；本轮
  观察到的 `test_usage_label_distinguishes_true_duplicate` 与 evidence 测试失败属
  fix-4 进行中状态，非本 lane 改动导致（本 lane 四套目标测试全绿）。
- 未真实联网、未运行 `--apply`、未采集/发布/迁移、未启用长期调度；未勾选
  tasks 5/6。
- `evidence/05-python-offline.md` 旧“✅ 通过 / 夸大”表述由主编排合并修订。

## 后续阶段 pending（依赖）

1. 问题 8 授权严格校验与 CLI 参数校验（可独立进行，不依赖其他 lane）。
2. 问题 3 唯一授权绑定/registry（依赖 8 的授权记录结构）。
3. contracts 终态机械对齐（依赖 fix-3 `contracts.py` 终态）。
