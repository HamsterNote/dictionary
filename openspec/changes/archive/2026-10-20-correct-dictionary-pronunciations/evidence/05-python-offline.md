# 任务 5.1–5.4 与 6.1–6.4 证据：独立 Python 按词解析与流式预算

本文件是 OpenSpec change `correct-dictionary-pronunciations` 任务 5.1–5.4 与
6.1–6.4 的**离线实现与测试证据**。写 scope 仅限：

- `scripts/wiktionary_per_word/`（**不含** `contracts.py`，该文件属另一 lane）
- `scripts/refresh_wiktionary_pronunciations.py`
- `scripts/test_wiktionary_per_word*.py`
- `evidence/05-python-offline.md` 与 `evidence/logs/test-wiktionary-per-word-*.log`

**未**写 `tasks.md`（逐项达标证据留给主编排）；**未**改旧生成器/数据/
`package.json`/TS；**未**真实联网/安装/采集/发布/迁移/长期启用；10–12 组
独立授权未有，未越界。

## 执行边界重申

- 本轮为**离线代码实现**。全部 unittest 默认零网络，只注入假 HTTP transport /
  假时钟 / 假 streaming reader / 合成 HTML 与 tocdata。
- 真实入口（`--apply`）在构造 transport **之前**校验名单文件、真实合规
  User-Agent、显式预算与明确授权；任一项不通过即拒绝，**绝不联网**。
  单独给 `--apply` 也不请求。
- `synthetic` 授权与 `synthetic` User-Agent 被真实入口拒绝。测试内部使用
  synthetic 标记的 fixture 需显式 `allow_synthetic_*`，不当作真实许可。
- 旧 `generate_wiktionary_phonetics.py` / `generate_ecdict_inflections.py`
  等生成器与产物、ECDICT TSV/metadata、`scripts/data/` 未改动（`git status`
  无已跟踪文件修改）。

## 完成矩阵

| 任务 | 实现 | 关键测试 | 结果 |
| --- | --- | --- | --- |
| 5.1 工具入口 / 模块边界 / 离线重解析与候选 | `__init__`、`http_adapter`、`html_extract`、`offline_reparse`、`evidence`、`ledger`、`action_api`、`collector`、CLI | `ModuleBoundaryTest`、CLI 离线用例、`CandidateGenerationTest` | ✅ 通过 |
| 5.2 Action API parse/tocdata 动态选 English hLevel=2 | `action_api.select_english_section` / `fetch_english_page` | `SelectEnglishSectionTest`、`FetchEnglishPageTest` | ✅ 通过 |
| 5.3 结构栈提取多 Etymology/Pronunciation/POS、父级 qualifier、全 tags/路径 | `html_extract` | `HtmlExtractionTest` | ✅ 通过 |
| 5.4 串行低速 / 合规 UA / 显式间隔 / 有限重试与退避 | `http_adapter`（`validate_user_agent`、`fetch`、`parse_retry_after`） | `UserAgentTest`、`SerialAndBackoffTest` | ✅ 通过 |
| 6.1 streaming/gzip 限额与请求分类计账 | `BoundedStreamReader`、`RunBudget`、`HttpAdapter._consume_and_account` | `BoundedReadTest`、`AccountingTest`、`ExactBudgetTest` | ✅ 通过 |
| 6.2 distinct 预扣 / 逐词状态机 / 首轮 100 词 | `BatchLedger.start_word` / `finish_word` | `LedgerBudgetTest` | ✅ 通过 |
| 6.3 checkpoint 同批恢复 / 版本校验 / fail closed | `BatchCheckpoint`、`BatchLedger.load/resume/persist` | `ResumeTest` | ✅ 通过 |
| 6.4 不可变证据 / HTTP hash / 语义 fingerprint / 离线重解析 | `evidence`、`offline_reparse` | `FingerprintTest`、`CacheTest`、`EvidenceLedgerTest` | ✅ 通过 |

## 模块边界（tasks 5.1）

| 模块 | 职责 |
| --- | --- |
| `scope_model.py` | 内部 scope 三态（`known` / `explicit-all` / `unknown`）与 7 维 applicability；与 `contracts.py` 机械对齐 |
| `http_adapter.py` | HTTP 适配：合规 UA、串行、显式间隔、有限重试、429/503 退避、限额流式、解压、分类计账 |
| `html_extract.py` | `html.parser.HTMLParser` 结构栈提取：标题栈 + 块级帧 + 音频抑制 |
| `evidence.py` | 不可变 `SourceEvidence`、write-once `ResponseCache`、语义 fingerprint |
| `ledger.py` | 持久 `BatchCheckpoint` / `BatchLedger`：distinct 预扣、状态机、原子持久化、恢复、版本校验 |
| `offline_reparse.py` | 离线重解析与保守候选生成（纯函数） |
| `action_api.py` | `parse`/`tocdata` 动态选 English hLevel=2，取完整展开文本；可选 Kaikki 对照不阻断 |
| `collector.py` | 把以上串起来的按词采集编排；强制 adapter 与 ledger 共享同一预算对象 |
| `contract_adapter.py` | 把内部 evidence/observation/checkpoint 机械序列化为 `contracts.py` 合同形状 |
| `../../refresh_wiktionary_pronunciations.py` | CLI：默认离线；`--apply` 显式校验后才可能联网 |

`contracts.py`（另一 lane）提供 TS/Python 合同的读取校验；本 lane **未读写**
该文件（其正在加入 `lexeme` 维度与 empty 支持）。本证据记录该边界。内部序列化
先由自包含的 `ContractShapeTest` 校验；对其余 lane `contracts.py` 的机械 align
留待两 lane 终态由主编排 integration validation 执行（`ContractAlignmentTest`
暂被 skip）。

## 合同终态机械对齐（待主编排 integration）

另一 lane 已确认合同终态将包含下列变化；本 lane **不在其恢复期间读写
`contracts.py`**，先以自包含形状校验并通过自身测试，待终态再机械 align：

- `SCOPE_DIMENSIONS` 增加 `lexeme`（仍保 `known` / `explicit-all` / `unknown`
  三态结构）。本 lane `Applicability` 现为 7 维，届时补 `lexeme` 维度。
- empty IPA 合法，保留为 evidence-only：本 lane 的
  `contract_adapter.completeness_to_contract` 已可将空 `rawIpa` 映射为
  `completeness="empty"`（`ContractShapeTest.test_empty_ipa_maps_to_empty_completeness`
  覆盖）；提取器当前对空 IPA span 仍记 warning 不产出观测，待终态对齐时改为
  evidence-only 保留。
- identity 最终单一 canonical `byId` 含 entry + lexeme：属身份 lane，不在本
  按词解析 lane 的实现范围；本 lane 的账本 `head` 与证据 `word` 保持按词粒度。


## 关键行为覆盖

### 5.2 Action API

- English **不在 index 1**（German/English/French，English number=2）仍被选中；
  第二个请求 URL 使用 `section=2`，未写死 `section=1`。
- 缺页（`{"error":{"code":"missingtitle"}}`）→ `PageStatus.MISSING`，不解成
  空结果、不清正式值。
- 无 English → `PageStatus.NO_ENGLISH`。
- 可选 Kaikki 对照不可用只返回原因，不阻断官方流程。
- 官方展开已含模板输出；主线不展开模板（断言输出不含 `{{`）。

### 5.3 结构提取

- 两个 Etymology、多个 IPA 全部保留（不取第一项）。
- 与音频同 `<li>` 的第一条 IPA **qualifiers 为空**，不借用音频标签。
- 第二条 IPA 继承父级 `(General American)` qualifier。
- 无闭合定界符的片段被保留、`complete=False`、记 `incomplete-or-corrupt-ipa`。
- 缺 POS/role 不猜，记 `pos-not-determinable` / `role-not-determinable`。
- 保留原标签与结构路径（`heading:Pronunciation` 等）。

### 5.4 串行 / UA / 退避

- 缺 UA / 含 synthetic 标记 → 抛错且 transport 零调用。
- 429 `Retry-After: 7` → sleep 7s；503 无头 → 5s / 10s 指数退避。
- 传输层重入同 adapter → `ConcurrencyError`（强制串行）。
- 间隔 `interval_seconds` 在请求间生效。
- 重试响应与错误响应都计入预算。

### 6.1 流式限额与计账

- ALL 主 / TOC / 辅助 / 错误 / 重试响应按 kind + outcome 计账，网络 bytes 与
  解压 bytes 分报。
- gzip 高膨胀（2 MiB 零）在 `max_length` 下被限额截断，网络字节远小于膨胀量。
- 恰好触限立即停读（reader 调用次数=1），不补读；截断/损坏 gzip 不返回成功
  body；触限关闭响应并记录已消耗 bytes。
- 截断内容不入成功缓存。

### 6.2 / 6.3 账本

- distinct 在请求**前**持久预扣；失败 / 缺页 / 无合格读法都计额。
- 同词重试不加 distinct，但响应照常计费（端到端 request_count=2）。
- 第 100 词可开始，第 101 不启动并暂停；单 head 额度的必要请求触限失败后暂停，
  不自动开新 run。
- 40 词 / 8 MiB 中断后 `load().resume()` 从原累计继续（不清零），第 41 词可开始。
- 触限暂停 `resume()` 被拒；in-flight 消费不确定 fail closed。
- schema/extractor/tagRule 版本不一致 → `VersionMismatch` 拒绝恢复，不 reset。
- synthetic 授权被真实入口（`allow_synthetic=False`）拒绝。
- 原子持久化（临时文件 + `os.replace`），无 `.tmp` 残留。

### 6.4 证据与离线重解析

- 语义 fingerprint 只覆盖 IPA / notation / completeness / qualifiers /
  applicability；无关文本与 tags/路径变化**不改变** fingerprint。
- 同 revid 下 IPA 变化 → fingerprint 变化可识别。
- 截断响应拒绝写入成功缓存。
- 历史证据只追加：同词两个 revid 都保留，不覆盖。
- 缓存带 CC BY-SA 4.0 source/history/许可，可离线重解析。
- 机械对齐：`evidence_to_contract` / `observation_to_contract` /
  `checkpoint_to_contract` 通过 `contracts.py` 校验器。

## 命令与日志

环境：`python3 --version` = 3.14.4（目标 ≥3.12，仅标准库，无 uv/requests/Kaikki）。

| 命令 | 日志 | 退出码 |
| --- | --- | --- |
| `python3 test_wiktionary_per_word_http.py` | `logs/test-wiktionary-per-word-http.log` | 0 |
| `python3 test_wiktionary_per_word_extract.py` | `logs/test-wiktionary-per-word-extract.log` | 0 |
| `python3 test_wiktionary_per_word_ledger.py` | `logs/test-wiktionary-per-word-ledger.log` | 0 |
| `python3 test_wiktionary_per_word_evidence.py` | `logs/test-wiktionary-per-word-evidence.log` | 0 |
| `python3 test_wiktionary_per_word_offline.py` | `logs/test-wiktionary-per-word-offline.log` | 0 |
| `python3 -m unittest discover -p 'test_wiktionary_per_word_*.py'` | `logs/test-wiktionary-per-word-all.log` | 0（82 tests OK，skipped=4 为待终态合同对齐） |
| `python3 -m compileall -q <modules+tests>` | `logs/test-wiktionary-per-word-compile.log` | 0 |

退出码汇总见 `logs/exit-codes-python-offline.txt`。分项计数：http 17、extract 17、
ledger 12、evidence 8、offline 28（含 4 skipped）。

## 本 lane 文件 sha256

| 文件 | sha256 |
| --- | --- |
| `wiktionary_per_word/__init__.py` | `c741281dcf2ea61c8ecb594896db1cdb2423b31ce6d8db86589502ca39cfebfa` |
| `wiktionary_per_word/scope_model.py` | `4be608c740d2d35a08a1a858ad49da05c7c59f039e6a0f37a4c4c71679b256e8` |
| `wiktionary_per_word/http_adapter.py` | `9f16660a00262e98411c479563d602fca97d0002fdc3da0de4f1f34975f8fef0` |
| `wiktionary_per_word/html_extract.py` | `145239132661194ba9e3e9d3545fe9ab82d09861a26f09d8c3fbc6299faf5445` |
| `wiktionary_per_word/evidence.py` | `a7e978b656f46f4f81f9ee081a0196030ef21117a3625eac441275d07ec64795` |
| `wiktionary_per_word/ledger.py` | `eb4f6e951926edaf29102ed53a1c946193d2488e68125406e437d5f71e05b992` |
| `wiktionary_per_word/offline_reparse.py` | `d9464cf9e60c87c66a0c97566bc70f3e073493d56c70e2be7bc09b1795fa4784` |
| `wiktionary_per_word/action_api.py` | `6c07915af3ce9a7b584c8f6edca2b3731a3f581b6a43e85f249a2ca4b59bcfa5` |
| `wiktionary_per_word/collector.py` | `b5d7e0dfe949adad6b28f986c907de903deeec94e042bd419b62cba3bd2fe8fe` |
| `wiktionary_per_word/contract_adapter.py` | `61d8949ff57dd1f6a558ec31a9a9346f0378c12beba3ef7d33bec60c6051823d` |
| `refresh_wiktionary_pronunciations.py` | `165b535e5f393278709ee80e3088c2b85927fe86e99e22085750b339a4faf8da` |
| `test_wiktionary_per_word_support.py` | `5f884a67587e67765e0d1ce24961a3c93b3a0e13cdf313fd5a6ed0bbd12e61e1` |
| `test_wiktionary_per_word_http.py` | `80d15a29246b63301a387da96cab1f7e639bd406b100a30ea05a0e3c5c275c5b` |
| `test_wiktionary_per_word_extract.py` | `e2d15595ed0f6ed8c4dc2480ee972f00a3d65528bbf59ed1aba52a51ca3483cb` |
| `test_wiktionary_per_word_ledger.py` | `5a775a10a339d2a251ea7c7a6ec59d8a28bdd03fae16808948131542296cac75` |
| `test_wiktionary_per_word_evidence.py` | `861fad76c94afec02f453e5902fdf2efc7562a4f834d257619355799a820ef8c` |
| `test_wiktionary_per_word_offline.py` | `e188b81acd1700f6a27adfaa4bf1881fa17fd73b871c7148f59727456147d5e1` |

`contracts.py` 由另一 lane 持有，本 lane 未改（sha256
`d9cf653ff285cfd43ab81e47679b12fc706b3cdfcf70b157c7abf061ddd5d2fd`，仅记录不主张）。

## 未达/边界说明

- 未按 10/11/12 组授权执行任何真实首轮采集、正式发布或长期调度。
- `run_apply` 受完整校验保护但本轮**从未**以真实 transport 调用；真实联网行为
  属于第 10 组独立授权范围。
- 未对上游真实 Wiki HTML 结构做在线验证；提取器以合成结构夹具覆盖，符合
  design 决策 7“本阶段不联网”。
