# 任务 1.1 / 1.2 证据索引

本目录是 OpenSpec change `correct-dictionary-pronunciations` 任务 1.1、1.2 的完成证据，
写 scope 仅限本目录与 `tasks.md` 的 1.1/1.2 checkbox。

| 文件 | 对应任务 | 内容 |
| --- | --- | --- |
| `00-authorization.md` | 1.1 | 本轮独立离线实施授权记录、允许写入范围、禁止项与执行边界清单 |
| `01-baseline-hashes.md` | 1.2 | 不可变数据完整 target set 与 sha256（ECDICT 释义 TSV、metadata、词形、dump/审计产物、纠错） |
| `baseline-sha256.tsv` | 1.2 | 上表机器可读清单（sha256 / bytes / path） |
| `02-legacy-contract-baseline.md` | 1.2 | 旧查询、旧词包/详情 JSON、v1 payload/storage、callback 行为基线 |
| `legacy-contract-sha256.tsv` | 1.2 | 合同源码 sha256 清单 |
| `03-test-run-report.md` | 1.2 | 5 个测试的命令、退出码、环境说明与只读性验证 |
| `logs/` | 1.2 | 5 个测试的原始日志与 `exit-codes.txt` |

## 边界重申

- 本次**未**真实联网采集、**未**正式发布、**未**回滚/迁移、**未**长期启用。
- **未**修改 ECDICT TSV metadata/释义，**未**改动旧 inflection/dump 生成器与产物，
  **未**改 TTS/历史/宿主旧合同。
- 规划文档不构成执行凭证；首轮采集、正式发布、长期预算各自仍需独立授权。
