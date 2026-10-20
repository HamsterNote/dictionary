# 1.1 实施授权记录与执行边界清单

> 本文件是任务 1.1 的完成证据：记录本轮**独立离线实施授权**与允许写入范围。
> 它**不是**首轮真实采集、正式发布、回滚/迁移或长期预算的授权凭证；
> 也不把 `proposal.md` / `design.md` / `spec.md` / `tasks.md` 等规划文件本身当作执行凭证。

## A. 授权来源

- 授权类型：新一轮**用户明确请求**（本轮对话原文）"Implement tasks from OpenSpec change
  correct-dictionary-pronunciations"，作为**离线实施授权**。
- 明确说明：规划文档（本 change 的 proposal / design / spec / tasks）只证明行为契约已定义，
  **不构成**实施、采集或发布授权；将来的 `apply` 请求也不代替第一轮采集、正式发布、
  长期预算各自的独立授权。
- 授权时间：2026-10-08（本轮）。
- 权威源：用户本轮指令；主编排（orchestrator）为最终核对人。

## B. 允许写入范围（本 lane 实际执行范围）

本轮 lane（fixer / 任务 1.1–1.2）的写 scope **仅限**：

1. `openspec/changes/correct-dictionary-pronunciations/evidence/`（本目录：授权、基线 hash、
   旧查询/v1 合同摘要、实际日志）。
2. `openspec/changes/correct-dictionary-pronunciations/tasks.md` 中 1.1 / 1.2 的 checkbox。

**不修改**：实现源码、`package.json`/`yarn.lock`/exports 配置、spec/design/proposal 正文、
测试脚本本体。

## C. 整个变更（repo 内）在本次授权下的可写范围

按用户本轮边界，允许修改 repo 内：`src/*`、`scripts/*`、新增 sidecar 许可文件、
包导出（`package.json` exports）与测试、规划 tasks 及证据。

## D. 明确禁止（本次授权不覆盖）

- 禁止**真实网络采集**（不访问 Wiktionary / Kaikki，不下载 dump）。
- 禁止**正式发布**（不写正式 manifest/pointer，不执行 npm 发布）。
- 禁止**回滚**与**迁移**（不对既有正式数据做迁移或回滚操作）。
- 禁止**长期启用**（不启用月度轮换、长期预算或 scheduled 采集）。
- 禁止修改 **ECDICT TSV 的 metadata/释义**。
- 禁止改动**旧的 inflection / wiktionary dump 生成器与其产物**。
- 禁止改动 **TTS / 语音、查询历史、宿主旧合同**。
- 禁止**联网安装依赖**。

## E. 执行边界清单（本次实际动作）

| 动作 | 是否允许 | 本次是否执行 |
| --- | --- | --- |
| 运行只读测试（5 个 `test:*`） | 是 | 是 |
| 运行原生成器（`generate:*`） | 否 | 否 |
| 运行写入式审计（`audit:pronunciations --write`） | 否 | 否 |
| 记录不可变数据 sha256 | 是 | 是 |
| 写 evidence/ | 是 | 是 |
| 勾选 tasks.md 1.1 / 1.2 | 是（达标后） | 见 tasks.md |
| 真实采集 / 发布 / 回滚 / 迁移 | 否 | 否 |
| 联网安装依赖 | 否 | 否 |

## F. 规划 ≠ 执行凭证

本 change 的 proposal / design / 三 spec / tasks 已完成的规划**不**授权实施，
也**不**授权采集或发布；本文件仅记录本轮实施授权及其边界，主编排保留最终核对权。
