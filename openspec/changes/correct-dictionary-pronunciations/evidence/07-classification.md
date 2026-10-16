# 任务 3.2 版本化分类纯函数证据（classification.ts）

本文件是 OpenSpec change `correct-dictionary-pronunciations` **任务 3.2** 的实现与
测试证据：在 2.1 已验收合同之上，`src/pronunciation-overlay/classification.ts` 提供
版本化标签规则、准入、处置、排序、安全去重与语义指纹纯函数，并以 Node + Vite SSR
离线测试。

写 scope 仅限：

- `src/pronunciation-overlay/classification.ts`
- `scripts/test_pronunciation_classification.mjs`
- `openspec/changes/correct-dictionary-pronunciations/evidence/07-classification.md`
  与 `evidence/logs/classification-*`

**未**改任何旧文件（contracts.ts / contracts.py / identity.ts / json.ts / scope /
review / Python 全部 / package / index / exports / tasks）；**未**联网、未安装、未采集、
未发布；**未勾** tasks checkbox。本 lane 只实现 3.2，不做 3.1 resolver / 发布 / 宿主 UI。

## API 概览（版本化）

- `CLASSIFICATION_RULE_VERSION = 'pronunciation-classification/3'`
- `classifyObservation(observation, options?)`：派生 accent / usage / notation /
  completeness / unknown 限制 / 资格，**不改 raw**。
- `disposeObservation(observation, options?)`：`default | supplemental | evidence-only |
  unresolved`（候选从不丢弃，`admitted: true`）。
- `buildReadingPlan(observations, options?)`：按条件分组排序、phonemic/phonetic 处置、
  regional 补充/仅地域默认；**保留原 input index 与逐条 classification**。
- `safeDedup` / `safeDedupKey`：安全去重分组（含 stale 检测）。
- `computeSemanticFingerprint`：统一正确的语义指纹 API。
- `canonicalScope` / `semanticScope` / `compareNormalize` / `deriveNotation` /
  `deriveCompleteness` / `isLayoutToken` 等纯函数与版本化规则表。
- 说明：`computeSemanticFingerprint` 与合同旧 `computeObservationFingerprint` **并列**
  存在，未改合同旧 API。

## 本次定点修复（review 8 项）

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | `buildReadingPlan` 的 `index` 被 `disposeObservation` 的 `-1` 覆盖；bucket 用首项 classification 代表整组 | `classified` 用 `{ ...disposed, index }` 保原 index；`PlannedReading` 带与 observations 一一对应的 `classifications`（per-observation metadata 不丢） |
| 2 | `collectUnknownTags` 一 token 命中 GA 就忽略整段余项 | 整段解析：按分隔符切分并移除已识别跨度，**余下 token 各自记录**（`(GA, nonstandard)` → GA + 限制 nonstandard）；显式版本化 **非限制规则表**（`enpr` 等）可 qualify，可能限制保 unresolved；raw 标签不 trim |
| 3 | `deriveCompleteness` 只看 raw 控制字符（ZWSP 实体漏判）；声明 fragment 被外形升级 | 同时检查**解码后**的控制类别；上游声明 fragment/empty/broken/control/truncated **不得**凭外形升级为 complete（需显式核验）；仅声明 complete 而外形不成立时降级 |
| 4 | `confirmedScopeDimensions` 可把 unknown role 放成 default；`requiredScopeDimensions=[]` 可绕必需 scope | confirmed 标记**不能**把 unknown 变 known/explicit-all；required 默认必需集**只能追加不能缩减**；必需 unknown 保持 unresolved；其他 unknown 保原义不扩 all |
| 5 | `semanticScope` 直接删 accent/other 致假去重；`normalizeToken` 把 `a-b`/`a_b`、opaque ID、sense 改同 | `semanticScope = canonicalScope`（**不丢任何维度**）；scope 身份值用 `compareNormalize`（仅实体+NFC+边界 trim，不 lower/不移标点）；去重键含完整 8 维 + notation + **completeness** + 语义限制 + **raw 派生 IPA**；`normalizedIpa` 与 raw 不一致（stale）不参与合并 |
| 6 | region-unspecified 置于 UK/US 后致 `UK,regional` 仍 uk-unspecified；`RP+regional` 冒 RP；多标准名取首个假 RP | 地域（含 regional-unspecified）**优先于** UK/US；标准+地域冲突 → `unknown('conflicting-standard-region')`；多标准名 → `unknown('multiple-standard-accents')` 并保留全部原 label；`rawLabels` 保原标签（如 `Scottish`） |
| 7 | `isLayoutToken` broad-prefix（`inflection`/`metadata`/`template`/`mw-`）吞可能的 grammar 限制 | 改为**精确已确认 layout 表** + 谨慎前缀（仅 `mw-`/`mw_`/`heading:`）；`inflection-grammar`/`metadata-x`/`template-param` 不再当 layout |
| 8 | phonemic 优先条件、regional-only 判定、rare/archaic 边界 | phonemic 优先仅**同 derived accent + 完全相同 scope**（unknown 非可比等价）且均合格；regional-only 默认仅**同 identity（entry/lexeme/role/pos/sense/language）内无 general**；rare 同地域规则；archaic/obsolete 仅 supplement 且保原 metadata；非法范围/未知限制保 unresolved 解释，不误 qualified |

## 本轮定点修复（review 第二轮 5 项）

| # | 问题 | 修复 |
| --- | --- | --- |
| ① | 声明 `notation:'unknown'` 而 raw 可配对时仍被猜成 phonemic / default | final notation 综合声明与 raw：声明 unknown → 保 unknown（不猜）→ `evidence-only`；raw 无法配对而声明已知 → 保 unknown 且 `notationConflict`；两者已知但冲突 → 保 raw 派生并 `notationConflict` → `unresolved`（绝不 upgrade） |
| ② | `scope.accent` known `['GA, nonstandard']` 无 raw tags 时吞掉 leftovers → default | scope accent 与 raw qualifier 走**同一整段解析**（含 leftovers），未知限制记录并去重；`nonstandard` → `unresolved` |
| ③ | `rawTags:['mw-dialect-only']` 被 `mw-` 前缀当 layout 吞掉 → default | 移除 `mw-` broad-prefix，改**精确已确认 layout 表**（`mw-parser-output`/`mw-heading`/`mw-editsection` 等）；仅保留 `heading:` 前缀；`mw-dialect-only` → unknown → `unresolved` |
| ④ | `other: unknown('possibly only a restricted grammatical construction')` 被当 none → default | `other` 纳入默认必需维度：unknown → `scope-unresolved:other`（不解析 reason 文字猜条件、不当 all）；明确无限制用 `known` 或 `explicit-all`（带证据）才可 default |
| ⑤ | 未注明 accent（accent unknown/unspecified）下 `/x/`+`[x]` 仍被 phonemic 压制为补充 | phonemic 优先仅当 **accent 确定为具体口音（standard/uk/us/regional）且同完整 scope**；unspecified/unknown accent 下两种 notation **各自保留完整**（均 default），不假“相同已确定口音” |

另：`computeSemanticFingerprint` 改用 `fingerprintScope`——保留每维 **kind 状态**与 known 取值，
但**不纳** unknown 的 reason 措辞、不纳 explicit-all 的 evidence 引用；因此未知↔已知、
known 取值、other 限制状态变化触发，而措辞/引用变化不触发。`safeDedupKey` 仍用完整
`canonicalScope`（含 reason/refs）以保持严格“保证据”。

### ④ 的设计取舍（明确报告，未私缩）

合同三态 scope 没有“明确无其他限制”的专用标记；`unknown(reason)` 与“潜在限制的 unknown”
结构相同，若按 reason 文字判断即属“猜条件”。因此本 lane 采取保守模型：**`other` 为 unknown
即 unresolved**，要求来源/3.1 用 `known`（如 `no-other-restriction`）或 `explicit-all`（带证据）
显式表达“无额外限制/全范围”才进 default。正面（无其他限制的未注明口音）可由来源资格在
此模型下 qualify，但**正式 `scopeEligibility` 不覆盖未确认限制**。此前把
`unknown('no-qualifier')` 当 none 的测试模型已修正为错误模型。若后续认为需要合同级
“无限制”标记，应由合同/3.1 lane 提供，本 lane 不私自塞默认或解析 reason。

## 规格对照（design 决策 4）

- 标准/通用：RP / Received Pronunciation / Received-Pronunciation → `RP`；SSB 独立；
  GA 变体 → `GA`；多标准冲突不合并。
- 未细分 UK/US：仅无进一步地域时成立；有地域（含 regional-unspecified）不升通用。
- 地域：Scotland / Northern England / Southern US / Australia… 保原名；`regional`/`dialectal`
  →「地域未细分」。
- 无口音：`unspecified`，单份，不复制 UK/US。
- 使用状态：rare 可默认；archaic/obsolete 仅补充；其他标签不冒充。
- 转写：完整 `/.../`=phonemic、`[...]`=phonetic；同 accent + 同 applicability 才
  phonemic 优先 phonetic；仅合格 phonetic 可默认并保 `[]`。
- 完整性：片段/空/坏定界/控制（raw 与解码后）/截断 → evidence-only，不靠字符白名单。
- 未知标签：显式非限制规则可 qualify 并保 unclassified；可能限制保 unresolved，不硬排、不通配。
- 去重：同证据 + 完整 scope + notation + completeness + 语义 qualifiers/tags 限制 + IPA。
- 指纹：全部 8 维含 unknown 状态与 other 限制；layout 不触发；IPA/accent/scope/usage/unknown 触发。

## 测试 / lint / typecheck

| 命令 | 日志 | 退出码 |
| --- | --- | --- |
| `node scripts/test_pronunciation_classification.mjs` | `logs/classification-test.log` | 0（30 checks OK） |
| `eslint src/pronunciation-overlay/classification.ts scripts/test_pronunciation_classification.mjs --max-warnings 0` | `logs/classification-eslint.log` | 0 |
| `tsc -p tsconfig.app.json --noEmit` | `logs/classification-typecheck.log` | 0 |

退出码汇总见 `logs/classification-exit-codes.txt`。

测试覆盖（含两轮修复的决定性 negative）：版本/规则表；RP 变体、SSB 独立、GA 变体；
UK/US 有地域不升通用（含 UK+regional）；地域名与「地域未细分」、`rawLabels` 保原样；
未注明口音单份；rare 默认 / archaic obsolete 补充；未知标签三种处置（限制 unresolved、
显式非限制 qualify、已知限制不冒充）；整段限定 `(GA, nonstandard)` 余项解析；**声明 unknown
notation 不猜、声明/raw 冲突不 upgrade**；**scope accent 整段解析含 leftovers**；**`mw-*`
语义 class 不当 layout**；**`other` unknown 不当 none、known/explicit-all 才 default**；
**unspecified accent 不假 phonemic 优先、确定 accent 正例才优先**；notation 与 completeness
全枚举（含 decoded 控制、声明非 complete 不升级）；片段/空/控制/截断 evidence-only；
phonemic 优先/仅 phonetic 默认/不同 accent 不互配；plan 原 index 与逐条 metadata；regional
决策按 identity 隔离；scope unknown unresolved、严格三态、confirmed 不绕过、required 不可
缩减、explicit-all；安全去重真重复/跨 scope/evidence/accent/usage/completeness/精确身份
（`a-b`≠`a_b`）/stale；语义指纹触发与 layout/实体/NFC/trim 不误报、**unknown 措辞与
explicit-all refs 不误触发**、状态与限制变化触发；raw 原值（含实体、标签不 trim）；
`isLayoutToken` 谨慎；冲突/多标准 accent；JSON 可序列化；8 维覆盖。

### 文件 sha256

| 文件 | sha256 |
| --- | --- |
| `src/pronunciation-overlay/classification.ts` | `b45f8f7dc875c6f8cedd13528001a0e5e1391779ebe0cf104db6224b9f09f8b6` |
| `scripts/test_pronunciation_classification.mjs` | `49c8e096df6fbfbfaec0939c332b3d0cda008436d607bc1b1c15e7cffd7d5b88` |

## 集成点与限制（报告，不改旧文件）

- **合同旧指纹 API 集成点**：`contracts.computeObservationFingerprint` 仍把**全部
  rawTags** 纳入 hash 且 qualifier 未 normalize，会因 layout class 变化误报、并因 qualifier
  entity/NFC 差异误报。本 lane 不改它，提供 `computeSemanticFingerprint`（其 scope 用
  `fingerprintScope`：状态+known 值，忽略 unknown 措辞与 explicit-all refs）。**后续
  3.4 / 6.4 集成应统一到本 API**，届时由相应 lane 处理，不在此静默改动。
- **scope 解析（3.1）未实现**：分类只读取最终 scope 三态；`confirmedScopeDimensions`
  不能把 unknown 放开（无证据不得默认 true）。未确认的必需维度（含 `other`）保守
  `unresolved`；`other` 的未知限制不得当 none（见 ④ 设计取舍）。
- **非限制标签规则表**为版本化显式 allowlist；未列入的非 layout 标签保守 `unresolved`
  （不硬排、不通配），待别名/规则版本更新后重新生成候选。
- 本 lane 不做 resolver / 发布 / 宿主 UI；真实采集/发布不在本轮。task 3.3 仍为后续。
