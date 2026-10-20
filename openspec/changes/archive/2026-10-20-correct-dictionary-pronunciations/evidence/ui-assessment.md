# UI 评估：DTO 驱动的多读法展示、限定范围纠错与归因（任务 8.1）

> 本文件是任务 8.1 的评估产物，**不含任何运行时代码改动**，不构成采集、发布或迁移授权。
> 评估基于 `proposal.md`、`design.md`、三份 spec delta 与当前 `src/` 只读核对；布局与普通文案由本 lane 决定，
> 凡涉及实质规格/架构变化的点只记录、不决定，须先报告主编排确认。不涉及 TTS 与全应用重设计。

## 1. 评估范围与授权边界

- 评估对象：design Decision 10 的展示 DTO 合同（entry role、原定界 IPA、口音/地域/使用状态标签、
  default/supplemental/evidence-only/unresolved、人工来源与待复核状态、source/history/license 链接、变更说明）
  在未来 opt-in renderer 与限定范围编辑/核验入口中的 UI 落地方式。
- 明确不做：不实现组件、不改样式文件、不联网、不评估 TTS/声音口音、不做全应用视觉重设计、
  不决定长期预算、审批操作 UI 之外的任何发布行为。
- 旧合同红线（评估全程遵守）：`word` 继续用于旧搜索、导航、历史和宿主 callback；
  宿主提供的 `phonetic` / `getDetail` 归宿主；声音只调用原 `pronounce(word)`；
  v1 `Record<word, patch>`、`onChange(word, patch)` 与空 phonetic"有意清空"语义不变。

## 2. 现状盘点（只读核对结论）

| 现状 | 位置 | 与本变更的关系 |
| --- | --- | --- |
| 词条头部单值音标行：`formatDictionaryPhonetic(activeKeyword, phonetic)` | `src/DictionaryContent.tsx:185-201` | 旧默认渲染路径，**保持不动**；新多读法走 opt-in 分支 |
| 非中文一律前缀"英：" | `src/formatDictionaryPhonetic.ts` | 历史文案，非口音证据（见 §7） |
| 纠错入口 + 音标编辑对话框，保存键为原始词头 | `src/DictionaryContentCorrection.tsx`、`DictionaryCorrectionDialog.tsx` | 旧 word 级纠错 UI，**保持不动**；scoped 纠错另设入口 |
| 纠错详情按钮/对话框（before → after + 来源层级） | `src/DictionaryCorrectionDetailsButton.tsx`、`DictionaryCorrectionDetailsDialog.tsx` | 可复用的"详情对话框"模式，归因入口参照此形态 |
| 声音按钮：`pronounce(word)`，aria-label "朗读 {word}" | `src/PronunciationButton.tsx` | 保持不变；新路径不得把按钮绑到某条 IPA/口音 |
| 受控纠错：托管缺 `onChange` 则 `editable=false`，绝不静默保存；写成功才更新缓存 | `src/useDictionaryCorrections.ts` | 新 scoped 纠错 UI 沿用同一受控原则（无回调不显示编辑入口） |
| 导航历史按 query 字符串（word） | `src/useDictionaryNavigation.ts` | 新 entry 身份不进入历史键，历史/后退/前进保持 word 级 |
| SSR：`useSyncExternalStore` server snapshot 为空表，渲染期不读 localStorage | `src/useDictionaryCorrections.ts:112-124` | 新 renderer 必须同样纯 props 可 SSR |
| 现有 SSR 断言依赖字面"英：" | `scripts/test_dictionary_corrections.mjs:253` | 旧文案若调整须同步更新断言（见 §7） |

## 3. 展示 DTO → UI 语义映射

design 已定 DTO 字段语义，本节只决定**呈现方式**。建议 UI 消费的逻辑形状（接口命名可在实施时按导出规范定）：

```
PronunciationDisplayEntry {
  entryId: string                       // opaque 稳定 ID，仅用于 scoped 纠错与分组键
  role: 'base' | 'present' | 'past' | 'past-participle' | ...  // 显式属性，不作 ID 生成依据
  readings: PronunciationDisplayReading[]
  unresolvedLegacyNotice?: …            // 该词存在未归属旧 phonetic 纠错时的阻断提示
}
PronunciationDisplayReading {
  ipa: string                           // 原定界记号原样保留（/…/ 或 […]，不改写）
  notation: 'phonemic' | 'phonetic' | 'unknown'
  tier: 'default' | 'supplemental' | 'evidence-only' | 'unresolved'
  accentLabel: …                        // 见下表，含"未注明口音"
  usageLabel?: 'rare' | 'archaic' | 'obsolete' | …
  origin: 'user' | 'system' | 'wiktionary-derived' | 'legacy-ecdict'
  review: { status: 'current' | 'due' | 'unknown' }  // unknown = 无时间戳旧数据，保效待复核
  attribution: { sourceUrl, historyUrl, licenseUrl, changeNote }  // 机器可读，UI 可达
}
```

### 3.1 口音/地域/使用状态标签呈现（普通文案，本 lane 决定）

| DTO 语义 | 建议显示文案（中文界面） | 禁止行为 |
| --- | --- | --- |
| RP / SSB / GA | 保留原名徽标：`RP`、`SSB`、`GA`（title 给全称） | 不把 RP 与 SSB 合并显示为同一读法 |
| 未细分 UK / US | `英国` / `美国`（title 注明"未细分地域"） | 有地域 qualifier 时不许升级成这两个标签 |
| 无口音（accent unspecified） | `未注明口音` | 不复制成 UK+US 两份；不显示"英美双音"；不因词是英文就贴"英" |
| 地域限定（Scotland、Australia…） | 地域原名徽标，如 `苏格兰`、`澳大利亚` | 不冒充通用读法；只有地域读法时带标签直接展示 |
| regional/dialectal 但地域名未知 | `地域未细分` | 不猜地域名 |
| rare | `罕见` 徽标，可参与默认行 | 地域规则仍优先于"罕见可默认" |
| archaic / obsolete | `古旧` / `已废弃` 徽标，**只在补充区** | 不进默认行、不因此清空已有正式音标 |
| 未知/未分类标签 | 原标签小字保留（待核验样式） | 不静默丢弃，不自行升格适用范围 |

### 3.2 tier 呈现

| tier | 呈现 | 说明 |
| --- | --- | --- |
| `default` | 该 entry 分组的主读法行（可多条，如 UK+US 或"未注明口音"单份） | phonemic 优先时 phonetic 降为补充；仅 phonetic 时默认行保留 `[]` |
| `supplemental` | 分组内"更多读法"折叠区（button + `aria-expanded`），带全部标签 | 地域补充、archaic/obsolete、被 phonemic 压过的 phonetic |
| `evidence-only` | **不进展示行**；仅出现在归因/核验详情中，标"片段证据，未作完整读法" | 满足"片段仅留证据"合同 |
| `unresolved` | **不进展示行**；详情中标"范围待确认，未生效"，只读 | 范围确认 ≠ 发布批准，UI 文案必须说清 |

### 3.3 review 状态呈现

- `current`：不显示徽标（默认态不打扰）。
- `due`：小徽标 `待复核`（title："自创建或最近核验已满六个月或上游相关条件变化，纠错仍生效"）。**到期保效**，UI 不得显示为失效/已撤销。
- `unknown`（无时间戳旧数据）：徽标 `复核时间未知`，同样保效；不得把导入时间显示成核验时间。
- 撤销/替代需确认的交互**不在本评估内实现**，仅预留详情入口位置。

### 3.4 归因呈现（source / history / license / changes）

- 每条来源读法（origin 为 `wiktionary-derived`）在其分组提供"来源"入口（文字按钮，非纯图标），
  打开复用 `DictionaryModalDialog` 形态的详情对话框，列出：
  - 来源页链接（真实 `<a href>`，新开标签页，`rel="noreferrer"`）；
  - 作者历史链接（history URL，满足 CC BY-SA 归因入口）；
  - 许可链接 CC BY-SA 4.0 与同许可声明一句（普通文案，本 lane 定："该音标衍生自 Wiktionary，按 CC BY-SA 4.0 提供"）；
  - 变更说明（changeNote，如"提取自词条 Pronunciation 段，经人工纠错调整"）；
  - 工具 MIT ≠ 数据许可的一句区分说明。
- legacy ECDICT 旧值显示 `原词典` 来源标记；user/system 纠错沿用现有"我的纠错/系统纠错"层级标签。
- 归因信息**必须在渲染输出中可达**（SSR 产物含链接），不能只存在于开发缓存。

## 4. 组件与 API 可实施建议

全部为 **opt-in 新增**，不修改 `DictionaryContent` 现有 props 合同与默认渲染分支。

### 4.1 `DictionaryPronunciationOverlay`（新独立 renderer，建议名）

```
interface DictionaryPronunciationOverlayProps {
  entries: readonly PronunciationDisplayEntry[]   // 已批准正式结果（服务端/宿主组装）
  activeEntryId?: string                          // 受控选中分组；缺省时组件内部管理
  onEntryChange?: (entryId: string) => void
  onOpenAttribution?: (reading: PronunciationDisplayReading) => void  // 缺省用内置详情对话框
  scopedCorrections?: ScopedCorrectionsControl    // 见 4.2；缺省 → 不显示编辑入口
  // 故意不含 pronounce：声音按钮留在词级 headword 行（见 4.4）
}
```

- 纯受控/半受控：无内部持久化、渲染期不碰 localStorage，SSR 直接输出全部 default 行。
- 多 entry 时用分组标题（`role` 中文标签：原形 / 一般现在时 / 过去式 / 过去分词），
  不用 tabs 隐藏身份——四角色并列可见，符合"分别可纠错、互不遮蔽"的可发现性要求。
- `DictionaryContent` 增加一个可选 prop（如 `pronunciationOverlay?: ReactNode` 或
  `pronunciationEntries?: readonly …[]`）插入现有 pronunciation-row 位置；
  未提供时**逐字节保持现状**（含"英："路径与现有 SSR 断言）。prop 命名属实施细节。

### 4.2 限定范围 scoped 纠错入口（独立于旧回调）

```
interface ScopedCorrectionsControl {
  disabled?: boolean
  onScopedChange?: (entryId: string, condition: ScopeCondition, ipaPatch: string | null) => void
  // 关键：entry ID + 明确条件；不复用 onChange(word, patch)，不写 v1 JSON
}
```

- UI 位置：每个 entry 分组头部一个小号"纠错该读音"按钮（区别于词头旁的旧"纠错"按钮，两者文案必须可区分）。
- 沿用受控原则：`onScopedChange` 缺失 → 按钮不渲染；保存失败 → 对话框内 `role="alert"` 报错，不假成功；
  持久化成功才更新（由宿主/新存储层负责，UI 只反映 props）。
- 编辑对话框复用 `DictionaryIpaKeyboard` 与 `phoneticEditing`，标题明确语法身份
  （如"纠错读音：read · 过去式"），并在说明文字中写明"仅作用于该语法条目，不影响其他词形"。
- **v1 未归属阻断态**：该词存在 scope 未定的旧 phonetic 纠错时，overlay 不渲染该词新正式读法，
  显示普通提示（本 lane 定）："该词有一条尚未确认归属的旧音标纠错，新读法暂未启用"，并提供只读候选对照入口；
  其他词不受影响。此提示文案必须不含"错误"字样（旧纠错不是错误证据）。

### 4.3 legacy 投影（旧单值路径）

- 旧 `DictionaryContent` 单值行只在收到"唯一、范围确定且经核验的 version-bound projection"时才可能显示新值；
  UI 层**不实现取第一项逻辑**——投影判定在数据层完成，UI 只渲染给定字符串。
- 投影为 phonetic 记号时保留 `[]`，不套 `/…/`；UI 按字符串原样渲染即可，无需额外分支。

### 4.4 声音按钮（不变更确认）

- `PronunciationButton` 保持词级：`pronounce(word)`，aria-label 维持"朗读 {word}"。
- overlay 内**不新增**任何逐条 IPA 的播放按钮或"播放此口音"文案；视觉上也避免把声音图标与某条 IPA 排在同一语义组。

### 4.5 导航、历史与宿主所有权（不变更确认）

- 历史/后退/前进继续按 word；entry 切换（`onEntryChange`）不写历史、不触发宿主 `onSearch`/`onQueryChange`。
- 宿主提供的 `phonetic`/`getDetail`/`search`/`resolveEntry`/`onOpenPreview` 与旧 callbacks 签名全部不变。

## 5. 交互与可访问性方案

- **分组结构**：entry 分组用 `<section aria-label="read · 过去式">` 或标题元素，读法列表用 `<ul>`；
  不用仅颜色区分 tier/来源。
- **徽标**：全部徽标为文本（`RP`、`未注明口音`、`待复核`），对比度沿用 `--dictionary-text-secondary` 之上
  提高一档；不引入仅靠色相区分的新色对。
- **折叠补充区**：`<button aria-expanded aria-controls>`；默认收起 `supplemental`，`default` 永不折叠。
- **归因对话框**：复用 `DictionaryModalDialog`（焦点圈禁、Esc 关闭、关闭后焦点返还触发按钮）；
  链接可 Tab 到达，打开新标签有视觉/屏幕阅读器提示。
- **编辑对话框**：沿用现有 readOnly 输入 + IPA 键盘模式；`role="alert"` 报错；保存中禁用提交按钮防重复。
- **状态播报**：scoped 保存成功/失败复用 `role="status"` 的 `dictionary-popover__status` 模式，不新增 live region 噪音。
- **焦点返还**：删除/保存 scoped 纠错后焦点返还对应分组触发按钮（参照现有 `correctionTriggerRef` 模式）。
- **字号/排版**：IPA 沿用等宽栈；多 entry 分组间距大于读法行内间距，避免身份误读。

## 6. SSR 与受控测试计划（未来实施时执行，本阶段不运行）

### 6.1 SSR 约束

- overlay 纯 props 渲染，输出含全部 default 行、徽标文本与归因链接；不读 localStorage/window/ matchMedia。
- 折叠区 SSR 输出完整 DOM（`hidden` 控制），保证无 JS 时内容可检索、归因可达。
- server snapshot 语义与现有 `getServerPatchesSnapshot` 一致：scoped 纠错数据由宿主注入，不在模块作用域缓存用户数据。

### 6.2 受控测试矩阵（Node `assert` + Vite `ssrLoadModule`，合成 DTO，零网络）

| 场景 | 断言要点 |
| --- | --- |
| read 四角色 | SSR 含 base/present/past/past-participle 四个分组与各自 IPA；相同 IPA 的两个分组都渲染、不合并 |
| tier 分流 | default 在主行；supplemental 在折叠区；evidence-only/unresolved 不出现在读法行，仅详情可达 |
| 无口音单份 | 显示 `未注明口音`，**不出现** `英`、`UK`、`US` 字样，只有一份 |
| 地域-only | 地域标签原样显示，无"通用/标准"字样；regional 未知地名显示 `地域未细分` |
| rare / archaic / obsolete | rare 可在主行带标；archaic/obsolete 只在补充区 |
| phonemic/phonetic | 同条件 phonemic 主行、phonetic 补充；仅 phonetic 时主行保留 `[…]` 原记号 |
| review 状态 | due 显示 `待复核` 且读法仍在主行（保效）；unknown 显示 `复核时间未知`；无 `已失效` 文案 |
| 归因 | 每条衍生读法的详情含 source/history/license 三个 `<a href>` 与变更说明；SSR 输出中可达 |
| v1 阻断态 | 注入 unresolved legacy notice 时：不渲染新读法、显示提示、候选对照只读、其他词正常 |
| 受控 scoped 纠错 | 无 `onScopedChange` 不渲染编辑按钮；保存抛错时显示 `role="alert"` 且 UI 状态不变 |
| 旧路径回归 | 不传 overlay prop 时输出与现状逐字节一致（含 `英：` 断言）；声音按钮 aria-label 不含口音/IPA 字样 |
| 互不遮蔽 | 旧 `DictionaryContent` 的 `onOpenPreview`/导航回调在 overlay 存在时签名与行为不变 |

## 7. 历史"英："文案评估

- **事实**：`formatDictionaryPhonetic` 对一切非中文词头加 `英：`；design 已确认其不是口音 provenance。
- **结论（普通文案，本 lane 决定）**：
  1. 新 overlay 路径**绝不使用**"英："或任何暗示 UK 的固定前缀，口音一律来自 DTO 标签——这满足"不可制造 UK"。
  2. 旧默认路径**保留现文案不改**。理由：其语义应记录为"未知来源的历史前缀、非口音证据"，
     但现有 SSR 断言（`scripts/test_dictionary_corrections.mjs:253`）与宿主截图/快照依赖该字面量，
     旧路径改动不带来新信息却破坏回归基线。若未来确需调整，只允许改为中性文案（如"音标："），
     且必须同步更新断言、并在报告中注明这是文案语义修正而非数据合同变化。
- 两个方向的文案都**不会**把旧值描述为 UK/US。

## 8. Coverage 表（逐项对应合同，供 owner 核对、主编排复核）

| 合同项（来源） | 评估落点 | 状态 |
| --- | --- | --- |
| read 四稳定 ID / 四角色分别纠错、相同 IPA 不合并（identity spec / tasks 2.3） | §3 分组模型、§4.1 多 entry 并列、§4.2 分组级纠错入口、§6.2 四角色断言 | 已覆盖（建议） |
| base-only 不认证 present、past-only 不认证 participle；明确多 role applicability 才共享（identity spec） | 数据层职责；UI 侧保证分组间不互相借用读法、不合并显示 | 已覆盖（UI 侧约束） |
| default / supplemental / evidence-only / unresolved 分层保留（overlay spec、design D1） | §3.2 tier 呈现矩阵、§6.2 tier 分流断言 | 已覆盖 |
| 未注明口音不伪装 UK/US、不复制双份（overlay spec） | §3.1、§6.2 无口音断言、§7 新路径禁前缀 | 已覆盖 |
| RP/SSB/GA、未细分 UK/US、地域保留标签、地域-only 带标展示（overlay spec） | §3.1 标签表、§6.2 地域断言 | 已覆盖 |
| rare 可默认、archaic/obsolete 仅补充（overlay spec） | §3.1、§6.2 断言 | 已覆盖 |
| phonemic 优先 / 仅 phonetic 保 `[]` / 类型不明不猜（overlay spec） | §3.2、§4.3 投影原记号、§6.2 断言 | 已覆盖 |
| 片段仅证据不作完整读法（overlay spec） | §3.2 evidence-only 不进展示行 | 已覆盖 |
| 未知限定待核验、非限制未知标签保留（design D4） | §3.1 末行、§3.2 unresolved 详情只读 | 已覆盖 |
| 复核 6 个月到期保效、无 timestamp 标 unknown、采集不刷新核验（refresh spec / design D6） | §3.3 徽标语义、§6.2 review 断言 | 已覆盖（展示侧） |
| source / history / license / 变更标记逐项可达（overlay spec 许可要求、design D10） | §3.4 归因对话框、§6.2 归因断言 | 已覆盖 |
| 工具 MIT ≠ 数据许可、不主张全应用 CC（design D10） | §3.4 许可区分文案 | 已覆盖（文案） |
| 未归属旧 phonetic 阻断该词新正式结果、候选可对照、其他词继续（identity spec / design D5） | §4.2 阻断态 UI、§6.2 阻断断言 | 已覆盖 |
| scope 确认 ≠ 发布批准（identity spec） | §3.2 unresolved 文案、§4.2 提示文案 | 已覆盖（文案不混淆） |
| 旧 word 导航/历史、旧 callbacks、宿主所有权不变（design D5、tasks 4.5） | §4.4、§4.5 不变更确认、§6.2 互不遮蔽断言 | 已覆盖 |
| 声音仅 `pronounce(word)`，不宣称播放某 IPA/口音（design D10、tasks 8.2） | §4.4、§6.2 声音断言 | 已覆盖 |
| opt-in 扩展、不取第一项、受核验投影、`[]` 不套 `/…/`（design D5） | §4.1 opt-in、§4.3 投影约束 | 已覆盖 |
| 有回调才编辑、持久化成功才更新、读存储失败不解除保护（design D5） | §4.2 受控原则、§6.2 受控断言 | 已覆盖（UI 侧） |
| 历史"英："按真实未知语义评估、不凭旧断言推口音（tasks 8.2） | §7 评估结论 | 已覆盖 |
| 独立 CC BY-SA 4.0 sidecar 分发与 `package.json` 白名单（tasks 8.3） | 属打包/资产 lane，本评估只在 §3.4 保证 UI 可读归因入口 | 部分覆盖（归 tasks 8.3） |
| 审批操作 UI、候选报告呈现（design Open Questions） | 不在 8.1 范围；本评估未涉及 | 不适用 |

## 9. 需先报告事项与不做事项

- **本次评估未识别必须变更规格/架构的点**；§4.1 的 `DictionaryContent` 可选 prop 与 §4.2 的 scoped control
  均落在 design 已确认的"opt-in 扩展接口 / 新纠错 control 采用 entry ID + 明确条件 + 独立回调"边界内，
  具体命名按实施时导出规范确定。实施中若发现需要实质变化（例如要求改变旧纠错存储合同、
  要求声音绑定口音），**先报告主编排，不自行决定**。
- 不做：TTS/声音口音设计、全应用视觉重设计、审批/发布操作 UI、长期预算、任何采集行为、
  v1 数据迁移 UI（迁移需另获明确操作授权）。
- 后续衔接：实施阶段（tasks 8.2）可在同 session 接 DTO 合同后按 §4/§5/§6 实现与验证。
