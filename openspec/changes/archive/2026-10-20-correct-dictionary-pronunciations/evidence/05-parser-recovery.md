# 任务 5.3 / 6.4 解析恢复证据（review 缺口逐项修复）

本文件是 OpenSpec change `correct-dictionary-pronunciations` 中 **task 5.3（结构提取）
与 6.4（不可变证据 / HTTP hash / 语义 fingerprint / 离线重解析）** 在 review 复核
缺口后的**恢复实施证据**。原 Python session 异常终止且不可复用，本轮**不从头重写**，
在已落盘文件上逐项修复。

写 scope 仅限：

- `scripts/wiktionary_per_word/{html_extract.py, scope_model.py, offline_reparse.py, evidence.py}`
- `scripts/test_wiktionary_per_word_{extract,evidence,offline}.py`
- `openspec/changes/correct-dictionary-pronunciations/evidence/05-parser-recovery.md`
- `openspec/changes/correct-dictionary-pronunciations/evidence/logs/parser-*`

**未**改 `contracts.py`（TS/合同 lane）、`http_adapter.py`、`ledger.py`、`collector.py`、
`action_api.py`、`contract_adapter.py`、CLI（`refresh_wiktionary_pronunciations.py`）
及 support/http/ledger 测试（均属独立 lane）。**未**改 tasks/package/旧 `scripts/data`。
**未**运行真实 `--apply`、未采集、未发布、未联网；全部 fixture 为 synthetic。

## 复核缺口逐项修复

### A. HTMLParser 结构提取（task 5.3）

| 缺口 | 修复 | 回归用例 |
| --- | --- | --- |
| 同名块隐式闭合误弹**合法 nested `li`** | 只在“真正的同级兄弟”（`len(elem_stack) == top.depth + 1`）才隐式闭合同名块；中间隔着 `ul`/`ol`/`dl` 的嵌套同名块保留 | `ParserRecoveryTest.test_nested_same_tag_li_is_not_popped` |
| 父级 GA qualifier 未继承 | 子块压栈时**继承**父块已收集的 qualifier（作用域向下） | 同上（nested li 继承 `(US)`） |
| 兄弟 qualifier/tag 污染 | 显式同级只继承父块；兄弟块中后出现的 qualifier 不进入另一兄弟 | `test_unclosed_sibling_li_implicit_close`、`test_sibling_qualifier_does_not_leak` |
| 音频深度混乱 / 邻 audio 借 accent | void 元素（`link`/`img` 等）**不压入**音频抑制栈，避免永久抑制；音频内文本仍被抑制，不借口音 | `test_void_audio_link_does_not_suppress_later_ipa`、`test_audio_neighbor_accent_not_borrowed` |
| 未闭合 `span` 导致块帧泄漏 | `handle_endtag` 不再提前 return；`_pop_element` 弹出到最近匹配元素（含未闭合子元素） | 现有 `HtmlExtractionTest` 全通过 |
| 空 IPA span 观测被丢弃 | 空 IPA 保留为 **evidence-only** 观测（`raw_ipa=""`、`complete=False`、`fragment=["empty"]`、`unresolved=["empty-ipa"]`） | `test_empty_ipa_span_preserved_as_evidence_only` |
| `raw_text.strip` 改原值 | 原值完整保存（不 strip）；仅比较值 `ipa` 解码实体 + NFC + 去边界空白。原 `raw_ipa` 保留 HTML 实体（如 `/ri&#720;d/`），`ipa` 解码为 `/riːd/` | `test_raw_ipa_keeps_boundary_whitespace`、`test_raw_preserves_entity_while_ipa_decodes` |
| `/x` 控制字符被 complete | `is_complete_ipa` 拒绝 Cc/Cf/Cs/Co/Cn 控制字符 | `test_control_character_ipa_not_complete` |
| `past tense and past participle` 只取首个 role | `detect_roles` 扫描**全部**角色提示，`roles=("past-participle","past")`；`applicability.role` 为 known 多值 | `test_two_roles_not_first_match` |
| 八维含 `lexeme` unknown | `Applicability` 增加 `lexeme` 维度（默认 `unknown("lexeme-not-determinable")`），共 8 维 | `test_applicability_has_eight_dimensions_including_lexeme` |
| 原 tags/qualifiers/结构路径保留 | `raw_tags` 保留祖先 class + 标题；`qualifiers`/`path` 原样保留；新增语义 `usage_labels` | `test_usage_labels_and_tags_preserved`、`test_original_tags_and_notation_preserved` |

### B. 离线重解析 / HTTP hash（task 6.4）

| 缺口 | 修复 | 回归用例 |
| --- | --- | --- |
| `application/json` 缓存的**主 `parse.text`**（`str` 或 `{"*": str}`）被当 tocdata → noEnglish | `reparse_cached_entry` 按 JSON 结构分派：`parse.text` → 展开 HTML 重解析；`parse.tocdata` → 仅结构 fingerprint；`error` → 错误 fingerprint | `JsonCacheReparseTest`（object / 裸 str / tocdata / tocdata+English） |
| HTTP hash 须保持**原 JSON** 而非 HTML | `build_source_evidence` 对**原响应字节**求 hash（`http_sha256 == sha256(JSON)`、`!= sha256(HTML)`） | `test_main_json_http_hash_is_json_not_html` |

### C. 语义 fingerprint（task 6.4 / design 决策 4）

| 缺口 | 修复 | 回归用例 |
| --- | --- | --- |
| 忽略 **ALL tags** 致 region/archaic/rare 变化 miss | fingerprint 纳入语义 `usageLabels`（archaic/obsolete/rare/regional-label/US/UK 等），仍排除 `mw-*`/`IPA`/音频/结构路径等排版类 | `FingerprintTest.test_usage_label_change_detected` |
| qualifier trim 无 NFC | qualifier 与 usage label 比较前做实体解码 + NFC + 去边界空白；applicability 的 known 值同样归一 | `test_qualifier_nfc_normalized_for_comparison` |
| 无关页面/排版误语义变 | 纯排版 class 变化（`mw-heading`→`layout-mark`）fingerprint 不变 | `test_layout_change_does_not_change_fingerprint` |

### D. ResponseCache：不可变证据 / metadata 身份 / 防篡改（task 6.4）

| 缺口 | 修复 | 回归用例 |
| --- | --- | --- |
| keyed 只用 body sha，同 body 不同 source/fetch/license 丢 provenance | 增加 `provenanceId = sha256(content hash + sourceUrl + fetchedAt + license + attribution + complete)`；同 body 不同来源各自保留 `CacheEntry` | `CacheTest.test_same_body_different_source_keeps_provenance` |
| `complete` 缓存缺全来源 license 元信息 | `CacheEntry` 带 `licenseId/licenseUrl/attribution/fetchedAt`；`to_json` 含 `provenanceId/bodyFile` | `test_reload_verifies_hash_and_license` |
| 加载不验 hash/license/complete | `_load` 校验 body sha256 == 声明、`complete` 为真、许可非空、provenance 身份可重算；任一不符抛 `CacheIntegrityError`（fail closed） | `test_tampered_body_rejected_on_load`、`test_missing_license_rejected_on_load` |
| 历史不覆盖 | `EvidenceLedger` 只追加（复核保留）：同 evidenceId 内容不同即 `ImmutableViolation`，幂等相同返回 False；`ResponseCache` 相同 provenance 幂等、不同 provenance 并存不覆盖 | `EvidenceLedgerTest`、`test_identical_provenance_is_idempotent` |
| 完整证据字段 | `SourceEvidence.to_json` 含 page/history/revid/fetchedAt/httpSha256/semanticFingerprint/extractor/tagRule/**request/render**/license/attribution/cacheSha256/status/changeNote | 现有 `test_evidence_includes_license_and_source` |

### E. 候选生成（task 7-前置纯函数，属 6.4 离线纯函数范围）

> **已由「复核第三轮」替代**：下表 `default_readings`（完整=default）/`supplemental_readings`
> （带定界符残片）的旧语义**不再成立**；完整来源读法现进入 `pending_readings`
> （classification-pending），`default_readings`/`supplemental_readings` 在 task 3.2
> 分类器接入前恒为空，未达完整/空/损坏 ALL 仅 `evidence_only_readings`。以下旧行为只作历史。

| 缺口 | 修复 | 回归用例 |
| --- | --- | --- |
| `tuple(dict.fromkeys(IPA))` 跨 scope/口音去重、按第一 IPA 折叠 | `_merge_readings` 真重复键 = **同证据 + 同 8 维 scope + 同 notation + 同 qualifiers + 同 IPA**；跨 scope 即使 IPA 相同也各自保留 | `CandidateScopeTest.test_same_ipa_different_accent_not_collapsed` |
| 需观测 ref 及 8 维完整 scope | `ReadingRef` 带 `ref`（`evidence#obs:N`，真重复用 `;` 合并）、`notation`、`qualifiers`、`roles`、完整 `applicability` | `test_reading_refs_carry_full_scope`、`test_true_duplicate_merged_by_scope` |
| （旧）qualified default / supplemental / evidence-only fragment 区分 | **已替代**：见「复核第三轮」#4、#7；旧 `default_readings`（完整）/`supplemental_readings`（残片）语义作废 | `test_usage_label_distinguishes_true_duplicate`、`test_control_fragment_marked_evidence_only` |

## 复核第二轮：主编排逐问题复现（本轮修复）

主编排按以下 7 个可视化/负例复现缺口，均已现场 negative 复现并小范围修完；
未改设计、未重写全模块，未跑整包并行 HTTP live。

| # | 复现 | 修复 | 回归用例 |
| --- | --- | --- | --- |
| 1 | root qualifier 泄漏到兄弟 `div`（`x`/`y` 都带 GA） | 将 `div/ul/ol/dl/section/table` 等容器纳入 qualifier 作用域帧（`SCOPE_TAGS`），兄弟容器各自成帧，`</div>` 关闭后不再继承 | `test_root_qualifier_not_leaked_across_sibling_containers` |
| 2 | 相邻 IPA span 的 class（archaic）污染后一条 | 移除帧内 `class_tokens` 历史累积；tags 只取 emit 时元素栈祖先 + 捕获元素自身 class 快照 | `test_adjacent_ipa_does_not_inherit_neighbor_usage` |
| 3 | `/x]/`、`/x/ /y/`、`/ /` 被判 complete | `is_complete_ipa` 要求内部含实质内容且不得混入 `/[]`；多 IPA/损坏 delimiter/空内容保守留片段 | `test_corrupt_or_multi_ipa_not_complete` |
| 4 | candidate 把 archaic/非限定同 IPA 合并，control 标 supplemental，complete 即 default qualified | 真重复键加入 usage labels + roles；完整来源读法进入 `pending_readings`（`classification-pending`），`default_readings=()`（不冒充 qualified）；未达完整/空/损坏 ALL 仅 `evidence_only_readings`，`supplemental_readings=()`（依赖 task 3.2 标签分类器） | `test_usage_label_distinguishes_true_duplicate`、`test_control_fragment_marked_evidence_only` |
| 5 | `_finish_capture` 对 qualifier `.strip()` 改原值 | qualifier 原值完整保存（含边界空白/实体），仅 `_normalize_ipa` 判空与比较；heading/capture 比较一律 `unescape` 后，不拿 raw entity 当英文标签 | `test_qualifier_raw_preserved_only_normalized_for_compare` |
| 6 | `_pop_element` 二次调用会弹掉同 tag 祖先；void 元素滞留元素栈、capture 靠逐 end 计数易泄 | 捕获边界改为“捕获元素被弹出即结束”（`_capture_elem_depth`）；void 不入元素栈、不计边界；endtag 只做一次 `_pop_element`；嵌套同名 span 只在自身边界结束 | `test_nested_span_capture_finishes_at_own_boundary`、`test_void_inside_ipa_does_not_leak_capture` |
| 7 | `put(complete="false"/空许可)` 被接受、`_load` `bool("false")` 为真、bodyFile 可穿越、`get` 多 provenance 默选第一条；`evidence_id` 缺实质元信息致同 body 不同 prov 碰撞；`from_json` 静默补默认 | `complete` 必须严格 `True`；许可须 `CC BY-SA 4.0` 且 sourceURL/attribution 非空；`_load` 校验 body hash/bytes/严格 complete/许可/bodyFile 无路径穿越/provenance 身份；`put` strict；`get` 多 provenance fail closed（用 `provenance_for`/`get_by_provenance`）；`evidence_id` 覆盖语言/页面/历史/request/render/许可/缓存/状态/变更；`from_json` 必需元信息缺失即报错 | `test_complete_must_be_strict_true`、`test_empty_license_or_source_rejected`、`test_get_ambiguous_multiple_provenance_fails_closed`、`test_load_rejects_non_strict_complete_and_traversal`、`test_evidence_id_covers_provenance_metadata`、`test_source_evidence_from_json_strict` |

### 依赖与未越界（不缩规格）

- **task 3.2 标签分类器依赖（正式 qualification）**：usage（archaic/obsolete/rare/region/未知限定）
  的合格判定属后续 3.2。本 lane 的最小安全实现是：完整来源读法仅作
  `classification-pending` 候选并逐条保留全部 metadata（含 usage labels、8 维 scope、
  真重复 ref），**不冒充 default qualified**，`default_readings`/`supplemental_readings`
  在分类器接入前恒为空；不提前实现第 7 组正式 approval/publication。该依赖已如实报告。
- **测试不以错分类固化**：本轮用例只断言“不同 usage 不合并”“完整读法 pending”“损坏
  evidence-only”，不断言 archaic/rare 的具体合格语义。

## 复核第三轮：主编排再次逐问题复现（本轮修复）

主编排零网实测的 7 个新缺口，均已现场 negative 复现并小范围修完（仅允许文件）。

| # | 复现 | 修复 | 回归用例 |
| --- | --- | --- | --- |
| 1 | 合法同名嵌套 `div` 被同名 start 隐式 close，x/y qualifiers 全空 | 隐式同名闭合仅限 `li/dd/dt/tr/td`（`IMPLICIT_CLOSE_TAGS`）；`div/section/ul` 等容器可合法嵌套，只 push 不弹；保留原 nested/unclosed li 语义 | `test_nested_same_tag_div_inherits_qualifier`、`test_nested_same_tag_li_is_not_popped`、`test_unclosed_sibling_li_implicit_close` |
| 2 | `<span class="IPA"><span class="archaic">/x/</span></span>` 内部 tag 丢，usage 空 | 新增 `_capture_inner_classes` 捕获期内部元素 class 快照，仅并入本条观测 tags，不污染相邻 IPA | `test_inner_semantic_element_tags_preserved`、`test_adjacent_ipa_does_not_inherit_neighbor_usage` |
| 3 | EOF 未闭合 `<span class="IPA">/x` 得 `[]`/`warnings[]` | `close()` 把未闭合捕获按截断落成残片证据：`fragment=["truncated-capture"]`、`unresolved=["truncated-markup"]`、`warnings=["truncated-capture"]`；有闭定界符但 markup 未闭合仍不算完整 | `test_unterminated_ipa_at_eof_is_fragment` |
| 4 | unknown restriction class 变化 fingerprint 相同（丢变化） | 明确 layout class（`mw-*`/IPA/audio 等）排除；未知非 layout class 保守记入 `unclassified_tags` 并纳入 fingerprint（附 `classRuleVersion`），保留变化供 3.2 unresolved，不猜资格 | `test_unknown_restriction_class_changes_fingerprint`、`test_layout_class_does_not_change_fingerprint`、`test_unknown_restriction_class_recorded_not_guessed` |
| 5 | `from_json` 仅 required+`str()`：None→"None" 通过；Cache 接受空白/伪造许可；`reparse` 接受字符串 `"false"` | `from_json` 校验非空字符串/64hex/revid 类型/CC BY-SA 4.0 SPDX 与实际 URL/evidenceId 重算吻合；Cache `put`/`_load` 拒绝空白 source/attribution、任意 https 冒充 CC、非 CC id；`_load` 校验 declared provenanceId 与文件名、`bytes` 禁 bool；`reparse_cached_entry` 严格 `complete is True` + hash/许可/source 完整性 | `test_source_evidence_from_json_strict`、`test_whitespace_and_spoofed_license_rejected`、`test_load_rejects_non_strict_complete_and_traversal`、`test_string_false_entry_rejected`、`test_hash_mismatch_entry_rejected` |
| 6 | 根级 error JSON 落 `reparse_html` 得 `warnings=[]` | `reparse_cached_entry` 结构优先：根级 `error`→`api-error`；非 parse dict/畸形 JSON→`malformed-json-structure`/`malformed-json` fail closed；合法 `parse.text`/`parse.tocdata` 仍成功；HTTP hash 仍为原 JSON 字节 | `test_root_error_json_fails_closed`、`test_malformed_json_fails_closed`、`test_main_parse_text_object_reparsed`、`test_main_json_http_hash_is_json_not_html` |
| 7 | `generate_candidates` docstring 与旧 E 段仍称 complete=default/fragment=supplemental；ReadingRef 不可回溯源观测 | docstring 改写为 pending/evidence-only；05 旧 E 段加“已替代”标注；`ReadingRef` 增加 `indices`（回解源 observations）与 `rawIpa/tags/path/section/etymology/pos/form/role/unclassifiedTags` 全 metadata | `test_reading_refs_traceable_to_source_observations`、`test_reading_refs_carry_full_scope` |

第三轮依赖仍为 task 3.2 标签分类器（正式 qualification）；`default_readings`/
`supplemental_readings` 接入前恒空，不提前代替 3.2，不勾 tasks。

## 命令与实际结果（本轮稳定复采）

环境：`python3 --version` = 3.14.4（目标 ≥3.12，仅标准库，无 uv/requests/Kaikki）。
全部零网络；synthetic fixture。

| 命令 | 日志 | 退出码 |
| --- | --- | --- |
| `python3 test_wiktionary_per_word_extract.py` | `logs/parser-extract.log` | 0（39 tests OK） |
| `python3 test_wiktionary_per_word_evidence.py` | `logs/parser-evidence.log` | 0（25 tests OK） |
| `python3 test_wiktionary_per_word_offline.py` | `logs/parser-offline.log` | 0（44 tests OK，skipped=4） |
| `python3 -m unittest discover -p 'test_wiktionary_per_word_*.py'` | `logs/parser-all.log` | 0（185 tests OK，skipped=4；含其他 lane 同名 `support/http/ledger` 测试） |
| `python3 -m compileall -q <modules+tests>` | `logs/parser-compile.log` | 0 |

退出码汇总见 `logs/parser-exit-codes.txt`。skipped=4 均为 `ContractAlignmentTest`
（待 `contracts.py` 终态后由主编排 integration validation 启用）。

### 本 lane 本轮文件 sha256

| 文件 | sha256 |
| --- | --- |
| `wiktionary_per_word/scope_model.py` | `a3ed2dcfc3126902af33161dcb85d56b4fd306f5e84691b6c30426c88e304f69` |
| `wiktionary_per_word/html_extract.py` | `aa45223c77bf12a468ebc42800a519152eb176f418ba55d41d8db31ee4e811a1` |
| `wiktionary_per_word/evidence.py` | `e01f68131f5c1e229c24973332200bb5bd1b319c59bb172905fe616eab828691` |
| `wiktionary_per_word/offline_reparse.py` | `3a1e370c5fa722ba469d8ca6281b9d16698ec2c48814f9820c1b2b6640f1a8c0` |
| `test_wiktionary_per_word_extract.py` | `307a420511f970d4794d670732efd59c02b23f04a8d39f44d44aff1e58ceaf5b` |
| `test_wiktionary_per_word_evidence.py` | `7a324dfcedbc69fb47670efd5c140c5258b95917f50efd9014cc30084e9201dc` |
| `test_wiktionary_per_word_offline.py` | `8e97c1622eadf9e2690c690e55f318bb1a38ebad8a16976de5a89f3815fdfdf1` |

## 剩余问题与跨 lane 依赖（仅建议，未改禁止文件）

0. **task 3.2 标签分类器（正式 qualification）**：usage（archaic/obsolete/rare/region/
   未知限定）的合格判定依赖后续 3.2。本 lane 完整来源读法仅作 `classification-pending`
   候选，`default_readings`/`supplemental_readings` 在分类器接入前恒为空，不冒充
   default qualified，也不提前实现第 7 组正式 approval/publication。逐条 metadata
   （usage labels、8 维 scope、真重复 ref）已全部保留等待正式 qualification。
1. **合同终态机械对齐（另一 lane）**：`Applicability` 现输出 **8 维含 `lexeme`**。
   `contracts.py` 的 `SCOPE_DIMENSIONS` 需补 `lexeme`；`contract_adapter` 的
   `observation_to_contract` 已自动带上 8 维（无硬编码），但 `ContractAlignmentTest`
   仍被 skip，须待 `contracts.py` 终态由**主编排 integration validation**启用，
   本 lane 未改 `contracts.py`/`contract_adapter.py`。
2. **CLI / collector content_type 与 JSON 跳过（独立 lane）**：`collector` 把主响应
   标为 `text/html`（body 实为 JSON），CLI `run_offline_reparse` 又 `continue` 跳过
   `application/json`。本 lane 已在 `reparse_cached_entry` 做到**按 JSON 结构分派**，
   因此主 `parse.text` 不会被误当 tocdata；但**建议**独立 lane 让 collector/CLI 使用
   准确 `content_type` 并停止无条件跳过 JSON（或统一委托 `reparse_cached_entry`）。
   本 lane 未改这两个禁止文件。
3. **未做真实在线结构验证**：提取器以合成结构夹具覆盖（design 决策 7“本阶段不联网”）。
4. **未运行真实 `--apply`**：真实 transport 与第 10 组独立采集授权不在本轮范围；
   `--apply` 校验拒绝路径仍由离线用例覆盖，但本轮**从未**以真实 transport 调用。
