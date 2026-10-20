# Phase A 合同机械对齐证据（contract_adapter ↔ contracts.py / contracts.ts）

本文件是 OpenSpec change `correct-dictionary-pronunciations` 的**合同终态机械集成
（integration lane）**证据：把内部模型经 `contract_adapter.py` 生成的
Observation / SourceEvidence / BudgetCheckpoint DTO，与**最终 Phase A** 的
`scripts/wiktionary_per_word/contracts.py` 和 `src/pronunciation-overlay/contracts.ts`
交叉核对。

写 scope 仅限：

- `scripts/wiktionary_per_word/contract_adapter.py`
- `scripts/test_wiktionary_per_word_offline.py`（`ContractAlignmentTest` +
  `ContractShapeTest`）
- 新增 `scripts/test_wiktionary_per_word_contract_alignment.py`
- `openspec/changes/correct-dictionary-pronunciations/evidence/05-contract-alignment.md`
  与 `evidence/logs/alignment-*`

**未**改 `contracts.py` / `contracts.ts` / 其他 parser·evidence·scope·offline 模块 /
http·ledger·collector·action·CLI / TS·Python JSON / `identity.ts` 与 identity 测试。
**未**联网、未安装、未采集、未发布、未勾 tasks checkbox、未改 package。

## 对齐点

| 合同要求（TS/Python 一致） | 适配层处理 |
| --- | --- |
| scope 8 维：`language, entry, lexeme, role, pos, sense, accent, other` | 直接输出内部 `Applicability.to_json()`（已是 8 维，含独立 `lexeme` unknown，不伪装通配） |
| 语言非空 | 显式等价映射 `English → en`（BCP-47）；**原来源语言完整保存在内部 `SourceEvidence.language`**，未知语言原样透传，不猜测（见下） |
| `completeness` 枚举 | `empty` / `control-character` / `truncated` / `complete` / `broken-delimiter` / `fragment`；截断（EOF/未闭合 capture）明确 `truncated`，不冒充 complete |
| `rawIpa` / `normalizedIpa` 空值合法 | 保留内部原值，空观测序列化为空字符串（evidence-only），不丢 |
| `rawTags` / `rawQualifiers` / `structuralPath` | 全量保留（含 unknown restriction 标签 metadata），供合同追溯 |
| `SourceEvidence` page/history/revision/time/request/render/extractor/tagRule/hash/fingerprint/cache/license | request/render 取自内部证据 `evidence.request_version`/`render_version`（不再用常量覆盖）；`cacheRef` 由 `cache_sha256` 提供；`revision` 由 `revid` 或 `unknown` |
| Wiktionary 许可 | `sourceSite="wiktionary"`，`spdx="CC-BY-SA-4.0"`，`shareAlike=true`，许可 URL/归因/变更说明齐全 |
| checkpoint pause/evidence 可选字段 | 无值时**省略键**（不写 `null`），匹配 TS `undefined` 语义 |
| `lastCompletionEvidence` | 由参数显式传入；无则省略 |

### 语言等价策略（不伪造）

内部按可读音系名保存（当前 `English`），合同用 BCP-47（`en`）。适配层只映射已知
等价（`english`/`en` → `en`），未知语言原样透传；**原来源语言不丢失**（仍在内部
证据对象上），等价关系在本文件与适配层注释中明确。未把“未知”当作 `en`。

## 4 个真实 ContractAlignmentTest 撤下 skip 并跑通

`scripts/test_wiktionary_per_word_offline.py` 中 `ContractAlignmentTest` 的 4 个
原 `@unittest.skip` 用例已**真实启用**（不再 skip 当 pass），并补充：

- `test_scope_json_passes_contract`：known / explicit-all（引用列表）/ unknown 三态。
- `test_observation_json_passes_contract`：8 维含 `lexeme`、`English→en`、rawTags 全保留。
- `test_empty_and_control_and_fragment_completeness`：空/控制/坏定界符/截断完整度。
- `test_evidence_json_passes_contract`：许可、request/render、来源 metadata、cacheRef。
- `test_checkpoint_json_passes_contract`：pauseReason 映射、可选键省略。

`ContractShapeTest`（自包含形状）保留并继续通过。`ContractAlignmentTest` 9 例 +
`ContractShapeTest` 4 例 = 13 例，全 OK，**skipped=0**。

## 新增跨语言代表夹具测试（Node + Vite SSR 实际验证 + Python 同夹具）

`scripts/test_wiktionary_per_word_contract_alignment.py`：

- 由真实内部模型经 `contract_adapter` 生成 evidence/observation/checkpoint，
  组成完整 `OverlayDocumentSet` 夹具（identity + evidence + observations + rules +
  resolved + manifest + approval + checkpoint）。
- **同一份夹具 JSON** 同时交给：
  - Python `contracts.validate_document_set`；
  - Node `--input-type=module` + Vite `createServer().ssrLoadModule('/src/pronunciation-overlay/contracts.ts')`
    的 `validateOverlayDocumentSet`（真实跨语言，不只 Python 形状）。
- 逐项比较 valid 结论一致；覆盖：
  - **valid** 文档集（含 known entry/lexeme 引用已声明身份）；
  - **unknown-as-all**（`kind:"all"`）；
  - **missing-license**（`spdx:"MIT"`）；
  - **missing-lexeme-dimension**；
  - **dangling-evidence** / **dangling-known-entry** / **dangling-known-lexeme**；
  - **duplicate-evidence-id**；
  - **malformed-list**（`observations:5`）；
  - **invalid-id-format**（`identityEntryIds:["read"]`）；
  - **primitive-document**（`null`）。
- 另断言：8 维含 lexeme、`English→en`、raw unknown tags（`nonstandard-new`）保留、
  空/片段观测为 evidence-only（`completeness!="complete"`，`rawIpa=""`）且不含 `default`。

Node/Vite 不可用则测试**失败**（`AssertionError`），不当作跳过。

## 本轮边界修复（语言/证据/完整度/checkpoint projection）

1. **语言 scope 等价一致**：`observation_to_contract` 现对 `applicability.language` 的
   `known` 值做与顶层相同的 `English→en` 映射；`unknown`/`explicit-all` **原义保留**
   （不改写、不升为通配）；known 多值逐值映射（未知语言原样）。构造新 dict，**不 mutate**
   内部 `Observation`/`Applicability`/raw metadata。测试：
   `test_observation_language_scope_matches_top_level`（含未 mutate 断言）。
2. **evidence 严格校验，不伪许可**：`evidence_to_contract` 先调用
   `SourceEvidence.from_json(evidence.to_json())`（复用现成严格接口，不改 evidence.py），
   缺失/空白/错误许可/属性类型不符即抛错；不再 `hardcode` 或 `license_url or 默认`
   掩盖问题，**不把 MIT 等伪成 CC BY-SA 4.0**。`changeNotice` 不虚构：显式
   `change_note` 优先；否则仅当内部 `status` 有明确首轮提取语义时声明常量
   `CHANGE_NOTICE_FIRST_EXTRACTION`；再无依据则 fail closed。request/render/cache/
   revision/source/许可 URL/归因全部取自严格校验后的内部证据。测试：
   `test_evidence_strict_validation_and_change_notice`。
3. **完整度按 fragment reasons + Unicode 控制类别**：`completeness_to_contract` 用
   `Cc/Cf/Cs/Co/Cn`（含 DEL、ZWSP 等）判定控制字符，与内部提取器一致；被 parser 判拒
   的读法绝不标 `complete`；截断仍是 `truncated`；**raw 原值不改**。测试：
   `test_completeness_control_categories_not_complete`。
4. **checkpoint projection 边界**：`checkpoint_to_contract` 明确定义为**审查用预算
   DTO projection**，不是可恢复 checkpoint：真实 resume 必须读取 ledger 的完整持久
   checkpoint（含 active_request / errors / categories / 授权绑定等安全字段），本
   projection 不能还原或扩预算。测试证明 projection 只读、**不 mutate** 完整
   checkpoint，内部 pause reason 保守映射（未知 → `other`，绝不解禁）。
   测试：`test_checkpoint_projection_does_not_mutate_and_conservative`。

## 命令与实际结果

| 命令 | 日志 | 退出码 |
| --- | --- | --- |
| `python3 -m unittest test_wiktionary_per_word_offline.ContractAlignmentTest test_wiktionary_per_word_offline.ContractShapeTest` | `logs/alignment-offline.log` | 0（13 tests OK，skipped=0） |
| `python3 test_wiktionary_per_word_contract_alignment.py` | `logs/alignment-cross-language.log` | 0（6 tests OK，含 Node/Vite SSR） |
| `python3 test_pronunciation_contracts.py` | `logs/alignment-python-contracts.log` | 0（19 tests OK） |
| `node scripts/test_pronunciation_contracts.mjs`（须在仓库根运行） | `logs/alignment-node-contracts.log` | 0（OK） |
| `python3 -m compileall -q <adapter+tests>` | `logs/alignment-compile.log` | 0 |

退出码汇总见 `logs/alignment-exit-codes.txt`。本轮按 lane 约束**只跑 owned tests +
跨语言 Node/Python 校验**，未重跑整包 discovery（避免并发 HTTP writer 噪音）。
`logs/alignment-discovery.log` 为上一轮记录，未在本轮更新。

### 本轮文件 sha256

| 文件 | sha256 |
| --- | --- |
| `wiktionary_per_word/contract_adapter.py` | `81dc57523c6e1eae81bc936ab1e96df0d7708dbc0abd2ebe5cb2ba3765e2056b` |
| `test_wiktionary_per_word_offline.py` | `03d05b18ad3269a8ada2e653ac50a7b97d536eb952874cedb13991bf9d4376a0` |
| `test_wiktionary_per_word_contract_alignment.py` | `7294a9a5575ae7d1df7a4c74c076ef4219db6e96f44218f090d7c4c7174f384e` |

## 边界与待追加合同（不偷偷忽略）

- 适配层**未新增合同字段**；若后续需要把内部新增安全数据（例如逐条
  `unclassified_tags` / `unknown-restriction` 分类结果）写入合同，应先由合同
  lane 追加字段，本 lane **不静默丢弃、也不自改合同**，届时另行报告。
- **checkpoint 恢复合同完整性尚待 HTTP/ledger 集成 lane**：合同 `BudgetCheckpoint`
  未承载 active_request / errors / categories / 授权绑定等恢复所需安全字段；
  `checkpoint_to_contract` 只是审查 projection，**不声称 6.3 恢复合同已满足**。
  已确认它**未被任何 resume 路径使用**（grep 仅测试引用）；若将来被实际 resume
  使用或需扩合同 schema，应作为阻塞上报，不在此降范围。
- `identity.ts` / identity 测试属另一 lane（fix3），本 lane 未读写。
- **task 2.1 尚待最终验收**；真实 `--apply`/联网/采集/发布/长期启用不在本轮；
  Node 侧为 Vite SSR 离线校验。
