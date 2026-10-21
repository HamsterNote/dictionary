# 填写系统纠错

**音标纠错的唯一权威是 `dictionarySystemPronunciationRules.json`**；`dictionarySystemCorrections.json` 是由它确定性投影生成的派生文件，不要直接手改。非音标字段（`word`/`meaning`）的纠正仍直接编辑 `dictionarySystemCorrections.json`，并注意投影器只管理其中有对应规则的词头。

新增/修改音标纠错的流程：

1. 在 `dictionarySystemPronunciationRules.json` 中维护规则（`PronunciationRule` 合同：ruleId、target、operations、8 维 conditions、evidenceRefs、lifecycle、reviewStatus）。新正式规则必须逐条带 CC BY-SA 4.0 证据（permalink + history URL），缺许可或缺引用会被拒绝收录；草稿保持 `pending-review` 且无批准引用时不会投影。
2. 运行 `node scripts/project_system_pronunciation_rules.mjs --write-legacy` 重新生成派生 JSON，并同步更新权威文件中的 `rulesVersion` 与 `legacyProjectionSha256`。
3. 运行 `yarn test:dictionary-corrections`（含投影一致性校验）与 `yarn typecheck` 检查。派生文件与权威不一致（版本混配）会让校验失败。
4. 回滚：恢复权威文件的旧版本后重新投影即可恢复旧派生，不删除历史记录。

`dictionarySystemCorrections.example.json` 是旧派生格式的模板，不会加载到词典。

- JSON 的键是原词头，英文建议小写，不能用修正后的拼写作为键。
- 每条可填写 `word`（显示词头）、`phonetic`（音标）、`meaning`（释义）。只保留需要纠正的字段，至少填写一项。
- 字段均为字符串；原词头最长 300 字符，每个修正字段最长 1000 字符。使用标准 JSON，不允许注释或末尾逗号。
- 用户纠错优先于系统纠错；未填写字段沿用原词库。搜索和历史记录仍使用原词头。
- 在提交说明中记录勘误依据。保存后开发 Demo 会重新加载；发布包需要重新构建。
- Demo 的“已纠错列表”分别展示系统与用户补丁。删除用户纠错会更新本地存储；删除系统纠错仅持久化当前浏览器的 Demo 排除项，可用“恢复系统纠错”撤销。要从发布数据中永久删除，请在正式 JSON 中移除对应条目。

填写后运行 `yarn test:dictionary-corrections` 与 `yarn typecheck` 检查。

## 英文音标审计

`scripts/audit_ecdict_pronunciations.mjs` 审计核心及九个可选英文词包，不读取词形包，也不改写生成的 TSV。运行：

```bash
yarn audit:pronunciations
yarn test:pronunciation-audit
```

机器可读结果写入 `scripts/data/dictionary-pronunciation-audit.json`，逐一归类每个去重词头，并记录词包路径、行数和文件摘要。`missing` 表示音标为空；`notationFlag` 只表示含 ECDICT 旧式符号，不等于读音错误；`unresolved` 表示尚未人工核实。`pendingSignals` 单列疑似损坏字符，仍须逐词查证，不能据此批量纠正。只有 `verifiedErrors` 中有逐条外部依据的项目可以进入正式系统纠错。
