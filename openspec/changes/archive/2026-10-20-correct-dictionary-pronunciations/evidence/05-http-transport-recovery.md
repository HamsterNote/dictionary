# HTTP transport 恢复阶段证据（问题 1/2/6/10 + 响应 close）

本文件是 OpenSpec change `correct-dictionary-pronunciations` 的**有限范围**恢复
证据：只覆盖 **HTTP transport 适配层**（原 oracle review 问题 1、2、6、10 与
“响应 finally close / 中途异常保已知 bytes”）。**不声称** tasks 5.1–5.4 或
6.1–6.4 整体完成；账本持久协议、授权严格校验、collector/action_api 编排等仍
留在后续阶段（见“未达/留待下阶段”）。

## 本轮写入范围（严格遵守）

- `scripts/wiktionary_per_word/http_adapter.py`
- `scripts/refresh_wiktionary_pronunciations.py`：**仅** `_build_urllib_transport`
  及其私有 `_UrllibResponse`（其他 CLI 段落未动）
- `scripts/test_wiktionary_per_word_http.py`
- `scripts/test_wiktionary_per_word_transport.py`（新增专属 transport 测试）
- `openspec/changes/correct-dictionary-pronunciations/evidence/05-http-transport-recovery.md`
  与 `evidence/logs/http-transport-*.log`

**未写**：`ledger.py` / `collector.py` / `action_api.py` / `contract_adapter.py`
/ `scope_model.py` / `html_extract.py` / `evidence.py` / `offline_reparse.py` /
`contracts.py` / TS / `tasks.md` / `package.json` / 旧数据 / 旧生成器 / 其他
`test_wiktionary_per_word_*.py`；未真实联网、未运行 `--apply`、未建任何真实
authorization、zero 新依赖（仅 Python 标准库 + `unittest.mock`）。

## 关键实现（问题 → 修复）

| 原问题 | 修复 |
| --- | --- |
| 1 真实 wrapper 只 `read(size)`，adapter 只认 `reader` → body 空 | 新增 `_reader_for`：优先 `reader`（假响应），否则 `read(size)`（真实 wrapper）；`FakeResponse` 同步暴露 `read(size)` 委托，统一协议。wrapper→adapter→`action_api` JSON 解析链路有 monkeypatch `urlopen` 实测。 |
| 2 `HTTPError` 429/503 不走 retry/计费 | `_UrllibResponse` 把 `HTTPError` 视为**可读、可关闭的状态响应**（保留 status/headers/body），进入 429/503 重试与字节计账；`URLError`/timeout/`OSError` 归一为 `TransportError`；`urlopen(..., timeout=30s)` 有限超时。 |
| 6 gzip EOF 未检、concat 只读首个、header 大小写绕过、未知编码 | `normalize_headers` 全小写；`BoundedStreamReader` 校验 `decompressor.eof`（trailer 缺损→`incomplete-gzip`）、循环消费所有 member（含 `unused_data`）、以 `max_length` 有界输出；未知/多层 `Content-Encoding` fail closed（不按 identity 旁路、不读 body、不计字节）；gzip 损坏/不完整归 `incomplete-response`，不伪装 `decompressed-budget-exhausted`；恰好额度且 member 完整时允许“响应完成后 pause”，不额外读取。 |
| 10 失败时 `last_request_at` 仅 response 后记、attempt/response 混计 | dispatch **前**更新时间戳；重试等待 `max(串行间隔, Retry-After/退避)`；`RunBudget` 拆分原语 `begin_attempt`（计 attempt）/`record_response_bytes`（计 bytes）/`note_retry`/`note_error`，失败 attempt 计 request+error+retry，不再以成功 response 数当 requests。 |
| 5（响应 close 部分）中途异常不 close、漏记已知 bytes | `BoundedStreamReader` 捕获读取异常返回 `reader-error` 并保留已知 network/decoded；`_consume_and_account` 在所有路径 `close()`；异常标 `consumption-uncertain`、不重试、不退预扣、不写缓存（缓存决策属后续 collector 阶段，本轮仅暴露 `consumption_uncertain`/`last_known_*` 状态）。 |

`RunBudget` 与 `HttpAdapter` 新增只读公开状态（`consumption_uncertain`、
`last_known_network_bytes`、`last_known_decompressed_bytes`、
`last_response_complete`）作为**下阶段 ledger 持久协议接入点**；本轮不改
`ledger.py`，不落盘、不声明持久化完成。

### 兼容性

- 保留原有构造函数参数、`FakeResponse`/`RunBudget`/`ReadResult` 字段与
  `validate_user_agent`/`parse_retry_after` 行为。
- 原有 `record_response` 拆为显式原语，仅 `http_adapter.py` 内部使用；对外的
  `budget.request_count`/`requests_by_kind`/`decompressed_bytes`/`network_bytes`
  语义保持，`test_wiktionary_per_word_offline.py`（非本轮允许写）等既有断言
  仍通过。
- `validate_user_agent` 的 synthetic 标记保持原样（`synthetic`/`example.invalid`/
  `localhost`）；更完整的 reserved/local contact 拒绝属“授权记录”阶段，**本轮
  未启用**，以免破坏既有 `REAL_LOOKING_UA` 夹具。

## 测试覆盖（含负例）

新增/扩展断言（全部 offline、synthetic）：

- 统一 read 协议：`FakeResponse.read` 委托 `reader`；只有 `read(size)` 的响应
  不再读到空 body。
- header 小写化；lowercase `content-encoding: gzip` 仍计 gzip 解压预算。
- gzip trailer 截断 → `incomplete-response`（非 budget-exhausted），已知网络
  字节保留；concat 多 member 全部消费（`AAAAA`+`BBBBBBB`=12 字节）；未知编码
  `br` → `unsupported-encoding`，解压/网络字节均为 0（不 identity 旁路）；gzip
  恰好等于额度且 member 完整 → 返回响应后暂停、不额外读取。
- 读取中途失败（先 bytes 后 throw）→ 保留已知 bytes、`close()`、
  `consumption-uncertain`、**不重试**（transport/urlopen 仅调用一次）。
- attempt 计账：transport 连续失败 3 次 → request_count=3/error=3/retry=2；
  interval=10 时重试等待 ≥10（非 fallback 5）。
- monkeypatch 真实 `urllib.request.urlopen`：wrapper→adapter→`action_api`
  完整链路（body 非空、JSON 解析、response 关闭、有限 timeout）；`HTTPError`
  429（带 `Retry-After: 7` 与 error body）被重试且 error body 计入网络字节；
  `URLError`/`TimeoutError`/`OSError` 归一为 `TransportError`。

## 命令与退出码

环境：`python3 --version` = 3.14.4（目标 ≥3.12，仅标准库）。

| 命令 | 日志 | 退出码 |
| --- | --- | --- |
| `python3 test_wiktionary_per_word_http.py` | `logs/http-transport-http.log` | 0 |
| `python3 test_wiktionary_per_word_transport.py` | `logs/http-transport-transport.log` | 0 |
| `python3 -m unittest discover -p 'test_wiktionary_per_word_*.py'` | `logs/http-transport-discover.log` | 0（134 tests OK，skipped=4 为待终态合同对齐） |
| `python3 -m compileall -q http_adapter / CLI / 两个 test` | `logs/http-transport-compile.log` | 0 |
| `python3 refresh_wiktionary_pronunciations.py --help` | `logs/http-transport-cli.log` | 0（零网络） |
| `python3 refresh_wiktionary_pronunciations.py --apply`（单独） | `logs/http-transport-cli.log` | 2（拒绝，零网络） |

退出码汇总见 `logs/http-transport-exit-codes.txt`。本轮 http 29 项、transport
10 项；全量 discover 由 82 → 134 项（含 4 skipped）。

## 本 lane 文件 sha256

| 文件 | sha256 |
| --- | --- |
| `wiktionary_per_word/http_adapter.py` | `574e5cd37de85f4c28276c772142ce7a9d3971b6ea8ffea34388c0cdf01da7d6` |
| `refresh_wiktionary_pronunciations.py` | `ccbf61087a073a407c170355af75fcb3fde29fa18a33bbb8eb688e313213c9f4` |
| `test_wiktionary_per_word_http.py` | `24fba0af0370efafbb6a63b0d4e54d19e86a2ce75f512982dfe80f71befe82a2` |
| `test_wiktionary_per_word_transport.py` | `6cd3193803cde817687de5693c7c617e7a4b72ecfafcef8cce2522e02919269f` |

`ledger.py` / `collector.py` / `action_api.py` / `contract_adapter.py` /
`contracts.py` 本轮**未改**（另一 lane 持有或留待后续阶段）。

## 未达 / 留待下阶段（不得据本文件宣称完成）

- **问题 3/4/7/8/9/11（账本/授权/编排）未在本轮实现**：`ledger.py` 的
  create/resume 分离、resumable 门槛、in-flight 持久 uncertain、严格授权记录、
  checkpoint 严格不变量、collector ActionApiError 处理等仍待后续阶段；本轮只
  在 `HttpAdapter`/`RunBudget` 暴露接入状态。
- **问题 5 的持久化部分**：本轮只做到“保已知 bytes + close + 标 uncertain +
  不重试/不缓存”，**未**接入 ledger 的 dispatch 前持久 request-inflight 协议。
- **合同终态机械对齐**：§5.2/5.3 的 `contracts.py`（另一 lane，正在加
  `lexeme`/empty 支持）终态对齐仍 **未执行**，`ContractAlignmentTest` 仍
  skipped（4 项）；本文件不声称其通过。
- `evidence/05-python-offline.md` 中既有的“✅ 通过 / 夸大”表述由主编排合并
  修订；本文件不覆盖、不背书其旧结论。
- 未真实联网、未运行 `--apply`、未采集/发布/迁移、未启用长期调度；问题 8 的
  真实 authorization 与问题 12.1 长期预算均无授权，未触碰。

## 后续阶段明确 pending（依赖关系）

1. ledger 持久账本协议（问题 3/4/5/7/9）：接入本轮暴露的
   `consumption_uncertain`/`last_known_*` 状态，实现 dispatch 前持久
   request-inflight 与 fail-closed 恢复。
2. collector/action_api 编排（问题 11）：ActionApiError 分类与 FAILED 持久化。
3. 授权严格校验（问题 8）：stub 记录、reserved contact 拒绝。
4. contracts 终态机械对齐（依赖另一 lane `contracts.py` 终态，fix-3）。
