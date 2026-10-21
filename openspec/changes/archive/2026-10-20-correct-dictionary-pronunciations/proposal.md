# Proposal

## Why

ECDICT 拼写单值音标不能表达多角色和完整来源读法。本 change 建立隔离的 IPA overlay、稳定身份、预算采集及系统权威/兼容投影，保留原包与旧纠错接口。

2026-10-20 拆分：完整产品同版本发布与长期批次流程尚未实现，现迁入 `publish-pronunciation-corrections`。同时迁移任务和对应 requirement，避免归档提前写入未实现主规格；不再沿用 10-18 “全部继续在本 change” 的规划决定。新旧 change 是前置基础与后续交付的关系，仍共用唯一权威。

## What Changes

- 保留第 1–10 组与 13.1–13.4 的既有能力：来源/规则/结果隔离、范围与优先级、四角色身份、v1 保护、opt-in 查询/展示、按词采集及限额账本、来源许可、sidecar 批准/发布/回滚工具与兼容回归。
- 保留三轮真实采集及批准证据，系统规则总数 77 = 3 历史 + 61 第二轮 + 13 第三轮。look 排除；22 条歧义、a/i 未变。数据事实见 evidence/19，不将 first-round 100 TOC/0 MAIN 称作成功 IPA 覆盖。
- 系统权威、旧 JSON 确定性投影、overlay 规则视图和逐项归因已具备；不将其表述成完整产品 release bundle 已激活。
- 第 11/12 组及 13.5–13.8 共 11 项未完成任务原文迁往后续 change；7 个完整 requirement 同步迁入，其中 3 个混合 requirement 在本 change 提炼已实现子集。详见 `../publish-pronunciation-corrections/requirement-migration.md` 的逐条去向。
- 审计仅保留现有原始分桶、历史 verifiedErrors 与投影的权威一致性合同；全量权威 verifiedErrors 及分阶段统计由后续实现。历史 13.3 勾选不作为其完成证明。

## Capabilities

### New Capabilities

- `dictionary-pronunciation-overlay`：隔离读法与修正规则、范围优先级、完整变体及许可、系统权威确定性投影与旧纠错迁移兼容。
- `dictionary-entry-identity`：稳定 ID、spelling 检索、read 四角色及旧纠错范围保护（spec 全文不变）。
- `dictionary-pronunciation-refresh`：官方按词采集、预算暂停恢复、来源指纹、候选报告及既有 sidecar 批准合同、复核时效、逐条外部依据及历史审计/投影一致性。

### Modified Capabilities

无；主规格当前为空。本 change 先归档，后续 change 的非重叠 ADDED requirement 再在同名能力上追加。

## Impact

已有代码和真实数据证据以 tasks/evidence 为准，本次仅拆分规划文件。完整批准身份扩展、release bundle、目标绑定回滚、审计全量统计、100 词产品闭环、长期预算和调度的后续设计及任务均见 `../publish-pronunciation-corrections/`。原第 12–15 节设计随之迁移；不悄悄删需求、不用标记完成替代迁移。

ECDICT TSV/metadata/释义/词形/旧 dump 及用户 v1 数据保持原边界，声音仍走原 pronounce。Wiktionary 衍生 IPA 独立 CC BY-SA 4.0 分发，逐项 source/history/license/变更说明可达；不改变应用或 ECDICT 许可证。系统 IPA 唯一维护权威为 `src/data/dictionarySystemPronunciationRules.json`，旧 JSON 和 overlay 均为派生出口。

归档由主编排在 verify 后执行，本次不归档。后续预算、采集、正式发布、真实回滚的各自授权不得由文档拆分推导。
