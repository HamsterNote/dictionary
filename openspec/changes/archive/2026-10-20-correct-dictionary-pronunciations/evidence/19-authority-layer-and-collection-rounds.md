# 任务 13.1–13.4 与第二/三批真实采集证据（HAM-37 收尾）

本文件汇总 2026-10-20 第二批/第三批真实采集、第 13 组权威层落地（13.1–13.4）的证据。
13.5–13.8、第 11/12 组未实施，不在本文范围。所有真实采集均绑定独立用户确认；
未归档、未合并 PR、未改 base。

## 版本链（分支 `feat/pronunciation-overlay`，均已 push）

| commit | 内容 |
| --- | --- |
| `15a6a18d` | revision 绑定 + 语言根校验（第二批执行版本，canonical `5aafacbc…`） |
| `2618b02` | oldid 词头离线解析修复；entry/accent/role 接线（extractor/4, tags/2） |
| `670e4ff` | 被拒 MAIN evidence-only 留证持久化 |
| `77a83ad` | 权威层落地（13.1/13.2）：`dictionarySystemPronunciationRules.json` + 投影器（第三批执行版本，canonical `d7f55563…`） |
| `2e213ea` | "More languages" 伪 h2 根修复（extractor/5；源自第三批 a/i 留证复盘） |
| `7b3b053` | 61 条批准规则写库（口径 B）+ 审计/渲染测试衔接（13.3）；归因接线（13.4）见收尾 commit |

## 真实采集（Multica issue 01a14974-c5e6-7beb-b279-7791d9fa6874）

| 批 | 确认评论 | 执行版本 | 结果 |
| --- | --- | --- | --- |
| 第二批（100 词） | `01a158d8-19d5-7866-be7e-5194713cab52` | `15a6a18d` | exit 2，ALL 解压触顶 20,971,520 bytes 持久暂停于第 85 词；170 请求，0 重试；81 extracted / 2 failed（a/i）/ 1 no-IPA（n't）/ 1 paused（how）/ 15 未尝试 |
| 第三批（19 词） | `01a1595d-427d-726f-8d81-c8b6b7b48f73` | `77a83ad` | exit 0；38 请求，629,620 network / 4,271,356 decoded bytes；16 extracted / 2 failed（a/i，留证）/ 1 no-IPA（n't） |

产物（issue 附件 + 本地批次根 `ham37-second-round-v1/`、`ham37-third-round-v1/`）：
reports 四件（candidates/costs/evidence + markdown）、`review-table.md/csv`、
`dictionarySystemPronunciationRules.draft.json`、`reports/projection-{a,b}.csv` 与
`projection-ab-diff.md`（A/B 仅 the/an 不同）、逐请求来源/sha256/许可。
`a`/`i` 根因经留证离线确诊为 "More languages" 伪 h2（校验过严，非页面异常）。

## 13.1 权威入口

`src/data/dictionarySystemPronunciationRules.json` 为唯一权威（schema
`dictionary-system-pronunciation-rules/1`，rulesVersion 版本引用，PronunciationRule
合同 + 8 维 conditions + lifecycle）。`scripts/project_system_pronunciation_rules.mjs`
纯 node 校验：target/scope/原值/修正值/证据/核验者/状态/批准引用逐项校验；pending 草稿
不投影、工作树草稿不能激活、缺批准不得写正式（`scripts/test_system_pronunciation_rules.mjs`，
11 项，exit 0）。

## 13.2 保真迁移与兼容投影

三条历史纠正逐字节保真（值、ECDICT 原值、旧补丁值、2026-09-06 依据全部保留；
未知核验者/许可如实 unknown，历史引用不冒充 CC BY-SA）。旧 JSON phonetic 为确定性
投影（`--write-legacy`/`--check`），word/meaning 手工保留；版本混配/手改派生/多值
任取 first 均被拒（测试覆盖）。旧值/用户优先/v1 回归经 `test:dictionary-corrections`
（exit 0）。回滚 = 恢复旧权威 + 重投影（纯函数，有测试）。

## 13.3 审计同源

`test:pronunciation-audit`（exit 0）改为：已发布 phonetic 逐条要求权威层同值背书
（迁移或 batch-approval 规则），审计 `verifiedErrors` 三条历史依据原样保留且仍在交付；
未批准不生效、启发式不判错、原始 packs/hash 与分桶不变（不可变基线检查通过）。
`VERIFIED_REVIEWS` 常量保留为只读历史记录，新增真值只能经权威层 + 批准进入。

## 13.4 归因与许可分发

- 包清单：`package.json` files 含 `THIRD_PARTY_NOTICES.md` 与 `LICENSES/`
  （`WIKTIONARY-PRONUNCIATION-OVERLAY.md` 已更新为"61 条已分发"状态，`CC-BY-SA-4.0.txt`）。
- 逐项归因：权威文件每条规则带 permalink（含 oldid）/history/CC BY-SA 4.0/变更说明；
  宿主可读导出 `SYSTEM_CORRECTION_ATTRIBUTION`（`src/index.ts` 导出，SSR 测试断言
  64 条全量覆盖、历史条目标注保真迁移而非 CC）。
- 缺 CC BY-SA permalink/history 的新正式规则被拒绝收录（测试覆盖）；
  原应用 MIT/ECDICT/CC BY-SA 3.0 notices 未改。

## 验证矩阵（本组改动后实际退出码）

| 命令 | 退出码 |
| --- | ---: |
| `node scripts/test_system_pronunciation_rules.mjs` | 0（11 项） |
| `node scripts/project_system_pronunciation_rules.mjs`（--check） | 0 |
| `yarn test:dictionary-corrections` | 0 |
| `yarn test:pronunciation-audit` | 0 |
| `yarn test:pronunciation-overlay`（完整电池） | 0 |
| `yarn test:dictionary-data` / `typecheck` / `build:types` / `build:lib` / `build:demo` | 0 |
| `python3 scripts/run_pronunciation_python_tests.py` | 0（351 项） |
| `python3 -B scripts/check_pronunciation_immutable_baseline.py` | 0（仅第 13 组三文件豁免，其余 55+19 逐字节） |

依赖说明：本机最初缺 `node_modules`；`yarn install --offline --frozen-lockfile
--ignore-scripts` 秒级补齐后 vite SSR 与合同对齐全部通过。
