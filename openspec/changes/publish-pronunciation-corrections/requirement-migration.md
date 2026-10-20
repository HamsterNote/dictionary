# Requirement migration

以分支基线 `ed8bc55` 为迁移前版本。原 requirement 全文（含所有 scenarios）要么原样保留，要么原样迁入；混合合同另外提炼已实现子集，不丢弃原文。双方 proposal 与本表共同约束归档范围。

| Capability | 迁移前 requirement | 去向及对应任务 |
| --- | --- | --- |
| dictionary-pronunciation-overlay | 音标修正与原始词典隔离 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 来源读法、修正规则与生效结果可区分 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 完整保留来源读法及适用范围 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 优先级只作用于可比较字段与明确范围 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 仅覆盖有明确依据的读法 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 未注明口音不伪装英美读法 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 通用读法与地域补充如实呈现 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 罕见与历史读法遵守不同默认规则 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 音位与语音转写保持类型与完整性 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 不确定性与旧式记号不等同错误 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 衍生音标独立许可并提供可达归因 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 正式系统音标纠错只有一个权威记录 | 后续 change 原文；13.5–13.7、11.2–11.4 |
| dictionary-pronunciation-overlay | 旧系统纠错迁移保持范围与接口兼容 | 原 change 原文保留 |
| dictionary-pronunciation-overlay | 系统纠错与发布快照作为同版本产品交付 | 后续 change 原文；13.5–13.7、11.2–11.4 |
| dictionary-pronunciation-refresh | 官方按词接口是主采集来源 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 首轮词头与解压响应体共同限额 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 触限中止读取且截断不是有效数据 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 同批断点恢复不重置累计预算 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 采集遵守串行低速与失败退避 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 月度限额任务逐步覆盖并在覆盖后轮换 | 后续 change 原文；12.1–12.3 |
| dictionary-pronunciation-refresh | 来源证据包含周期性重渲染结果 | 后续 change 原文；12.1–12.3 |
| dictionary-pronunciation-refresh | 候选报告列出全部受影响词与依据 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 正式发布须逐批明确批准 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 批准绑定固定候选内容、发布名单与正式基线 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 人工与系统纠错六个月到期保效待复核 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 新增系统勘误须逐条具备可分发的外部依据 | 原 change 原文保留 |
| dictionary-pronunciation-refresh | 发布批准绑定可核对的批准者与落库交付内容 | 后续 change 原文；13.5、11.1–11.4、12.3 |
| dictionary-pronunciation-refresh | 审计核验与正式纠正统计同源且可区分 | 后续 change 原文；13.8、11.4 |
| dictionary-pronunciation-refresh | 首轮及后续批次以可核对的产品纠正闭环验收 | 后续 change 原文；13.5、11.1–11.4、12.3 |

identity 的 7 个 requirement 及全部 scenarios 原样留在原 change（整个文件不改）。

## 混合 requirement 的已实现子集

| 原完整 requirement（后续保留全文） | 原 change 留下的较窄合同 | 后续补齐 |
| --- | --- | --- |
| 正式系统音标纠错只有一个权威记录 | 系统音标权威提供确定性兼容投影 | 全生命周期、实际两路径同版本激活，13.5–13.7、11.3 |
| 来源证据包含周期性重渲染结果 | 提取证据记录版本与语义指纹 | 周期调度而非离线指纹函数，12.2 |
| 审计核验与正式纠正统计同源且可区分 | 已落库系统投影具有权威同值依据且保留历史审计口径 | verifiedErrors 全量权威读取与核验/批准/落库/生效/阻塞分阶段词头/规则统计，13.8、11.4 |

原 refresh 的“正式发布须逐批明确批准”和“批准绑定固定候选内容、发布名单与正式基线”保留，表示第 7 组已有 sidecar 工具的校验合同；后续的“发布批准绑定可核对的批准者与落库交付内容”在该合同上增加真实确认、系统权威/投影/归因和目标产品内容绑定。范围确认工具已实现，真实逐项确认仍由后续 11.1 执行。完整产品回滚不是已有 sidecar manifest 回滚。

## 任务与事实

原 change 保留 42 条已勾选任务文字，第 1–10 组及 13.1–13.4；后续原样承接 11 条未勾选任务，编号不重排。历史 13.3 的勾选说明曾描述完整审计目标，但当前实现仅覆盖权威投影一致性，verifiedErrors 仍读取三条历史记录；不能用该勾选证明完整统计已经实现。本表、较窄 spec 与后续 13.8 的审计验收共同记录剩余差距，不修改历史证据、不将遗漏标为完成。前置 verify 应据当前实现检查该界限。

三轮真实采集及 61+13 条新增落库证据留在原 change 的 evidence/19；77 = 3+61+13。look 未落库，a/i 未补采，22 条歧义保留。本次不迁移、重写数据或采集资产。

## 归档顺序

先 verify/归档原 change，检查主规格仅吸收其余 13 个 overlay、12 个 refresh、7 个 identity requirement；后续保留 2 个 overlay、5 个 refresh requirement。原 change 新增三个窄合同已计入以上数量。两个 change 的 requirement 标题互不重叠，后续在前置主规格之上追加。后续归档前重新核对主规格；任何已有 requirement 的行为调整须用完整 MODIFIED，不能重复 ADDED。
