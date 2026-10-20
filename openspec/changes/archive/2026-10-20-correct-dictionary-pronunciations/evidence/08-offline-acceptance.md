# HAM-37 离线实施验收

日期：2026-10-17。变更：`correct-dictionary-pronunciations`；分支：`feat/pronunciation-overlay`；PR #4 的 base 保持 `main`。

本轮交付 2.2–2.4 的复核修订以及第 3–9 组余项。全部第 1–9 组现为 34/45；第 10–12 组的 11 项保持未勾选。没有真实采集、正式发布、真实回滚、v1 迁移、长期调度或 npm 发布。批准与发布演练只发生在带 synthetic 标记的临时目录。

## 实际命令与退出码

总入口：`node scripts/test_pronunciation_overlay.mjs --record-evidence --acceptance`，exit 0。逐条执行结果保存在 `ham37-test-results.json`；原始日志为 `logs/ham37-*.log`。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node scripts/test_pronunciation_contracts.mjs` | 0 | JSON 合同、引用、版本与许可 |
| `node scripts/test_pronunciation_identity.mjs` | 0 | 持久身份、共享证据、merge/split、四处复核问题 |
| `node scripts/test_pronunciation_classification.mjs` | 0 | 标签、notation、完整性、分层及安全去重 |
| `node scripts/test_pronunciation_scope_review.mjs` | 0 | 八维范围、六个日历月、相关变化与明确核验 |
| `node scripts/test_pronunciation_resolution.mjs` | 0 | 逐字段优先、旧值/变体保留、局部覆盖、suppression |
| `node scripts/test_pronunciation_publication.mjs` | 0 | Python→TS→候选→假批准→合成正式 snapshot；原子故障及回滚 |
| `node scripts/test_pronunciation_renderer.mjs` | 0 | SSR、四角色、原定界 IPA、归因及旧路径保护 |
| `python3 scripts/run_pronunciation_python_tests.py` | 0 | 256 项 unittest；socket 外连被禁止 |
| `pnpm run test:dictionary-data` | 0 | 旧数据合同及 opt-in 查询/投影/保护扩展 |
| `pnpm run test:dictionary-corrections` | 0 | 原纠错与详情回归、只读 v1 及独立 scoped 存储 |
| `pnpm run test:pronunciation-audit` | 0 | 原审计回归，未使用 `--write` |
| `pnpm run test:inflections` | 0 | 原词形回归 |
| `pnpm run test:phonetics` | 0 | 原 dump/phonetic 回归 |
| `pnpm run typecheck` | 0 | 含浏览器 TSX 夹具 |
| `pnpm run build:types` | 0 | 新独立 subpath 类型产物 |
| `pnpm run build:lib` | 0 | 原入口及新独立入口 |
| `pnpm run build:demo` | 0 | Demo 构建 |
| `node scripts/check_pronunciation_distribution.mjs` | 0 | 导出、SSR import、LICENSES/notice 白名单及候选排除 |
| `python3 scripts/test_pronunciation_ui.py` | 0 | Chromium 桌面/360px；失败不假保存、限定角色保存、核验、词级声音、只读及 v1 阻断 |
| 27 个改动 JS/TS 文件的 `eslint --max-warnings 0` | 0 | `logs/ham37-eslint.log` |

总入口设置 `COREPACK_ENABLE_STRICT=0` 以运行仓库要求的 pnpm 子命令，未迁移包管理器。最终依赖来自现有 `yarn.lock` 的 `yarn install --frozen-lockfile --ignore-scripts --non-interactive`（exit 0），lockfile 未改。环境为 Node 24.15、Python 3.14；工具使用 Python 标准库，但当前环境没有 Python 3.12，未直接验证该版本。

## 逐项对应证据

下表中 Node 名称表示 `scripts/test_pronunciation_<名称>.mjs`；Python 表示上表的 256 项离线入口，按模块列出关键证据。各项不是以构建通过代替行为测试。

| 任务 | 实现及行为证据 |
| --- | --- |
| 2.2 | `identity`：entry/lexeme 前缀、alias/lifecycle 严格校验；属性更新复用稳定 ID、碰撞不合并 |
| 2.3 | `identity`、`resolution`：四角色独立、八维共享证据、retired 不复用、不凭相同 IPA 合并 |
| 2.4 | `identity`：未知第二后继阻迁移、scope.entry 随唯一目标重映射、交集不放大范围 |
| 3.2 | `classification`：RP/SSB/GA、UK/US、无口音、地域/rare/archaic/obsolete、notation、未知标签、实体/NFC 及不跨范围去重 |
| 3.3 | `resolution`：user > system > 来源 > 旧值、逐字段 provenance、有限范围分割、全范围旧值局部覆盖、失败保留、明确排除及有意清空 |
| 3.4 | `scope_review`：UTC 月末六个月、无时间戳保效待复核、语义变化提醒、导入/批准不刷新核验、撤销替代需确认 |
| 4.1 | 原 `test_dictionary_corrections.mjs` 接入 `pronunciation_compatibility_checks.mjs`：原 key/payload 指纹、unknown scope、空值与缺失区别、无写回 |
| 4.2 | 同上及 `publication`：当前 fingerprint 绑定、旧音标未归属整词保护、其他词继续、word/meaning 不阻音标；已归属 patch 还须在规则中保留其值 |
| 4.3 | 同上、`renderer`、浏览器：消费者当前 v1 优先，读取异常不解禁；严格读取失败仍保留旧读取器能够读取的当前补丁；候选只读可见 |
| 4.4 | 纠错兼容测试及浏览器：无回调不编辑、独立 v2 key、宿主保存失败不改缓存、成功才更新、past scoped 保存不复制其他 role |
| 4.5 | 原 `test_dictionary_data.mjs` 接入兼容检查：单值/JSON/宿主所有权、四 entry 顺序、版本绑定投影及 `[]` 保原样；坏角色/口音/批准名单拒绝 |
| 5.1 | Python `offline`：模块边界、CLI 默认离线/help、无 requests/Kaikki；CLI 重解析 Action API 主 JSON 字符串及 `{"*": ...}`，仅跳过纯 TOC |
| 5.2 | Python `extract`、`offline`、`action_api` 相关夹具：动态 English hLevel=2、非 section=1、多语言/缺页/缺 English，完整展开文本 |
| 5.4 | Python `http`：UA/contact、串行/间隔、429/503 Retry-After、至少 5 秒退避、重试预算；真实 CLI 仍 NO-GO |
| 6.1 | Python `http`：所有请求分类计账、网络/解压 bytes、gzip 高膨胀/截断/多 member、恰好额度不探读、异常暂停并关闭 |
| 6.2 | Python `ledger`、`offline`：开始前占额、失败计 distinct、同词重试不加 head、第 100/101 词边界、暂停不补请求 |
| 6.3 | Python `ledger`、HTTP ledger 恢复夹具：40 词/8 MiB 持久恢复、in-flight/不确定消费 fail closed、升级不清零、触限保持暂停 |
| 6.4 | Python `evidence`、`offline`：不可变许可缓存、原 HTTP hash、same revid 语义变化/无关文本、坏/截断拒绝、CLI JSON 主缓存重解析回归 |
| 7.1 | `publication`：所有尝试词固定 JSON+Markdown 报告、现值/拟值/范围/unknown/人工保留/来源许可、失败与 no-change；采集不是批准 |
| 7.2 | `publication`：内容 SHA256、版本/base/完整名单绑定、明确外部操作、真实复核入口拒 synthetic，无 autoapprove |
| 7.3 | `publication`：IPA/scope/归属/版本/名单改动拒旧批准，base 变化重 diff，报告排版不改变候选身份 |
| 7.4 | `publication`：坏引用/hash/license/projection/身份拒绝、当前正式值重核对、故障不切 pointer、独占锁、文件及目录 fsync；排除/阻断/no-change 保旧引用，`constructor` 不误取原型 |
| 7.5 | `publication`：目标 manifest/current baseline 绑定回滚、保留历史链及独立运行时人工纠错；仅临时 synthetic 目录演练 |
| 8.2 | `renderer`、浏览器及截图：四角色并列、default/补充/证据、未注明口音、原定界符、受控失败/成功、来源链接、仅词级 pronounce(word)；旧“英：”按 8.1 评估保留，不作口音证据 |
| 8.3 | 分发检查/构建：新独立 subpath、CC BY-SA 4.0 全文及 sidecar notice、逐项来源/历史/许可/变更说明；应用 MIT 及原 notices 保留 |
| 9.1 | 总入口阻外连；`publication` 合成端到端跨语言链路，未知身份须独立确认，synthetic 批准不能进入真实批准入口 |
| 9.2 | 五项旧回归 exit 0；`baseline-sha256.tsv` 的 19 个不可变文件运行前后 SHA256 一致 |
| 9.3 | 类型、三个构建、分发、SSR 和改动文件 lint 全部 exit 0；无 TTS/历史/学习/旧生成器改动 |

浏览器截图：`logs/ham37-ui-desktop.png`、`logs/ham37-ui-mobile.png`。夹具顶部的模拟失败/保存记录为 synthetic 测试控制，不是生产组件的一部分。两个尺寸均无横向溢出，保存失败留在对话框且不写假成功数据。

## 剩余边界

离线实施无已知阻塞，交付后等待复核。本轮没有宣称真实上游采集或生产发布验证；Python 3.12 直接运行仍是环境验证缺口。真实 `--apply` 继续显式 NO-GO，严格采集授权入口尚未实施。第 10–12 组只能在各自独立授权后继续，不能用本次 apply、合成演练或构建结果代替授权。
