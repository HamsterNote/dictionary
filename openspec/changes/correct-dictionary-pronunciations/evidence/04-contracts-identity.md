# 合同与身份证据（小阶段 A 合同恢复 + 小阶段 B 身份恢复）

> **重要更正**：本文件更早版本宣称任务 2.1–2.4 全部完成，属于**历史未验收声明，不实**。
> 主编排复核发现合同与身份实现存在多处缺口（无效 scope 夹具、身份引用、坏引用、createdAt、
> 指纹规范化、split 唯一性、scope.entry 重映射、生命周期不变量等）。
> 随后按授权分两小阶段修复：**小阶段 A** 仅 JSON 合同（见下 A–G）；**小阶段 B** 身份
> （见下 H）。即便两阶段均绿，也不等于 2.2–2.4 全体验收；`tasks.md` **2.1 已由主编排验收勾选**，
> **2.2–2.4 仍未勾选**，由主编排最终验收。本文件不是发布或采集证据，不含真实来源数据。
> 子阶段 A 允许写入的 `contracts.ts`/`json.ts`/`contracts.py` 在子阶段 B 中**未再改动**。

## A. 本轮授权与边界

- 授权：用户明确「继续离线修复」，仅限小阶段 A。
- **允许写入**：`src/pronunciation-overlay/{contracts,json}.ts`、
  `scripts/wiktionary_per_word/contracts.py`、`scripts/test_pronunciation_contracts.py`、
  新增 `scripts/test_pronunciation_contracts.mjs`、本 evidence 文件与 `contracts-recovery-*.log`。
- **明确禁止**：`identity.ts`、`test_pronunciation_identity.mjs`（留小阶段 B）、
  其他 Python 模块（fix4/fix5 lane）、`tasks.md`、`package.json`、旧数据；不勾 2.x。
- 零网络、零安装、零采集、零发布；`node_modules` 为同 commit 本地 symlink。
  所有来源均为**合成夹具**（`synthetic`），不捏造真实 IPA。

## B. 本轮交付文件

| 文件 | 说明 |
| --- | --- |
| `src/pronunciation-overlay/contracts.ts` | 合同校验：createdAt 保效、known entry/lexeme 引用、规则生命周期引用、指纹规范化 |
| `src/pronunciation-overlay/json.ts` | 规范化 JSON + FNV 指纹（非加密；仅格式规范，无逻辑变更） |
| `scripts/wiktionary_per_word/contracts.py` | 与 TS 对齐的 Python 读取/校验合同 |
| `scripts/test_pronunciation_contracts.py` | Python `unittest`（19 项，含新增负例） |
| `scripts/test_pronunciation_contracts.mjs` | 新增 Node `assert` + Vite SSR 测试，并与 Python 对**同一夹具 JSON** 交叉对照 |
| `evidence/logs/contracts-recovery-*.log` | 实际运行日志 |

## C. 本轮合同修复点（TS 与 Python 已对齐）

1. **createdAt 可缺失且保效**：`PronunciationRule.createdAt` 改为可选；缺失时必须给
   非空 `createdAtUnknownReason` 且 `reviewStatus === 'pending-review'`，不得伪填今天；
   同时声明两者、或空字符串 createdAt 均被拒。
2. **8 维 scope 含 `lexeme`**；`known` / `explicit-all` / `unknown` 三分；unknown 不得当
   explicit-all、explicit-all 必须带证据；空证据或坏项被拒。
3. **空 IPA 观测可保存为证据但非默认**：`rawIpa` / `normalizedIpa` 允许空字符串，仅表示
   可保留证据；本合同层不以 `[]`/空串宣称合格读法（默认选择属后续 lane）。
4. **known 维度引用真源**：`identityEntryIds` / `identityLexemeIds` 必须为对应前缀的不透明 ID
   且无重复；scope 的 `known entry` / `known lexeme` 取值必须引用已声明身份，否则
   `dangling-reference`。`lex-test` 这类非不透明 ID 一律拒绝。
5. **可选列表不得静默 `[]`**：`identityLexemeIds` / `displays` 若存在非数组直接拒绝；
   必需列表缺失仍拒绝；`null` / primitive 输入稳定返回不 throw。
6. **规则生命周期坏引用**：重复 `ruleId`、坏 `supersedesRuleId` / `revokedByRuleId`、
   自引用均被拒。
7. **结果层坏引用**：`resolved.fieldProvenance` 按 `source` 校验（user/system→规则，
   qualified-source→观测，legacy→证据/观测/规则），`suppression.ruleId` 必须指向存在的规则。
8. **检查点 / 投影坏引用**：`checkpoint.lastCompletionEvidence` 必须指向存在的证据；
   `manifest.compatibleProjection[].entryId`、`perEntryResultVersions`、`manifest.approvalId`
   必须指向已声明身份。
9. **许可与版本精确**：Wiktionary 衍生证据必须 `CC-BY-SA-4.0` 且 `shareAlike`；manifest/approval
   的各层版本字段必须等于当前常量。
10. **观测语义指纹规范比较**：`computeObservationFingerprint` 先对 IPA 解码 HTML 实体、NFC、
    去边界空白后比较（原值完整保存、不改 raw）；边界空白/实体/NFD 等价不误触发，
    而 `notation` / `rawQualifiers` / scope / 真实 IPA 变化必须改变指纹。

> `json.ts` 的 FNV-1a 64 是**一般内容指纹、非加密**，不能充当批准用的加密 hash；
> 后续 publication 的候选身份须另用 SHA256（Python 侧 `document_fingerprint` 为 sha256）。
> 本轮未实现 publication，仅记录该边界。

## D. TS ↔ Python 交叉对照

`scripts/test_pronunciation_contracts.mjs` 将 19 份夹具（1 合法 + 18 负例/边界）以 JSON 交给
同一目录下的 `contracts.py`，逐项比较 **TS 与 Python 的 valid 结论必须一致**；同时 Python 测试
解析 `contracts.ts` 的 `PRONUNCIATION_SCHEMA` 常量核对版本一致。任何一侧结论不一致即 fail。

## E. 真实运行日志

| 命令 | 退出码 | 日志 |
| --- | --- | --- |
| `node scripts/test_pronunciation_contracts.mjs` | 0 | `logs/contracts-recovery-node.log`（`test_pronunciation_contracts: OK`） |
| `python3 scripts/test_pronunciation_contracts.py` | 0 | `logs/contracts-recovery-python.log`（Ran 19 tests, OK） |
| `COREPACK_ENABLE_STRICT=0 pnpm run typecheck` | 0 | `logs/contracts-recovery-typecheck.log` |
| `COREPACK_ENABLE_STRICT=0 pnpm exec eslint …` | 0 | `logs/contracts-recovery-eslint.log`（空） |

> `pnpm exec prettier --write` 已对允许的 TS/JS 文件规范化（`json.ts` 原本亦非 prettier 格式）。
> Python 文件不经 prettier。未运行 build / 已有 5 个 `test:*`（合同阶段未触及查询/数据路径）。

## F. 明确未完成 / 待小阶段 B（身份）

- `identity.ts`、`test_pronunciation_identity.mjs` **本轮完全未改**。
- 既有 `scripts/test_pronunciation_identity.mjs` 当前会 **fail**：其合法夹具使用非不透明
  `lex-test` 作为 scope lexeme，被本轮新增的 known-lexeme 引用校验正确拒绝。该夹具修正与
  身份实现修复同属小阶段 B。
- 身份阶段待处理（原始复核清单，未在本轮声称完成）：entry 工厂接受 `lex_` 前缀 ID、
  merge/split 未重映射 `scope.entry`、split 唯一性仅计 compatible、交集匹配放大范围、
  `shareRoleEvidence` 只查 role、`establishRead` 复用未排除 retired / 无据铸造 lexeme、
  别名 pending/locator language-role 兼容、生命周期不变量等。
- `tasks.md` 的 2.1–2.4 **保持未勾选**；小阶段 A 不等同 2.1 整体验收，最终由主编排复核。

## G. 环境

- `node_modules` 同 commit 本地 symlink；`pnpm` 经 `COREPACK_ENABLE_STRICT=0`。
  Python 3.14 直接 `python3`，无需 uv/安装。
- 无阻塞；未发现需要改变规格/架构的歧义。

---

## H. 小阶段 B：身份恢复（含定点修复）

> 授权：仅 `src/pronunciation-overlay/identity.ts`、`scripts/test_pronunciation_identity.mjs`、
> 本 evidence 与 `identity-recovery-*.log`。**未改** 子阶段 A 的合同文件与其余模块。
>
> **定点复修复 2（oracle 实测拒 2.2–2.4）**：
> - **H.1#6/H.2 复用资格**：新建 entry 与所属 lexeme 的 `synthetic` class 必须一致（缺省 false）、
>   `synthetic` 必须是真布尔；`findLexemeForSpelling/findActiveRoleEntry` 直接校 **lexeme 自身**的
>   language/synthetic（不接受假布尔强转）；validator 同校（`lexeme-language-mismatch` /
>   `lexeme-synthetic-mismatch`）。real lexeme + synthetic entry 混标 registry 非法，read 亦不得复用。
> - **H.1#7 共享目标范围**：`buildTargetScopeForRole` 保留 `entry.applicability` 已有的 sense/accent/other
>   （known/explicit-all/unknown），权威 language/entry/lexeme/role/POS 覆盖并校验原 scope 不矛盾；
>   entry.applicability 已有 sense reading/accent US 时，source 精确 8 维 multi-role 必须共享。
> - **H.1#8 别名历史**：新增 `SourceAliasStatus='historical'`。merge/split 把指向被 retired 条目的旧 alias
>   标为 historical（保留 locator/evidence，不删除审计），使 API 输出自身不被 validator 拒；普通
>   confirmed/pending 目标必须 active，historical 允许 retired。validator 强制所有状态 evidenceRefs
>   非空非空白、role 合法、scopePath 为字符串数组、精确 locator 重复/冲突。
> - **H.1#5 split 持久化**：successor `applicability.entry` 必须为单个旧 predecessor ID，persist 时重映射为
>   新 successor ID（其他维原样）；非 single old 或 language/lexeme/role/POS 与 successor 权威字段矛盾 →
>   fail closed（throw）。input scope 仍用于迁移比较。
> - **H.1#2 merge 下限**：注入 matcher 只能收紧；即使 custom `migrate:true`，internal default gate 对
>   partial/unknown/conflict 仍判 unresolved。
> - **H.1#4 history 深校验**：action/reason/非空非空白 evidence/from-to 非空且为不透明 ID；
>   每条 decision 校验 correctionId/migrate 真布尔/previousTarget/previousScope 八维/previousFingerprint/
>   resultingTarget/dimensions.result 枚举；migrated/unresolved 列表与 decisions 一致，migrate 目标 ∈ toIds、
>   不迁 resultingTarget == previousTarget；`decisions=[{}]` 与列表不一致均被拒，合法生成往返通过。
>
> 说明：`SourceAliasStatus='historical'` 是身份生命周期内的**最小 API 增补**（落实「显式历史状态、保留
> locator 可追溯、不自动迁移 alias」），未改变 spec 语义；如主编排认为属实质设计变更请以此为准复核。
> 2.3 的**实际 correction resolver（3.3）尚未实现**，本轮 `displayIpaRefs` 仅用于四 role 身份独立性测试，
> 不代表完整纠错达标。
>
> **定点复修复 1（主编排 Vite SSR 实测 3 漏洞）**：
> - **H.1#6 复用资格收紧**：只有 active、同 `synthetic`、`partOfSpeech === 'verb'` 且有身份证据的
>   条目才算合格 verb 身份；noun / retired/merged / 无据 / synthetic 混标一律排除。`findLexemeForSpelling`
>   多个合格 lexeme、`findActiveRoleEntry` 同 role 多候选均 `throw`（不 first）。`partOfSpeech` 入参
>   非 `verb` 直接被拒（不得把 read 四 role 造成 noun）。
> - **H.1#7 共享证据**：删除「单候选直接 chosen」的旁路；对**每条候选（含唯一）**用 entry 权威字段
>   （language/entry/lexeme/role/POS，其余 unknown）构造真实 target 范围并**逐 8 维**要求「target ⊆ 证据」，
>   `entry` 维不再被 `MIGRATION_DIMENSIONS` 排除，必须覆盖真实 target ID；role 维按选中 role 限定比较
>   （来源 explicit multi-role 仍可分享）；目标 unknown/仅部分 → ambiguous，双方 known 全不相交 → disjoint；
>   多候选需「恰一个 covered 且其余确定 disjoint」才唯一。
> - **H.1#8 别名入口统一**：`addSourceAlias` 相关 locator（同 site/language/spelling/role、不同 anchor/路径）
>   改为 `pending-review`（返回 `review-required`），与 `reconcileSourceAlias` 一致；重复 pending 不回
>   confirmed；`reconcileSourceAlias` 对精确 locator 但 `anchorChanged=true` 不得捷径直返 confirmed，须转
>   pending 待核；`confirmSourceAlias` 拒绝空/空白/坏 evidence ref（`missing-evidence`），无实质新证据不得
>   冒充 confirmation。
> - **H.2 新增测试**：noun/多合格 lexeme/partOfSpeech noun/synthetic 混标、单候选不匹配、一 covered 一
>   unknown 多候选、addSourceAlias 相关 locator pending、reconcile 精确 anchorChanged、空白确认证据、
>   4 role 别名序列化/反序列化往返各自存活。

### H.1 修复点（identity.ts）

1. **工厂 strict**：`createEntry` 只接受 `ent_` 前缀不透明 UUID、`createLexeme` 只接受 `lex_`；
   `entry` 语言必须与所属 `lexeme` 一致；别名/evidenceRefs/role/partOfSpeech/applicability
   等可选字段非法即抛（fail closed）。
2. **merge/split `scope.entry` 有据重映射**：仅当纠错 `scope.entry` 恰为**单个旧 ID** 时替换为
   新目标，其他维度原样保留；多值/非 known 一律不迁（不放大、不缩小未覆盖条件）。
3. **历史审计持久**：`IdentityRegistry.history` 保存每次 merge/split 的旧 target/scope/
   fingerprint 与逐条 decisions，不依赖易丢失的临时 `audit` 返回值。
4. **完整覆盖语义**：`evaluateScopeCompatibility` 改为「来源取值被目标**完整覆盖**」才
   `compatible`；交集非空不算；目标 `explicit-all` 视为覆盖；部分相交/unknown 一律不迁。
5. **split 唯一性**：仅当恰一个后继完整覆盖且**其他后继均确定 disjoint**时迁移；同 role 但
   unknown sense 的第二后继存在则不迁；两个后继都覆盖不迁；无证据不迁。
6. **`establishRead` 复用资格**：只复用合格 active verb 身份（见上「定点复修复」）；多个合格
   lexeme 与同 role 多候选报错；`evidenceByRole` 逐 role 或显式 `multiRoleEvidence` 才建角色；
   **无证据不铸造 lexeme**；synthetic/真实严格区分；`partOfSpeech` 只能为 verb。
7. **`shareRoleEvidence` 完整 8 维核对**（见上「定点复修复」）：不取 first、unknown 非 wildcard、
   entry 维覆盖真实 target、方向为 target ⊆ 证据、多候选需唯一。
8. **来源别名**（见上「定点复修复 1/2」）：locator language/role 必须兼容；相关 locator 变化一律 pending
   保旧；pending 不退 confirmed；确认须非空非空白**实质新**证据；不兼容目标 `invalid`；
   merge/split 把指向被 retired 条目的旧 alias 标为 `historical` 保留审计。
9. **生命周期不变量**：`active` 不得带 redirect/successor/retiredReason；`retired` 必须
   恰好带 `redirectTo` 或 `successorIds` 之一且带 `retiredReason`；链式 redirect 可追溯（不再
   一律拒绝 retired 目标）；redirect 不得指向 split 一对多；redirect / successor 环均检出；
   byId 键前缀与 kind 一致；entry↔lexeme language/synthetic 一致；重复/冲突 locator 检出。
10. **split 持久化 successor 范围**：`applicability.entry` 单个旧 predecessor ID → persist 时重映射为新
    successor ID，其他维原样；非 single old 或权威 language/lexeme/role/POS 矛盾 → fail closed。
11. **merge 下限**：注入 matcher 只能收紧，internal default gate 对 partial/unknown/conflict 始终 unresolved。
12. **history 深校验**：完整字段/枚举/ID/列表一致性校验；`decisions=[{}]`、列表不一致被拒，合法生成往返通过。

### H.2 测试（test_pronunciation_identity.mjs）

- 夹具 `lex-test` 已改为**真实持久 `lex_` UUID** 并加入 `identityLexemeIds`（非绕开校验）。
- 覆盖 H.1 全部 negative：split 歧义/双覆盖、merge 部分相交与多值 entry、scope.entry
  重映射、history 持久、read 排除 retired/多合格 lexeme/noun/synthetic 混标/`partOfSpeech=noun`、
  无据不铸、共享证据单候选不匹配 + unknown/lexeme/lang + 多候选一 covered 一 unknown、
  别名 pending/兼容/重复/空白确认/精确 anchorChanged、生命周期与环。
- 复修复 2 新增：entry/lexeme synthetic 一致性（工厂 + validator + 复用）、real lexeme+synthetic entry
  混标拒、`entry.applicability` sense/accent 保留时精确 8 维共享、共享目标 sense 冲突拒、
  split successor applicability 重映射 + 非 single old/权威矛盾 fail closed、merge 注入 matcher 收紧、
  history 深校验（`decisions=[{}]`/列表不一致拒 + 生成往返通过）、merge 后旧 alias 转 historical 且
  locator 保留、confirmed 指向 retired 拒、非法 role/scopePath 拒。
- 四 role 分别设置不同 `displayIpaRefs` 验证互不覆盖；相同 IPA 不合并 ID；
  4 role 别名序列化/反序列化往返各自存活。

### H.3 实际日志

| 命令 | 退出码 | 日志 |
| --- | --- | --- |
| `node scripts/test_pronunciation_identity.mjs` | 0 | `logs/identity-recovery-identity.log` |
| `node scripts/test_pronunciation_contracts.mjs`（回归） | 0 | `logs/identity-recovery-contracts-node.log` |
| `python3 scripts/test_pronunciation_contracts.py`（回归） | 0 | `logs/identity-recovery-contracts-python.log`（Ran 19） |
| `pnpm exec eslint`（本 lane 文件） | 0 | `logs/identity-recovery-eslint.log`（空） |
| `pnpm exec prettier --check`（本 lane 文件） | 0 | 已规范化 |
| `COREPACK_ENABLE_STRICT=0 pnpm run typecheck`（**全项目**） | **0** | `logs/identity-recovery-typecheck.log` |

> 全项目 `pnpm run typecheck` 现已 **exit 0**（此前并行 lane 文件 `classification.ts`/`review.ts`/
> `scope.ts` 的报错已由对应 lane 修复；本 lane 未触碰这些文件）。本 lane `identity.ts` 全程零 typecheck 错误。

### H.4 仍欠（不声称 2.2–2.4 全完，由主编排验收 2.x）

- 本轮为**身份最小可信 subphase**：覆盖身份/生命周期/别名/四角色/merge-split 核心不变量与
  共享证据。以下仍属后续 lane、未在本轮实现：基于真实来源的 identity 证据生成、真实页面锚点
  持久化往返、merge/split 与后续 scope/resolve/v1/UI/publication 的联动。
- `tasks.md`：**2.1 已由主编排验收勾选**；**2.2–2.4 仍未勾选**（本 lane 不写 tasks）。
  真实批准/发布/采集不在本轮。
