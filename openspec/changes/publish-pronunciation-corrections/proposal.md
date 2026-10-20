# Proposal

## Why

`correct-dictionary-pronunciations` 已完成离线能力、三轮真实采集记录以及系统权威层的获准数据落库，但完整产品发布与长期调度尚未实现。将未完成任务及对应需求一同拆出，避免前置 change 归档时将未实现合同合入主规格；这是同一产品路线的后续交付，不引入第二套权威或发布合同。

## What Changes

- 原样承接 HAM-37 的 11.1–11.4、12.1–12.3、13.5–13.8 共 11 项任务，保留编号、授权门槛及验收文字。
- 迁入完整产品同版本发布、批准者与目标内容绑定、目标 bundle 回滚、长期预算/月度轮换、周期重渲染及逐词产品闭环要求。
- 将混合已实现/未实现的权威记录、来源证据及审计统计要求分拆：前置 change 仅保留确定性投影、提取指纹和现有审计一致性合同；更强的原需求全文保存在本 change。逐条去向见 `requirement-migration.md`。
- 首轮 100 词是冻结验收范围，不承诺 100 条纠正。后续 3,786（含 ASCII 2,386）与遗留记法 33,962 按去重批次另批预算，不承诺一次全库。
- 当前 77 条系统规则（3 历史 + 61 + 13）及三轮采集是前置事实；不因拆分新增采集、发布或回滚授权。look、22 条未定和 a/i 不变。

## Capabilities

### New Capabilities

- `dictionary-pronunciation-overlay`：在前置 change 的同名能力基础上，补充完整权威生命周期及两条产品路径的同版本交付和回滚。
- `dictionary-pronunciation-refresh`：在前置能力基础上，补充周期调度、可核对批准身份、审计分阶段统计与真实产品闭环。

当前主规格为空，以上为同名 capability 中尚未落入主规格的新增 requirement，故采用 ADDED。归档依赖为先 `correct-dictionary-pronunciations`，后本 change；标题集合不重叠。前置归档后须再核对主规格，若实现需修改已归档合同，应另写完整 MODIFIED delta，不将同名 requirement 再次 ADDED。

### Modified Capabilities

无。既有离线批准绑定合同及 identity 不改写。

## Impact

扩展 `scripts/pronunciation_publication.mjs`、系统规则投影器、产品构建/查询与审计链；这些都是后续实施范围，本次仅编辑规划文档。唯一 IPA 权威仍为 `src/data/dictionarySystemPronunciationRules.json`；旧 JSON、overlay 与归因从获准版本派生，禁止直接手编投影。ECDICT TSV/metadata、释义、词形及旧 dump 产物保持不可变，Wiktionary 数据逐条 CC BY-SA 4.0 归因要求不变。

实施顺序为第 13 组离线扩展（含审计衔接）→第 11 组具体批准及产品验收→另批长期预算后第 12 组。前置能力与证据见 `../correct-dictionary-pronunciations/`，本次拆分不执行 apply 或 archive。
