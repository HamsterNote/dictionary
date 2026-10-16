# 1.2 只读回归日志报告

> 任务 1.2 完成证据之一。记录 5 个既有测试的**实际运行命令、退出码与日志**。
> 未运行任何原生成器（`generate:*`），未运行写入式审计（`audit:pronunciations --write`）。

## A. 环境说明（如实记录）

- 运行目录：`/home/zhangxiao/.local/share/opencode/worktree/30a3bf/feature/correct-pronumciation`
  （git worktree，HEAD `76c5779`）。
- `pnpm`（10.28.2）因 `package.json` 的 `packageManager` 字段默认拒绝运行。按指示先只尝试
  `PNPM_PACKAGE_MANAGER_STRICT=false`：**实际无法绕过**（含 `pnpm_config_package_manager_strict`、
  `npm_config_package_manager_strict`、`PNPM_CONFIG_PACKAGE_MANAGER_STRICT` 变体均 exit 1，
  输出仍为 "configured to use yarn"）。可见 `package-manager-strict` 并非该报错的可绕过开关。
  实际可用且未改锁/未迁移的调用方式为环境变量 `COREPACK_ENABLE_STRICT=0`，本次据此执行。
  失败尝试日志见 `logs/pnpm-package-manager-strict-attempt.log`。
- 初始 `node_modules` **缺失**。为在**不联网**前提下取得真实回归证据，将同 commit 主检出
  `/home/zhangxiao/frontend/HamsterNote/dictionary`（`package.json` 与 `yarn.lock` 与本 worktree
  sha256 完全一致）的 `node_modules` **本地符号链接**进来；测试跑完后已删除该链接，
  `git status` 恢复为仅 `openspec/` 未跟踪。
- Python：3.14.4；Node：v24.15.0。未安装任何依赖，未访问网络。

## B. 命令与退出码

运行方式（等价于用户要求的 `pnpm run <script>`）：

```sh
COREPACK_ENABLE_STRICT=0 pnpm run test:dictionary-data
COREPACK_ENABLE_STRICT=0 pnpm run test:dictionary-corrections
COREPACK_ENABLE_STRICT=0 pnpm run test:pronunciation-audit
COREPACK_ENABLE_STRICT=0 pnpm run test:inflections
COREPACK_ENABLE_STRICT=0 pnpm run test:phonetics
```

| 任务 | 命令实际展开 | 退出码 | 结果 |
| --- | --- | --- | --- |
| `test:dictionary-data` | `node scripts/test_dictionary_data.mjs` | 0 | PASS |
| `test:dictionary-corrections` | `node scripts/test_dictionary_corrections.mjs && node scripts/test_dictionary_correction_details.mjs` | 0 | PASS |
| `test:pronunciation-audit` | `node scripts/test_dictionary_pronunciation_audit.mjs` | 0 | PASS |
| `test:inflections` | `python3 scripts/test_generate_ecdict_inflections.py` | 0 | PASS |
| `test:phonetics` | `python3 scripts/test_generate_wiktionary_phonetics.py` | 0 | PASS |

完整日志见 `logs/`：`test-dictionary-data.log`、`test-dictionary-corrections.log`、
`test-pronunciation-audit.log`、`test-inflections.log`、`test-phonetics.log`，
退出码汇总见 `logs/exit-codes.txt`。

## C. 首次缺依赖记录（保留以如实说明环境）

在符号链接之前，3 个 Node 测试因 `node_modules` 缺失而 `ERR_MODULE_NOT_FOUND`
（`react` / `prettier`），退出码 1；Python 两个测试通过。缺依赖时**未**联网安装、**未**伪造通过。
随后仅以同 commit 主检出的本地依赖补齐环境，得到上表全部 PASS 的真实证据。

## D. 只读性验证

- 运行前后对 `01-baseline-hashes.md` 列出的不可变数据复算 sha256，与 `baseline-sha256.tsv`
  `diff` 结果为空（IDENTICAL）。
- `test:pronunciation-audit` 通过，意味着 `totals.uniqueHeadwords = 46_803` 等既有基线**未被改动**。
- `test:phonetics` 使用合成夹具在临时目录写产物并 `--check` 逐字节校验通过，
  未触碰仓库内任何产物。
- 未运行 `generate:*`；未运行 `audit:pronunciations --write`。
