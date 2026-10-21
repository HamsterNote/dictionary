# 任务 3.1 / 3.4 范围匹配与复核纯函数证据

本文件是 OpenSpec change `correct-dictionary-pronunciations` 中 **task 3.1（known/explicit-all/unknown
及 comparable/disjoint/unresolved 匹配与理由码）** 与 **task 3.4（六个日历月复核与相关语义变化提前
提醒、事件分离）** 的实现证据。属**可独立纯函数 lane**，只离线实现两个新模块 + 一个 Node 测试脚本。

> **不勾 tasks**：本 lane 只交付 3.1 / 3.4 的纯函数与单元证据，第 3 组整体验收与逐项勾选由主编排
> final validation 决定。不声称第 3 组已完成。

## A. 授权与写入边界

- **允许写入（本 lane 实际改动）**：
  - 新增 `src/pronunciation-overlay/scope.ts`（task 3.1）
  - 新增 `src/pronunciation-overlay/review.ts`（task 3.4）
  - 新增 `scripts/test_pronunciation_scope_review.mjs`
  - `openspec/changes/correct-dictionary-pronunciations/evidence/06-scope-review.md`
  - `openspec/changes/correct-dictionary-pronunciations/evidence/logs/scope-review-*`
- **明确未改（尊重其他 writer active 的 lane）**：
  `src/pronunciation-overlay/{contracts,json,identity,classification}.ts`、全部 Python 模块与测试、
  旧 `src/data`、既有 `tests`、`package.json`、`tasks.md`、导出面。
- **零网络、零安装、零采集、零发布**：测试经本仓库既有 `vite`（`node_modules` 同 commit 本地
  symlink）SSR 加载 TS + Node `assert/strict`；全部夹具 synthetic，不捏造真实 IPA。

## A2. 主编排复核修复轮（本轮，5+1 实质边界）

主编排对上一版 `scope.ts`/`review.ts` 零网复现 5 项实质边界（+1 项相关）后，本 lane **同 scope 定点修**，
未改 contracts/json/identity/classification/Python/package/tasks，未扩架构。逐项：

| # | 复现缺口 | 修复 | 回归用例 |
| --- | --- | --- | --- |
| 1 | `diffRelatedSemantics` 用 `evidenceId` 判关联：同来源新 render/IPA 变化必铸新 evidenceId，old→new 且 IPA 不同被误判无关 | 改用**明确稳定 `associationKey`**（页/条目/调用方明确关联标识，非 revid/时间/hash）判关联：同键即使 evidenceId 变也比对规范化指纹/实质 scope；明确不同键不触发；**缺键不凭新 evidenceId 判无关**，保守 `unknown` 提示且不降级。`evidenceId` 明确降为不参与判定 | B5：同关联 evidenceId 变 + IPA 变 → 触发；同关联 evidenceId 变语义不变 → 不触发；不同关联键 → 不触发；缺键 → `unknown` + `related:true` |
| 2 | `evaluateReviewStatus` 初始 `active` 会清掉既有 `pending-review`/`due`（实测 created 10-01、pending 在 10-12 变 active） | 以**规则当前状态**为基准：既有 `pending-review`/`due` 一律保持，只有明确核验才清除；未来到期/普通事件不清 `due`；非法 `context.now` 不字符串 fallback 伪造到期 | B4b：pending 在到期后仍 pending；未到期不把 due 清回 active。B4c：`now:'not-a-time'` 不判 due 且记理由 |
| 3 | `hasExplicitConfirmation` 用 truthy：`confirmed:'false'`、`actor:' '`、`at:'not-a-time'`、`reason:' '`、`auditRef:' '` 竟 applied true | 严格 `confirmed === true` + actor/reason/auditRef **trim 非空** + `at` 合法 UTC；替代 ID 非法/空白/**自引用**拒；已撤销/替代不无谓更改；撤销/替代/核验返回**结构化 `ReviewAuditRecord`**（ruleId/action/actor/at/reason/auditRef/supersedingRuleId） | B7/B8：字符串 `'false'`、空白、非法时间全部拒；自引用/空白替代 ID 拒；合法返回 audit；重复撤销拒绝 |
| 4 | matcher 不实际校验：空 `explicit-all.evidence`、空 `known.values` 直接 comparable 绕验证；空 `dimensions` 可 vacuous 等价 | 公开 `matchApplicabilityScopes` **先经既有 validator fail closed**（无效抛含理由的 `Error`）；空维度抛 `RangeError`；`wholeScope`/`comparedDimensions` 标记；`isExactScopeMatch` 仅整八维全 exact/all-both 为真，局部比较（≥1 维）仍可用于 migration 但**不构成整 scope 等价/全覆盖** | A8：4 类无效 scope + 缺维度抛错，空维度抛 RangeError。A9：局部比较 `wholeScope:false`、`isExact:false`；整八维相等 `isExact:true` |
| 5 | `parseUtcInstant` 用 `T.*` + `Date.parse`：接受 offset/无 Z 却按原日期保留 offset，日历月算错（如 `2026-08-31T23:00:00-05:00` +6 应为 UTC 3/1） | 仅接受 `YYYY-MM-DD`（UTC 零点）或 `YYYY-MM-DDTHH:MM:SS(.sss)?Z`，**拒时区偏移与无 Z**；校验年 1–9999/月/真实日/时钟；`months` 必须有限整数；年份越界抛错；非法 `context.now` 不伪有效 | B1：offset/无 Z/时钟 25:00/10:60/月 13/年 0000/`months` 6.5·NaN·Infinity 全部抛 RangeError |
| 6 | `scopeSemanticKey` 把 explicit-all 证据 refs、unknown 原因措辞纳入语义键，误判 scope 变化 | explicit-all 统一作 `explicit-all`（**证据 ref 变化不改范围语义**）；unknown 统一作 `unknown`（**措辞变化非范围语义变化**）；布局/来源证据实质变动由**注入的分类 fingerprint** 负责 | B5：all 证据 ref 变、unknown 措辞变均**不触发**；known 取值变仍触发 |

> 第 6 项接线说明：正式 classification semantic API 的**接线测试需等 fix4 lane 终态**，本 lane
> **不改** `classification.ts`，本轮用**注入 fixtures** 验证关联/指纹语义；集成项在 F 节如实列出。
> 本轮**未勾 3.1/3.4**，未重跑无关既有 tests，未升级任何授权。

## B. task 3.1：`scope.ts` 的设计与保证

匹配在**八个维度** `language / entry / lexeme / role / pos / sense / accent / other` 上逐维进行，
产出整体 `comparable | disjoint | unresolved` 与逐维理由；不重复实现范围校验，直接复用 contracts 的
`validateApplicabilityScope`。

| 约束 | 实现 |
| --- | --- |
| known 取值无交集 → `disjoint` | 双方 known 且 `leftOnly`、`rightOnly` 同时非空、交集为空时该维 `disjoint` |
| 有交集**不假**整 scope 等价 | 交集非空但互不包含 → `overlap`（`comparable`），并暴露 `shared`/`leftOnly`/`rightOnly`；`isExactScopeMatch` 仅整八维全 `exact`/`all-both` 为真 |
| `comparable/disjoint/unresolved` + 精确信息 | 每维给 `relation ∈ {exact,left-subset,right-subset,overlap,disjoint,all-covers-left,all-covers-right,all-both,unresolved}`，供后续逐范围 resolve，不放大覆盖 |
| unknown **不是** wildcard | 任一方 unknown → 该维 `unresolved`，绝不判为等价或不相交 |
| explicit-all 只作**证据**、非缺省 | `explicit-all`（须带证据，由 validator 保证）单独建模为覆盖关系（`all-covers-*` / `all-both`），缺失字段仍为 unknown |
| **fail closed 校验** | `matchApplicabilityScopes` 先经既有 `validateApplicabilityScope`；空 `known.values`、空 `explicit-all.evidence`、缺维度、unknown 当全范围等一律抛 `Error`（含理由），绝不返回 comparable；空 `dimensions` 抛 `RangeError` |
| 局部维不冒充整 scope | `wholeScope`/`comparedDimensions` 明确标记；局部比较仍可用于 migration，但 `isExactScopeMatch` 只有在比较全部八维时才可能为真 |
| 任一确定 disjoint 即整体 disjoint | 只要存在 `disjoint` 维，整体即 `disjoint`，其余 unknown 不改变结论 |
| past 不互推 participle | 只按 scope 维度匹配；`role` 的 `past` 与 `past-participle` 是不同 known 取值 → `disjoint` |
| 不从 IPA / word / translation 推身份 | 匹配 API 只接收 scope，无任何 IPA/拼写/释义输入 |

导出：`matchApplicabilityScopes`、`isExactScopeMatch`、`isDisjointScopeMatch`、
`isUnresolvedScopeMatch`、`validateScopeMatchInputs`、`describeScopeMatch` 及类型。
**未修改 contracts**；本模块自身导出类型。

### 与既有 `identity.evaluateScopeCompatibility` 的关系（未改 identity）

`identity.ts` 的 `evaluateScopeCompatibility` 面向 **merge/split 迁移的「left ⊆ right 完整覆盖」**
语义，返回 `compatible/conflict/unknown`。task 3.1 需要的是**通用双 scope 关系**（含 `overlap` 精确
信息与整体 `comparable/disjoint/unresolved`），语义不同，故本 lane 独立实现而不改 identity；
两者互不调用，避免把迁移覆盖语义误当作通用匹配。

## C. task 3.4：`review.ts` 的设计与保证

| 约束 | 实现 |
| --- | --- |
| 六个 UTC 日历月，月末裁剪 | `addCalendarMonthsUtc`：Jan 31 + 6 = Jul 31；Aug 31 + 6 = 次月最后一天（非闰 2/28、闰 2/29）；保留时分秒；**仅接受 date-only 或带 `Z` 的 UTC**（拒不接受 offset/无 Z，避免按 offset 算错）；`months` 须有限整数；非法日期/时钟/月份/年份越界抛 `RangeError` |
| 基准 `lastVerifiedAt` 否则 `createdAt` | `computeReviewTiming` 优先 `lastVerifiedAt`，其次 `createdAt` |
| 无 timestamp：不填今天、待复核、仍有效 | 基准 unknown → `dueAt` 为 undefined、状态 `pending-review`、`priorityPreserved` |
| 到期/相关变化**不降级、不撤销、不 fallback** | `evaluateReviewStatus` 只改状态为 `due`/`pending-review`，`priorityPreserved:true`、`revoked:false`、`replaced:false` |
| 既有 pending/due **persist** | 以规则**当前状态**为基准：既有 `pending-review`/`due` 一律保持，只有明确核验才清除；未到期/普通事件不清 `due`；非法 `context.now` 不字符串 fallback 伪有效 |
| 创建/核验/采集/导入/渲染/批准独立事件 | `applyReviewEvent`：仅 `explicit-verification`（须合法 UTC + actor + auditRef）更新 `lastVerifiedAt` 并重算到期；普通 `approval` 不能冒充核验；其余事件 `applied:false`，不刷新核验、不伪造 `createdAt` |
| 撤销/替代须明确确认 + 审计输入 | `revokeRule`/`replaceRule` 严格 `confirmed===true` + trim 非空 actor/reason/auditRef + 合法 UTC `at`；替代 ID 非法/空白/自引用拒；已撤销/替代不无谓更改；返回结构化 `ReviewAuditRecord` |
| 相关语义按明确关联判定、排除无关信息 | `diffRelatedSemantics` 用稳定 `associationKey` 判关联（非 evidenceId/revid/时间/hash），只读 `applicability` + 注入 `ipaSemanticFingerprint`；同关联 evidenceId 变仍比对；缺键保守 `unknown`；**刻意忽略** `pageText`/`revision`/`extractedAt`/`renderedAt`/`evidenceId` |

### 语义指纹的责任隔离（重要）

现有 `contracts.computeObservationFingerprint` 会把**全部 layout tags** 纳入 hash 且未规范
`rawQualifiers`，直接用于复核判断会因无关排版变化误触发。本 lane **不调用**该合同指纹，
而是由调用方**注入**后续正式 classifier lane 的**规范化语义指纹**（`RelatedSemanticSnapshot.
ipaSemanticFingerprint`）。关联由稳定的 `associationKey` 判定（非 `evidenceId`/revid/时间/hash），
从而识别「同来源新 render 且 IPA 变化」；缺关联键或缺指纹时返回 `related:true, unknown:true` 的
**保守**结果并给理由，不伪装成确定变化、不据此撤销/替代/降级。正式 classifier（下一 lane）提供
normalized semantic API 后需再做集成——本 lane 不改合同指纹、不越界实现 classifier。

## D. 测试覆盖（`scripts/test_pronunciation_scope_review.mjs`）

| 要求 | 用例 |
| --- | --- |
| 八维 known/all/unknown | A1/A2/A3 对 8 维逐维断言 disjoint / unresolved / `all-covers-*` |
| invalid scope 理由 + fail closed | A7 复用 `validateScopeMatchInputs`（未实现新校验）：`scope-unknown-reason`、`scope-known-empty`、`scope-unknown-as-all`、`scope-all-evidence`、`scope-missing-dimension`、`scope-required`；A8 公开 matcher 对 4 类无效 scope + 缺维度抛错、空维度抛 `RangeError` |
| 局部维不冒充整 scope | A9 局部比较 `wholeScope:false`、`isExact:false`；整八维相等 `isExact:true` |
| 部分集合不等价 | A4 subset/overlap，断言 `isExactScopeMatch === false` 且暴露 shared/leftOnly/rightOnly |
| base/past 负例 | A5 base↔past、past↔past-participle disjoint |
| 任一 disjoint 主导 unknown | A6 |
| UTC Jan31 / 闰月 / Jul31 / offset | B1 Jan31→Jul31、Jul31→Jan31、非闰 2/28、闰 2/29、offset/无 Z/非法时钟/非法月份/非法年/非法 months 抛错 |
| 无 timestamp unknown active 语义 | B2/B3 unknown 基准、`pending-review`、不伪填今天 |
| due priority preserved | B4 到期 `due` 且 `priorityPreserved`、`revoked/replaced=false` |
| pending/due persist | B4b 到期后仍 pending、未到期不清 due；B4c 非法 now 不伪 due |
| 相关/无关 semantic 触发 | B5 同关联 evidenceId 变 + IPA 变触发；同关联 evidenceId 变语义不变不触发；不同关联键不触发；缺关联键保守 unknown；all 证据 ref / unknown 措辞变不触发 |
| import/approval 不 verified | B6 采集/导入/渲染/批准/创建均 `applied:false`，不清 pending、不刷新 `lastVerifiedAt`、不伪造 `createdAt` |
| explicit verification | B7 缺 actor/auditRef 或非法时间拒；合法更新 `lastVerifiedAt` 并重算到期、返回 audit；无 createdAt 旧规则仍 `pending-review` |
| revoke/replace 无确认拒绝 | B8 字符串 `'false'`/空白 actor·reason·auditRef/非法 at 拒；自引用/空白替代 ID 拒；重复撤销拒；合法生效并返回 audit |
| 复核永不自动撤/替 | B9 已撤销规则不被重新激活；到期评估 `revoked/replaced=false` |

## E. 命令与实际结果

环境：Node `v24.15.0`；`node_modules` 同 commit 本地 symlink；零网络、synthetic 夹具。

| 命令 | 日志 | 实际退出码 |
| --- | --- | --- |
| `node scripts/test_pronunciation_scope_review.mjs` | `logs/scope-review-node.log`（`test_pronunciation_scope_review: OK`） | **0** |
| `pnpm exec eslint src/pronunciation-overlay/scope.ts src/pronunciation-overlay/review.ts scripts/test_pronunciation_scope_review.mjs --max-warnings 0` | `logs/scope-review-eslint.log`（空） | **0** |
| `COREPACK_ENABLE_STRICT=0 pnpm run typecheck` | `logs/scope-review-typecheck.log` | **1** |

### typecheck 退出码 1 的如实说明

`pnpm run typecheck`（`tsc -b`）退出码为 1，但错误**全部位于
`src/pronunciation-overlay/classification.ts`（其他 lane 进行中文件）**；
`scope.ts` 与 `review.ts` **0 条错误**（已用 `grep -E 'scope\.ts|review\.ts'` 核对为空）。
本 lane 未修改该文件，也不据此声称本 lane 通过整包 typecheck。

退出码汇总见 `logs/scope-review-exit-codes.txt`；本 lane 文件 sha256 见
`logs/scope-review-sha256.txt`（**修复轮后重算**）：

| 文件 | sha256 |
| --- | --- |
| `src/pronunciation-overlay/scope.ts` | `9d1d3c833ab5712a4b66eac6f615ebcb50a31a1879b5bec489caf59a8923d176` |
| `src/pronunciation-overlay/review.ts` | `59672a6114596bd3d44fe5984f925ff751286d37c37e6a1b780a5db59b0ed3e8` |
| `scripts/test_pronunciation_scope_review.mjs` | `0960586f8878ad622e706092accccc66d95f87adb7afd28d9bffa77f6d02689f` |

## F. 明确未完成 / 跨 lane 依赖（仅报告，未越界）

1. **未实现 resolver（3.3）**：逐字段 user > system > 合格来源 > 旧值解析属后续 3.3；本 lane 只提供
   范围匹配与复核纯函数，不写结果。
2. **未实现标签分类器（3.2）**：`explicit-all`/口音合格语义判定属 3.2；本 lane 仅按合同区分
   known/explicit-all/unknown。
3. **注入语义指纹与关联键待后续集成**：正式 classifier lane（fix4）的 normalized semantic API 终态
   后，需把其规范化指纹与稳定来源关联键接入 `RelatedSemanticSnapshot` 并补**接线测试**；本 lane
   **不改 `classification.ts`**，本轮用**注入 fixtures** 验证关联/指纹语义，不调用
   `computeObservationFingerprint`、不改合同指纹。
4. **未运行整包 typecheck 通过**：如上，唯一失败源为其他 lane 的 `classification.ts`。
5. **未改 tasks.md**：3.1 / 3.4 与第 3 组保持未勾选，等待主编排 final validation。
