# Design

## Context

动机与行为边界见 `proposal.md` 的 Why / What Changes。行为契约见同 change 的 `specs/dictionary-pronunciation-overlay/spec.md`、`specs/dictionary-entry-identity/spec.md`、`specs/dictionary-pronunciation-refresh/spec.md`；本设计已只读对照三份规格，最终一致性仍由主编排核对。本轮获授权完善 proposal、design、相关 spec 与新增 tasks 等规划文件；本 lane 仅更新本设计，其他文件由对应 writer 负责。本文件是未来实现的设计，不代表已经实现、采集、批准发布或通过测试，规划授权不因此成为采集或实施授权；本阶段未试采。

当前实现对设计有以下约束：

- `src/englishChineseVocabularyPack.ts` 把 TSV 解析为 `Map<string, readonly [phonetic, translation]>`，元数据描述原始包；不能把新增读法塞回此 Map 或改其计数、体积、释义。
- `src/lookupEnglishChinese.ts` 的查询键为 NFKC、空白归一与英文小写；直接命中词头后不再查询反向词形。返回合同只有一个可选 `phonetic` 字符串，ECDICT 音标外包 `/.../`；释义分隔生成的 `word-index` ID 只是展示 ID，不是可靠的词义或语法身份。
- `src/englishInflectionPack.ts` 已以数组保存词形及来源，区分 `p` 过去式与 `d` 过去分词；`scripts/generate_ecdict_inflections.py:88` 排除 `form == word`，故不能从旧反向包证明所有同形角色都不存在。
- `src/dictionaryCorrections.ts` 的旧合同是 `Record<word, {word?, meaning?, phonetic?}>`、`hamster-dictionary-corrections/v1` 和 `onChange(word, patch)`，且已逐字段合并 user/system。空 `phonetic` 是有意义的人工清空，不等于字段缺失。`src/useDictionaryCorrections.ts` 保证托管缺回调不编辑、不静默保存，写成功后才更新缓存。
- 仓库没有 `DictionaryDetail.tsx`；实际 `DictionaryDetail` 位于 `src/dictionaryData.ts`，仍为 single `phonetic`。`src/DictionaryContent.tsx` 用它显示 IPA，声音由独立的 `pronounce(word)` 回调提供。`src/formatDictionaryPhonetic.ts` 对非中文一律加“英：”，不能作为 UK 证据。
- `scripts/generate_wiktionary_phonetics.py` 是固定巨型 Kaikki/Wiktextract dump 流程，依赖 requests，未知标签与多种地域/rare 标签被排除，无口音候选可进入 UK/US 两列，现有许可常量也不是本次新数据的 CC BY-SA 4.0 合同。新路径不复用这些筛选与双列选择规则。
- `package.json` 使用 TypeScript、React、Vite；测试主要为 Node `assert` + Vite `ssrLoadModule` / SSR 与 Python `unittest`，没有本设计必须引入的新测试框架或后端。`scripts/test_dictionary_pronunciation_audit.mjs:37` 静态断言去重词头为 46,803；这不是新来源覆盖率或准确率证据。

**已确认决策与后续执行授权边界：**

1. 用户已明确选择 `read` 原形与普通同形一般现在时各自独立 entry；原形、一般现在时、过去式、过去分词共有四个稳定 ID，关联同一 verb lexeme，各自可独立纠错。相同 IPA 不合并身份，来源读法共享仍须有明确 applicability 证据；旧纠错归属不能据此自动确定。
2. 用户已明确选择**版本绑定批准**：逐批批准固定候选内容、纳入/排除名单及正式 baseline；IPA、scope、纠错归属或名单的实质变化，以及 baseline 改变，都必须重新生成差异并重新审批。仅报告排版变化且内容无实质变化不需重批。核心版本绑定不再未定；下文 candidate hash / base manifest / atomic pointer 是本设计采用的技术落实，不声称用户逐项确认了全部内部格式。
3. 长期预算仍在首轮实际量测后另获用户批准，当前不要求提前确定额度或另设规划确认门槛；预算未获批准时真实长期调度保持 disabled / fail closed，不以首轮 100 词 / 20 MiB 代替。规划授权不包括实施、首轮采集或正式发布。

以下 Decisions 落实上述已确认行为边界；技术格式细节与未来执行授权分别说明，不能以待细化操作流程延迟或弱化已确认的核心决策。

## Goals / Non-Goals

**Goals:**

- 用独立、版本化 sidecar 承载身份、来源观测、规则与正式结果；查询时组合，不改原包。
- 让范围匹配、来源准入、人工复核、审批与兼容投影分别有明确输入输出，能用离线夹具验证；不把“已取得来源”误作“已归属”或“已批准”。
- 允许约 46,803 词头逐批覆盖，按证据需求拆语法条目；单词阻断不停止其他合格词。
- 提供旧接口无损共存及可撤回的 opt-in 扩展接口，保留宿主受控数据的所有权。

**Non-Goals:**

- 不重写 ECDICT TSV / manifest / 释义或现有词形生成器，不全库构建 lexeme、POS、sense 本体。
- 不修改 TTS、声音口音、学习系统、学习进度、查询历史标识。
- 不建设后端、全量 dump 管线或自动批准服务；可选对照来源不进入主采集路径。
- 本文只规定展示数据语义与归因合同，不决定布局、动效、编辑器交互或视觉 polish；这些由主编排安排 designer 评估。

## Decisions

### 1. 三层不可混写，正式结果引用独立版本

选用“不可变来源观测 → 版本化规则解析 → 已批准正式 manifest”三层结构。新增数据包与 ECDICT 包物理、许可和元数据分离；应用只加载正式 manifest 指向的 sidecar，不在用户查词时联网。

| 层 / 记录 | 核心字段与职责 |
| --- | --- |
| 来源观测 `PronunciationObservation` | `observationId`、语言、exact source spelling、带原记号的 `rawIpa`、安全规范化比较值、notation、完整性、全部原始 tags / qualifiers、结构路径、适用范围、证据引用。没有人工覆盖或“已生效”标志。 |
| 来源证据 `SourceEvidence` | page / history URL、revision、提取时间、请求/渲染版本、提取器版本、标签规则版本、响应内容 hash、音标语义 fingerprint、许可及归因、缓存引用。一次重新渲染产生新证据，不覆盖旧证据。 |
| 修正规则 `PronunciationRule` | rule ID、user/system 来源、entry / legacy-headword 目标、逐字段操作、明确条件、证据引用、创建/核验时间、复核状态、撤销/替代链。仅修改已声明字段和范围。 |
| 最终结果 `ResolvedPronunciation` | entry ID、明确适用条件、全部默认/补充/保留读法引用、逐字段来源、未确定原因、已确认排除理由、review 状态；是确定性解析产物，不是重新创造的来源证据。 |
| 正式 `PublicationManifest` | schema / identity / source / rule 版本、完整资产 hash、每词结果版本、兼容投影、许可资产、批准记录及上一正式版本。候选不由此入口暴露。 |

不存在稳定语义的 POS / sense / role 用 `unknown` 表示，不能用空字段隐式表示“全部”。来源观测可以通过独立 applicability 关系引用多个**明确** entry；共享是同一证据明确涵盖多个范围，不是两条 IPA 恰好相同。全部读法包括不参与默认的残片与不明关联证据；可分别标为 `supplemental` / `evidence-only` / `unresolved`，不能因筛选而丢失。

**理由与替代：**直接覆盖 TSV 会混合许可证、毁掉原值、不能表达范围；单一大 patch 会把采集成功、人工纠错与发布批准混为一谈。三层增加引用校验成本，但可重算、审计与回滚，且 ECDICT 数据保持不变。

### 2. `byId` 本身作为持久身份注册表，检索键不作身份

**技术选择：**sidecar 的 canonical `byId` 记录同时承担 ID 注册表职责，不再维护一份内容重复的独立 registry。一次铸造 opaque UUID（带不具有业务含义的类型前缀即可），持久存入 sidecar；不得每次生成时重铸，也不得对拼写、IPA、POS 或来源当前位置计算 ID。schema 版本与 ID 分开。

- `byId` 保存 entry 与按需建立的 lexeme 记录、身份生命周期、exact spelling / aliases、显式 grammar roles 和证据。`spellingIndex: searchKey → entryIds[]` 只是可重建的搜索索引。
- `sourceAliasMap` 以来源站点、语言、exact page spelling 及有证据的来源身份定位关联 canonical ID。来源结构位置仅是证据定位，不是永久身份；上游改名、移动段落或锚点变动需重新核对 alias，不能因锚点不同就重铸 ID。
- 搜索沿用 NFKC / 小写键以保旧体验；identity 保留语言和源 exact spelling。大小写或 Unicode 搜索碰撞返回多个候选，不全局合并。
- 只有充分词元/语法证据时拆分；多个 IPA 或多个口音仍属于同一语法 entry。POS/形态属性改正不换 ID；IPA 改正也不换 ID。
- `read` 按已确认四角色建立原形 `base`、普通同形一般现在时 `present`、过去式 `past`、过去分词 `past-participle` 四个独立稳定 entry ID，关联同一 verb lexeme；这些 role 名是显式属性，不是 ID 的生成依据。每个 entry 可分别纠错，即使 base/present 或 past/past-participle 的 IPA 相同也不合并，旧原形查词命中不能遮蔽其他扩展身份。角色条件分别显式保存；只说 past 的证据不能套到 participle，只支持 base 的证据也不能自动认证 present。来源明确 applicability 覆盖多个角色时才共享观测引用。旧 `legacy-unsplit` 只作为历史兼容/待归属记录，不再用来表示 base/present 身份决策未定。
- lexeme 只表达有证据的关联；不从 ECDICT 翻译分隔符建立可靠 sense。当前不引入 sense 注册/迁移系统，来源中无法可靠关联的词义限制留在 applicability 的 unresolved 证据中。

**生命周期技术建议：**有明确同一身份依据的 merge 保留一个 canonical ID，其他 ID 成为带审计原因的 redirect；所有 correction scope 必须重新检查，不能把异义规则简单拼入 canonical。split 保留 retired 原记录及 `successorIds[]`，不将一对多关系伪装成普通 redirect。只有规则/纠错范围唯一指向某个 successor 时才迁移引用，否则保持 unresolved，等人工确认。不能通过 merge/split 绕过发布审批或删除历史 ID。

**理由与替代：**以词头/hash/POS 作 ID 易在属性变化时断链；重建全库语法模型超出需求。重复 registry 容易双写不一致；canonical records + 派生索引 + alias map 让身份只有一个持久真源。生命周期方案是技术推荐，不声称用户已逐项确认其格式。

### 3. 适用范围用显式约束，优先级只处理可比较的字段

适用条件按语言、entry / lexeme、grammar role、POS、来源明确的词义限制、口音、其他条件分别建模。每个维度采用 `known(values)` / `explicit-all(evidence)` / `unknown(reason)` 的区分；只有来源或人工明确表示通用范围才能是 `explicit-all`。范围解析产出 `comparable` / `disjoint` / `unresolved` 及解释，不用 truthy 或字符串相等替代匹配。

同一明确可比范围内，逐字段执行 user > system > 合格来源 > 旧值：

1. 先解析身份与条件，随后判断来源质量，再产生替代/新增/保留/补充动作。不明 scope 不能成为通配规则。
2. 人工仅修 IPA 时，不自动“修正”原有口音、POS、拼写、释义；系统其他明确字段仍可参与。旧 patch 的 word/meaning 保持原逻辑，新音标工具不生成或覆盖这两个字段。
3. 同一条件下合格新来源可优先，即使没有证明旧值错误；旧来源仍留在追溯层。多个合格新变体全部保留，不能选 source order 第一条代表全部。
4. 部分覆盖只替代对应范围，其他旧读法保持。旧 ECDICT 单一字符串缺乏范围时不擅自拆 IPA、补 UK/US 或认证为所有语法角色；保留为带不确定标签的 legacy 证据/当前展示。
5. 明确已确认错误的旧值退出默认显示，记录错误证据与替代原因。采集失败、缺页、无合格结果、来源不再出现某条 IPA，不单独成为“旧值错误”或清空依据。撤销人工/系统规则同样需确认。
6. 旧人工空音标保留其“有意清空”语义，适用范围确认后才可成为限定范围的 suppression；缺失字段才是继承。到期规则仍有效，不自动 fallback。

**理由与替代：**整词最高优先级 patch 与缺省 wildcard 虽简单，却会把 past 映射到 participle、把单一口音扩展到全词。把匹配独立成纯函数使冲突可以形成报告，而不是隐藏在 UI 格式化中。

### 4. 准入与排序使用版本化分类表，不沿用旧 hard-exclude

分类器保留原标签，另外派生规范分类。下表是首个规则版本的明确核心；未列入的标签保留且记录 `unclassified`，不能因为未知就一刀丢弃已有明确合法的完整 IPA。

| 维度 | 核心识别与处理 |
| --- | --- |
| 标准/通用口音 | `RP` / `Received Pronunciation` / `Received-Pronunciation`；`SSB` / `Standard Southern British`；`GA` / `General American` / `General-American`。保留具体名称，不强行把 RP 与 SSB 合成同读法。 |
| 未细分 UK/US | 明确 `UK` / `United Kingdom`、`US` / `United States`。只有该 qualifier 没有进一步地域限制时才归入未细分 UK/US；同时出现地域 qualifier 时不能仅凭 UK/US 升成通用。 |
| 无口音 | `accent: unspecified`；完整合格读法可默认，展示“未注明口音”，只有一份，不复制到 UK 和 US，也不计入英美双音齐全。 |
| 地域/方言 | 明确地域名称如 Scotland、Northern England、Southern US、Australia 等保留原标签；`regional` / `dialectal` 明确有限定但地域名未知时显示“地域未细分”。通常补充；只有地域合格读法时可带标签默认展示，不称通用。 |
| 使用状态 | `rare` 可默认且保留标签，地域优先规则仍适用；`archaic` / `obsolete` 只作补充。其他标签不冒充这三个状态，保留并依据实际限定含义处理。 |
| 转写类型 | 完整配对 `/.../` 为 phonemic、完整配对 `[...]` 为 phonetic；类型不明为 unknown，不改写定界符。只有确定相同口音与适用条件时 phonemic 优先，phonetic 补充；仅有完整合格 phonetic 时可默认并保 `[]`。 |
| 完整性 | 来源明确为片段、前/后缀片段、空音标、损坏定界、控制字符或解析截断，不认作完整词读法；保存证据与原因，默认展示不使用。不能只凭字符白名单宣称 IPA 正确。 |
| 词形/POS | 明确 base / 原形、普通同形 present / 一般现在时、past / past tense、past participle 分别对应四角色，不能互推；POS 仅识别明确文本/结构。缺省 POS、词义或词形关联为 unknown，不从翻译、IPA 或邻近音频猜测。 |

默认集合的排序按条件分组，先标准/通用与未细分 UK/US，再合格未注明口音，地域在通用存在时作补充；只有地域结果时可带其标签展示。rare 不另降为“只能补充”，archaic/obsolete 不参与默认竞争。不同已知口音互不替代，地区名与标准名称不是可随意归并的同义词。

unknown 标签有两种情况：不影响已明确准入条件的非限制信息，保留标签后可参与；可能影响 grammar / accent / 使用状态或关联关系而不能解释的限定，保留为待核验，不自行提升适用范围。标签解析须有理由码，后续增加别名更新规则版本并重新生成候选，不无声改变正式数据。

规范化仅用于比较与真正重复去重：解码 HTML 实体、Unicode NFC、去除字符串边界无关空白；原值完整保存。不去掉重音、长度符、音节界、变音符、`[]` 与 `/ /` 区别，不把旧式符号一律变为“错误”。同一来源证据、同一 applicability、同一 notation 与 qualifiers 下的真正重复可以合并引用；跨语法范围、跨证据版本或跨口音即使 IPA 相同也不去重为同一范围。

**理由与替代：**原生成器的 allowed/hard-exclude 二分规则会丢 regional/rare 与未知合法读法；两列 UK/US 数据模型无法表达 unspecified 和 phonetic。版本化分类表与解释码多一些数据，但可审查且不伪装覆盖。

### 5. 旧 v1 与扩展纠错并存，不自动迁移或投影

旧 `lookupEnglishChinese`、`DictionaryGetDetail(word)`、`DictionarySearch(query)`、`DictionaryCorrectionMap`、`onChange(word, patch)` 与 v1 storage key 保持兼容。扩展层提供 opt-in 的 `spelling → entryIds` 查询、`getEntryById` 和多读法结果；新纠错 control 采用 entry ID + 明确条件 + 独立变更回调/存储版本，不把 scoped patch 塞入旧回调或 v1 JSON。接口名称可在实施时按既有导出规范确定，但两套语义不能混同。

- v1 数据通过只读 adapter 呈现为 `legacy-headword` 规则，保留原始 key、逐字段内容、原始 payload fingerprint 与 scope unknown。不能复制到所有新 entry，也不能按 `/riːd/` 或 `/rɛd/` 猜归属。
- 存在尚未归属的旧 phonetic 字段（包括有意空字符串）时，该 word 的新正式音标结果整体暂缓，保留旧纠错与当前正式结果；候选仍可对照。其他 word 正常继续。只有旧 word/meaning 字段不会冒充 phonetic scope 或阻断来源音标。
- 发布工具只能校验其获得的系统/用户 scope 记录，不能假设能读取所有宿主或浏览器的 v1 数据。运行时组合层还须对当前宿主/本地 v1 执行逐词保护：即使全局 sidecar 已发布，该消费者有 unresolved 旧 phonetic 时也不应用该词的新正式音标集合，只呈现既有纠错/当前结果及候选对照。加载旧存储失败时不得假定“没有纠错”而解除保护，须保守报告失败、不静默覆盖。
- scope 确认写入独立、可审计的 resolution 记录，绑定旧 patch fingerprint；旧 patch 后来改变时，旧 resolution 不自动套用。范围确认不等于批次批准；批次批准也不能解除 unresolved。
- 无 timestamp 的旧用户/系统规则标记 `reviewTime: unknown`、待复核且仍有效，不把导入/适配时间伪造为核验时间；不批量自动设置“今天”。新增 sidecar 的导入记录时间只描述导入事件。
- 新 API 返回全部明确 entry / 读法 / 标签与 unresolved，不对旧 single phonetic 任取第一项。旧字段只有唯一、范围确定且可无损表达的映射，或用户明确核验的 version-bound legacy projection 才可显示新值；多口音、多个 entry 或 scope 待定时保护当前旧结果。唯一映射仍需通过来源与发布门槛。
- 新投影若需要 `[]`，保持原记号，不能再套旧 `/.../`。projection 是单独派生资产，不回写原 Map。宿主提供的 `phonetic` / `getDetail` 仍归宿主，不由新工具静默覆盖。
- 新旧受控模式都维持“有回调才编辑、持久化成功才更新”。读取、展示、打开候选、升级 schema 都不触发宿主写回；需要迁移时另获明确操作授权。可同时识别 v1 保护规则与 scoped 新规则，但不把并存理解为 v1 已删除。
- `word` 继续用于旧搜索、导航、历史和宿主 callback；entry ID 只用于明确需要语法身份的扩展路径，不机械替换所有 word。

**理由与替代：**原地 v1 升级会破坏宿主 JSON 合同，并给旧 scope 捏造精度；“取第一个扩展结果”会随顺序变化误改读音。显式投影增加部分词暂不升级的成本，但不牺牲已有人工数据。

### 6. 人工复核状态独立于采集与有效性

新规则分别保存 `createdAt`、可空 `lastVerifiedAt`、`reviewDueAt`、`reviewStatus` 和触发依据。默认按最后一次明确核验，否则按已知创建时间，加六个日历月计算（UTC，月末落在目标月末），不是收到新 HTTP 响应就延期。

到期或相关 upstream IPA / 口音 / 适用条件变化，将状态改为待复核而不降优先级、不撤销。触发比较以关联 evidence / applicability 的语义变化为依据，既不是页面无关文本变化一律触发，也不能仅 revid 未变就跳过。明确核验才更新人工时间；重新渲染、提取器升级、导入 v1、批次批准不自动构成核验。批次审批如同时含逐项核验，需单独记录明确核验动作，而不能推定所有规则都复核过。

**理由与替代：**把 TTL 当失效时间会悄悄覆盖人工纠错；把采集时间当核验时间则永远不能提醒复核。状态与有效性分离使待复核仍可保效。

### 7. 新建按词 Python sidecar 工具，不沿用 dump 主线

新增独立按词工具，主线使用 Python 3.12 标准库 HTTP、JSON、流式解压、hash 与 `html.parser.HTMLParser`；不增加运行后端或新的陌生依赖。使用有结构栈的 HTMLParser 提取器，而非整页正则或相邻文本/音频猜 qualifier。若后续真实结构证明标准库解析不足，再单独评估依赖并查官方文档；本阶段不联网、不假设未验证库能力。

根据主编排提供的既有官方只读研究结论，按词流程为：

1. 用 Wiktionary Action API 的 `parse` / `tocdata` 动态定位标题 English 且 `hLevel == 2` 的 section index；不写死 `section=1`。缺页或缺 English 成为对应状态，不清空正式结果。
2. 对完整 English 段执行 `parse prop=text`，保留多个 Etymology / Pronunciation 与子条目。官方展开结果已包含模板输出，主线不自行展开模板、不依赖 RESTBase 或 Kaikki 下载。
3. 结构解析每个 IPA 的父级 qualifier、etymology / pronunciation / POS / form 条件；保留父子路径和原文。音频口音不能借给邻近 IPA；没有可靠关联的观测留 unresolved。
4. 保存 page revision、提取时间、响应 hash、提取器/规则版本、标准化后的 IPA+qualifiers+applicability 语义 fingerprint。`revid` / `oldid` 不冻结模板/模块，因此月度轮换按预算重新渲染，不能仅 revid 相同就短路。
5. 必要时按词压缩缓存完整原响应用于审计/离线重解析，缓存带来源/许可。原 HTTP body、提取语义和正式资产 hash 分别记录；完整性不足的截断 body 不进入提取成功缓存。

官方结论在此仅作为上游已提供的设计依据，不声称本阶段重新验证接口或采集。现有 dump 脚本与生成产物保持不变，也不借其 CC BY-SA 3.0 常量声明新资产许可。

**理由与替代：**复用 dump 主线成本与风险不受首轮预算控制；新 npm 采集服务不符合 standalone 需求。标准库方案贴合已有 Python 脚本/测试环境，可离线测试 HTTP adapter 与 HTML extractor，代价是必须维护上游结构夹具。

### 8. 批次预算是持久状态机，不是本次进程计数

`BatchCheckpoint` 保存 batch ID、schema / extractor / tag-rule 版本、批准的预算配置、队列与各词状态、已开始 distinct head 集合、请求/重试/辅助请求计数、累计解压响应 bytes、实际网络 bytes、上次完成证据与暂停原因。状态至少区分 queued、in-flight、extracted、missing、no-qualified、unresolved、failed、paused、reported；failed / missing / no-qualified 都计入已尝试 distinct heads。

首轮单独获得执行授权后，最多开始 100 distinct heads，所有 HTTP 请求（含 TOC/辅助、错误响应与重试）解压后累计最多 20 MiB。每词开始前持久登记名额，当前词的必要请求仍受 byte 上限约束；第 100 词完成或失败计入已处理后暂停，不启动第 101 词，也不把触限暂停解释为可继续辅助/重试请求。未触限时重复尝试同一词不增加 distinct 计数，但每次响应继续累计 bytes / requests。

- 请求串行、低速；配置真实 contact 的 User-Agent 才能启动。429/503 尊重 `Retry-After`，不可用时至少 5 秒指数退避；不把公开限流值设为吞吐目标。重试次数和请求间隔显式配置，未配置合规 UA 则阻断真实执行。
- 对压缩和未压缩 body 使用同一解压后计数口径，限额读块与限额 decompressor 输出，防止 gzip 以小输入生成大未计数输出。触限立刻停读/关闭响应，不解析截断 JSON / HTML，不把 partial success 记为 extracted；已经消耗的 bytes 仍保留。
- 持久化预算账本与请求状态，恢复同 batch 不重置名额、bytes、规则版本或累计计数。进程异常留下 in-flight 且消费量不确定时保守阻断恢复，核对或预扣的预算不能自动退回以绕过限额；避免“重启免费重试”。
- bytes 恰好用尽且响应尚不能确认完整，按暂停处理，不用额外未授权读取补全；预算耗尽后恢复没有剩余额度，必须获得新预算/新 batch 的明确授权。工具不自动启动另一个 run 扩大采集范围。
- 任一上限已触发暂停后，同批恢复仍保持暂停，不能因 bytes 尚有剩余就补做请求或因词头名额尚有剩余就突破 byte 限额。已开始第 100 词但中断且消费状态不能确认的情况保守保持暂停，不借“未完成”免费重试绕过名额。
- schema / extractor / rule 升级不得混在一个检查点里重算成新批次并清零预算；产生新候选版本需保存原计数与证据，明确记录续作/新授权关系。

月度计划维护“首次覆盖队列”和“已覆盖轮换复查队列”，不承诺每月全库刷新。长期预算未经首轮量测与用户确认时，scheduled 模式默认 disabled / fail closed，不硬编码把 100 / 20 MiB 当常态。请求数量、网络 bytes、解压 bytes 分别报告，不由理论 API 响应大小宣称全库成本或覆盖率。

**理由与替代：**只按进程或成功词计数能被重启/失败绕过，gzip 与辅助请求会突破实际上限。持久 ledger 与保守暂停可能浪费未确认剩余额度，但优先保证授权边界。

### 9. 候选、范围确认、版本审批与原子发布分开

**已确认行为与技术落实：**逐批批准绑定固定候选内容、纳入/排除名单和正式 baseline，不是对某词永久授权。本设计采用内容寻址 candidate、version-bound approval 与正式 pointer 的原子切换来实现这一边界；hash 算法、记录格式与指针布局属于技术选择，不声称用户逐项确认其内部细节。候选记录 base 正式 manifest、identity/source/rule/projection 版本和完整差异；批准记录绑定 candidate hash、纳入/排除词集合、批准者/时间、明确操作与基线版本。candidate hash 覆盖实质候选数据与必要版本/引用，不把可独立重排版的报告展示文件当作候选身份；名单另作为固定审批输入参与校验，不能修改名单后继续使用旧批准。

首轮报告包括所有尝试/受影响词，分别列出新增、替代、保留、补充、排除旧错、待核验及失败/no change；每项说明如何证明同 scope、哪些维度仍 unknown、人工如何保留、旧值为何退出/保持默认、来源和许可。用户明确整批批准，可 exclude heads；unresolved 只阻对应 word，不阻其他词的批准发布。报告可包含未变化词与候选-only 证据，不能把失败归入覆盖成功。

发布前重新校验：

- candidate hash、固定纳入/排除名单与 base manifest 均对应批准时的版本。IPA、scope、纠错归属、名单或其他候选实质内容变化必须重新生成差异并重新审批；身份/规则或 upstream 语义变化导致的新候选也不得沿用旧批准。baseline 改变即使候选 IPA 相同也必须重新 diff / 重批；仅报告排版变化且实质内容及审批输入均不变时，不要求重批。
- 纳入词没有未解决 v1 phonetic scope 或不明的必要匹配条件；scope resolution 单独有效且对应当前 patch fingerprint。
- 所有正式引用、许可元数据、资产 hash 与兼容 projection 可验证，人工覆盖仍保留。
- 发布只切换完整 manifest pointer；blocked / excluded / no change 词继续引用先前正式结果，不暴露半批或半词状态。

先构造并校验完整不可变 manifest/资产，再以原子替换提交指针。运行时读取同一 manifest snapshot；候选目录/检查点不可被自动当正式包打入应用。审批期间若正式 base 更新则生成新差异，不能“直接套用已批准 patch”。回滚切回先前 manifest，保留全部候选、证据与批准记录；运行时人工新增纠错独立于来源包，回滚来源包不删除它们。

后续批次仍必须逐批获得用户明确、版本绑定的批准。审批入口、记录格式与操作步骤可在实施前按上述合同细化，但核心绑定原则不再待确认，也不能因此推迟落实；如细化会实质改变规格或架构，须报告主编排，而非当作可延后细节自行决定。实现提供批准校验入口而不 autoapprove；缺有效批准记录则禁止发布，不借定时运行、上次首轮批准或“差异很小”放行。

**理由与替代：**逐词直接写正式文件容易出现半批生效，审批不绑定版本会把新上游内容偷渡进旧批准。manifest 方案增加资产版本管理，却使已确认的版本绑定、发布一致与回滚可验证；该技术落实不代替长期预算批准，也不意味着自动发布获得授权。

### 10. 许可和最小展示语义是资产合同，不是全应用许可证

新 Wiktionary 衍生音标以独立 CC BY-SA 4.0 sidecar/许可资产分发，每项能追到具体源 page、history（作者归因入口）、license URL、提取/修正变更声明及同许可标识。工具/应用 MIT 与数据许可分别描述；不把 Wiktextract MIT 当作数据 MIT，也不主张整个应用改 CC。可选对照来源必须另有许可与准入核验，不自动混入。

正式读法的展示 DTO 提供 entry role、原定界 IPA、口音/地域/使用状态标签、default/supplemental/unknown、人工来源及待复核状态、source/history/license 链接和变更说明。来源链接与许可说明必须可被 UI 或宿主读取，不能只有开发缓存里存在；资产分发须覆盖独立许可文件与 notice，避免 `package.json` 的 `files` 白名单漏打包。具体文件命名/导出位置在实施时按项目规范安排，不借此改 ECDICT notices。

不能由 word 脚本推断 UK；`formatDictionaryPhonetic` 的历史“英：”不是口音 provenance，新多读法 renderer 从 DTO 标签显示。“未注明口音”、regional、rare、archaic/obsolete、unknown 需要最小语义标注；保留 phonetic `[]`。声音按钮仍只调用原 pronounce 回调，不宣称播放的是某个 IPA/口音。视觉样式、信息分组和编辑/核验交互另由 designer 评估，不在本文自行设计布局。

**理由与替代：**仅 pack 头部写一个来源或在 UI 固定“英”无法完成逐项归因/正确口音语义；把全部 app 改 CC 又超出数据许可边界。许可隔离与机器可读归因同时支持 UI 和宿主。

### 11. 验证采用离线夹具与兼容回归，本文不执行

沿用已有 Node `assert` + Vite SSR 和 Python `unittest`；以下是未来验证路径，不是本阶段测试结果。新 sidecar 纯解析/决策函数与 HTTP adapter 分离，所有主要证据用人工构造的小 HTML/JSON、假时钟、假存储、假 streaming response，避免测试访问 Wiktionary。

| 证据路径（未来） | 必须覆盖的场景 |
| --- | --- |
| 扩展身份/解析 Node 夹具 | `read` base / present / past / past-participle 四个稳定 ID 关联同一 verb lexeme，四 role 分别纠错且互不覆盖；base-only 不能认证 present、past-only 不能认证 participle，只有明确多角色 applicability 才共享证据；base/present 与 past/participle 相同 IPA 仍保独立身份，旧 legacy 不自动归属；同一身份的多 IPA、多口音不另拆身份；语言/exact spelling 不因 lowercase/NFKC 碰撞合并；属性更新保 ID；merge redirect 与 split 一对多 unresolved。 |
| overlay 纯函数 Node 夹具 | unknown ≠ explicit-all；逐字段优先与限定范围匹配；未覆盖旧读法保留；来源失败/缺页 no change；明确旧错退出默认但历史保留；无口音单份不假英美；地域-only 标签展示、rare 地域规则、archaic/obsolete 补充；同条件 phonemic 优先与仅 phonetic 保 `[]`；片段证据不作完整读法；不丢未知合法标签；跨范围不按 IPA 去重。 |
| `scripts/test_dictionary_corrections.mjs` / `scripts/test_dictionary_correction_details.mjs` 回归与扩展 | v1 Record / callback / 空 phonetic / word+meaning 保持；只读 adapter 不写 v1；无回调不静默保存、失败不假成功；scope 待定冻结该词所有新正式 IPA，已发布全局 sidecar 仍受宿主/本地保护且读存储失败不解除保护；候选可读但不生效；scope 确认与批准分离；无 timestamp 不伪造核验、到期保效、相关变更提前提醒且采集不延期。 |
| `scripts/test_dictionary_data.mjs` 与新 opt-in 合同夹具 | 旧查询 single phonetic、JSON-only 合同与宿主 getDetail 保持；唯一/明确核验 projection，不能取 first；历史/query word 仍可用；最小来源/许可/地域标签 DTO 可序列化，SSR 不声称音频口音。现有固定“英：”断言应在实际 UI 合同评估后针对新路径调整，不为通过测试篡改 provenance。 |
| 新按词工具 Python unittest | English section 不在 index 1；多个 Etymology/Pronunciation；父级 qualifier 继承；邻音频不借标签；范围关联不明保 unresolved；相同 revid 的模板输出变化导致不同语义 fingerprint；仅无关文本变化不误更新人工核验。 |
| 新 budget/checkpoint Python unittest | 第 101 词不启动，失败/缺页计 distinct heads；辅助/错误/重试 bytes 都计；压缩高膨胀响应、逐块触限与 partial HTML/JSON 不提取；恰好 byte 限额安全暂停；恢复累计预算不清零，任一触限后同批恢复仍暂停且不补做辅助/重试，in-flight 不确定消费 fail closed；20 MiB 耗尽不可自动开新 run；429/503 Retry-After / fallback；UA/contact 与长期 budget 缺失阻断。 |
| 新候选/manifest 夹具 | 未批准不 official；整批批准固定纳入/排除名单，unresolved 仅阻词；IPA、scope、纠错归属或名单实质变化必须重 diff / 重批，候选 hash / 必要 upstream 版本改变使旧批准失效；base 改变即使 IPA 相同也重 diff / 重批；仅报告排版变化且实质审批输入不变不使批准失效；后续批次不能复用旧批准；原子发布无半批；回滚 source manifest 不清人工；缺 license / broken reference 阻发布。 |
| 不可变数据与既有脚本回归 | 比较实施前后 ECDICT TSV / metadata / 释义内容 hash；不调用旧生成器产生覆盖；保持 `scripts/test_generate_ecdict_inflections.py`、`scripts/test_generate_wiktionary_phonetics.py` 与 `scripts/test_dictionary_pronunciation_audit.mjs` 的既有数据基线，不以新 overlay 伪改审计计数或 dump 基线。 |

规划验证由主编排负责全文/三 spec 一致性与 OpenSpec validate/status；实施后的类型检查、测试、构建与人工展示评估需要另一个实施阶段。本阶段未运行上述测试、未 build、未量测准确率/流量，也未形成真实首轮报告。

## Risks / Trade-offs

- [Wiktionary 展开 HTML 或 qualifier 结构变化] → 版本化结构提取器与离线多结构夹具；关联失败保留 unresolved，不猜 scope、不清正式结果。
- [旧值与来源范围未知导致很多候选暂不生效] → 单词阻断与其他词独立发布；报告明确人工需确认的具体范围，不用降低准入掩盖覆盖不足。
- [opaque ID 在重新生成或 source anchor 移动时漂移] → 持久 canonical `byId`、alias 映射与显式身份核对；merge/split 保持旧引用与历史，禁止一对多自动重定向。
- [未知标签造成误准入或误排除] → 保留全部原标签，分类与 default gate 分开；必要条件不明才待核验，非限制未知标签不一刀丢合法值。
- [six-month 到期或采集成功误删/覆盖人工值] → review 状态与有效性分离，明确核验事件单独记录，v1 时间未知保效且提醒。
- [模板依赖变化但 page revid 未变] → 按轮换预算重新 render，比较 IPA/qualifier/applicability 语义 fingerprint，缓存不是 revision-only shortcut。
- [gzip、辅助请求、重试或崩溃恢复突破授权预算] → 限额 streaming decompress 与持久预算账本，所有 body 同口径，消费量不确定则保守阻断，不自动另开批次。
- [审批后新数据、纠错归属或名单变化偷渡，以及部分正式更新] → candidate/base/version 与固定纳入/排除名单绑定批准，实质变化或 baseline 改变须重 diff / 重批，完整 manifest 原子切换；仅排版变化不误触重批，用户排除词与 unresolved 保持前版本。
- [read 同 IPA 被误合并或新身份被当作旧纠错归属证据] → base / present / past / past-participle 四个稳定 ID 分别可纠错，明确 applicability 才共享读法，旧 phonetic 未归属仍保护该词。
- [旧宿主接口无法表达多个 entry/读法] → opt-in 扩展与受核验单值 projection；范围待定保护优先，不取第一项、不静默 callback 迁移。
- [独立 CC BY-SA 资产的归因/许可在打包或宿主展示丢失] → manifest/DTO 强制来源与许可引用，验证 notices 与分发白名单，工具 MIT 和数据许可分开。
- [长期预算未批准却被当作可自动运行] → 首轮实际量测后另获长期预算批准，之前 scheduled disabled / fail closed，不现在另设额度规划门槛；publish 始终校验已确认的逐批版本绑定批准，不称全部实施就绪。

## Migration Plan

以下是未来实施与授权分界，不是 `tasks.md`，也不是本阶段执行记录。

1. **schema 与纯夹具**：定义 identity / observation / rule / manifest / checkpoint 与 DTO 合同，验证范围与许可引用、`read` 四 role 的稳定身份及独立纠错、版本绑定批准输入；原始 ECDICT 与 v1 不改。
2. **离线 dry candidate**：以小型合成来源和已有原值生成候选/报告，证明 parser、优先级、范围阻断、ID 生命周期与 budget 状态机，不访问网络、不发布。
3. **兼容 opt-in 扩展**：保旧查询与纠错入口，接入只读 v1 adapter 和独立 scoped API / 存储；保护 scope 未归属词。多读法展示与核验交互由 designer 评估后再实现，不把旧界面强行升级为任意单值投影。
4. **明确授权首轮试采**：用户批准具体首轮词头清单、有效 UA/contact 与执行，限制 100 distinct heads / 20 MiB ALL 解压响应。文档批准本身不授权此步；触限保存状态停止，报告实际请求/网络/解压量，不扩大批次。
5. **差异与人工范围核验**：列出完整差异/失败/no change/未确定项；旧 phonetic 范围逐项确认独立记录，不批量伪造时间、不复制给多 entry；未确认词继续保护。
6. **逐批批准与发布**：用户明确整批批准可排除词，批准固定候选内容、纳入/排除名单和正式 baseline；校验审批绑定的 hash/base/版本、名单、license、范围、人工保留和投影，再原子发布 manifest。IPA/scope/纠错归属/名单等实质变化或 baseline 改变须重新 diff / 重批，仅报告排版变化无需重批。操作步骤可实施前细化，但不再另行等待核心版本绑定确认；无有效批准不发布，长期预算未批准不启用真实 scheduled 执行，任何调度都不自动发布。
7. **回滚与后续轮换**：回滚指针到上一 manifest，保留证据/批准/规则历史且不回滚用户独立新纠错。依据首轮实际量测另获长期预算批准，才启用月度初次覆盖及覆盖后轮换；后续批次仍独立取得版本绑定批准，不沿用前次授权。

## Open Questions

仅以下不改变规格、架构与任务边界的细节可延后；`read` 四角色身份和版本绑定批准均已确认，不属于未决事项，长期预算按既定安排在首轮量测后另批：

- sidecar 资产的最终文件名、导出名、schema/工具版本号命名和报告格式选 JSON+Markdown 或其他等价可审查形式。
- 审批入口的操作步骤与批准记录展示形式；不能改变固定候选内容、名单和 baseline 的绑定，也不能放宽实质变化后重 diff / 重批的要求。若涉及实质规格或架构改变，须报告主编排而非在此延后。
- 首轮清单内具体代表词的组合（在独立执行授权时确认，不改变 100 / 20 MiB 或适用范围原则）。
- 已确定标签的中文文案、来源/许可入口的具体视觉位置与样式；不延后“未注明口音/地域/使用状态不可伪装”的语义要求，由 designer 评估。
