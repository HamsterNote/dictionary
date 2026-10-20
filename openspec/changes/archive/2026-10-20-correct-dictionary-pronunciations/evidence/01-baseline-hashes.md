# 1.2 不可变数据基线 hash 清单

> 任务 1.2 完成证据之一。记录 ECDICT TSV、metadata、释义、既有词形产物、既有 dump/审计产物
> 与纠错数据的 sha256。机器可读清单见同目录 `baseline-sha256.tsv`（制表符分隔）。
> 复算命令见文末；复算结果与保存清单**逐字节一致**，证明测试只读、未改动任何不可变数据。

## A. ECDICT 释义 TSV（word / phonetic / translation，10 个 pack）

| sha256 | bytes | path |
| --- | --- | --- |
| `322dfeed5900a7b2eb7c0d6f4932762bb9bc73f27e54a96fcc536c64b7fd2b29` | 418055 | src/data/ecdict-core.tsv |
| `c4ea0d0ca307cd54125792120abd5980825bd5f6a32e06f278214d33a00b693e` | 2567364 | src/data/ecdict-bnc.tsv |
| `90e893c63e73a0e6fb985cee4288b132beb438b6fce5691fc388b2f925bd9a9c` | 84048 | src/data/ecdict-cet4.tsv |
| `f17dc8dd97fcfbe0c7afb720db085dd4a3acc19da19c967b782650bdd4639ed5` | 191839 | src/data/ecdict-cet6.tsv |
| `2f0ba544e1547406c41a1f86fcd906484894815e7398cc1b0cc1f498dd0bd69c` | 56704 | src/data/ecdict-gk.tsv |
| `5792cb7501029accf1327594efb720edab6d8971344609c53d5aaa7f2df23b00` | 470172 | src/data/ecdict-gre.tsv |
| `74007b5e6e80cfd2b54ba12e16e63be340aa6c5232c93669c797b91c6595f0f7` | 200508 | src/data/ecdict-ielts.tsv |
| `bc8f1f1b4b5cce9476d762802e67acda56474248d94589a79da439f315b54402` | 143337 | src/data/ecdict-ky.tsv |
| `82fc37f00e2cb2263244d6e076b9f85176ebf5bff91c4eea27c6899b217d6fd6` | 345714 | src/data/ecdict-toefl.tsv |
| `17fe3712cd442130f3dab30d1c6251d5d3be3b17d04ef8abb460dda9c422077d` | 8701 | src/data/ecdict-zk.tsv |

内置头行证据（示例）：`ecdict-core.tsv` 首行
`# ECDICT bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b | sha256 1a6947e0…c3cf | pack core | entries 5000`，
行数 5001（含头行）。

## B. ECDICT metadata

| sha256 | bytes | path |
| --- | --- | --- |
| `1e834d84a13dfc245d20b66ea6b611c2e4ab2c9ae23117029c87a80bc0a4fba2` | 1332 | src/data/ecdictManifest.ts |

## C. 既有词形（inflection）产物

| sha256 | bytes | path |
| --- | --- | --- |
| `72d4ac04e1b1d6b7c91856684d0e2c70bcae8af9a0d411b7f450e51a18e46652` | 1447417 | src/data/ecdict-inflections.tsv |
| `dabffc84d3175340254ecdad434d717c629b6bd204c8930c9640b8a8f11afa1c` | 1447420 | src/data/ecdict-inflection-index.tsv |
| `070133f932088da8833f3988084f543134bf9ba314dc51189e1fba8449449809` | 407 | src/data/ecdictInflectionManifest.ts |

内置头行：正向包 `forward lemmas 40308 | forms 71439`，反向包 `reverse forms 58153 | relations 71439`
（行数各 71440，含头行）。

## D. 既有 dump / 审计产物（本 revision 实际存在者）

| sha256 | bytes | path |
| --- | --- | --- |
| `4f5af4c6293e30b57e6b99df11f516f94fe731f64d8f69a5d7ba5754c433ddff` | 854203 | scripts/data/dictionary-pronunciation-audit.json |
| `b6d4a925b6997636f656d80c83a561c906c0a26d11677bbe1e1460773faebf11` | 4539 | scripts/data/README.md |

`test:pronunciation-audit` 对该审计 JSON 断言以下**既有基线**（本次通过，未改动）：

- `totals.packRows = 66_016`
- `totals.uniqueHeadwords = 46_803`（**未改动该词头基线**）
- Σ `missingPhoneticCount = 9_237`
- `pendingSignalCounts = { backslash:137, caret:710, cyrillicIe:324, foreignNotation:15 }`

## E. 纠错数据基线

| sha256 | bytes | path |
| --- | --- | --- |
| `1cb6ecd0c595c74fb93aff10105d43ef6158f8a1a745461a3aa23d4f40455080` | 174 | src/data/dictionarySystemCorrections.json |
| `972ff1c95f50be632c1ea209b41347ef182ec5ff5737bf93032ca5c202c77d63` | 205 | src/data/dictionarySystemCorrections.example.json |
| `1fccfac09ea7c29c6c08cc9e8d2abe217ecffb79c68e83130b1dfe5b17172fa0` | 2031 | src/data/SYSTEM_CORRECTIONS.md |

## F. 明确不在本 revision / 未入库的原始来源（如实记录，未做任何采集）

| 目标 | 状态 | 依据 |
| --- | --- | --- |
| ECDICT 原始 `ecdict.csv` | 未入库（`data_sources/` 被 gitignore） | `generate_ecdict.py` 常量 `EXPECTED_SHA256 = 1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`、`SNAPSHOT_COMMIT = bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b` |
| Wiktionary 原始 dump `data_sources/wiktionary/raw-wiktextract-data.jsonl.gz` | 未入库（gitignore） | `generate_wiktionary_phonetics.py` 中 `SNAPSHOT_DUMP_DATE=2026-08-05`、`SOURCE_RETRIEVED_AT=2026-08-28`、`WIKTEXTRACT_COMMIT=872fc7b`、`EXPECTED_SHA256="__SNAPSHOT_SHA256__"`（占位符，未解析） |
| Wiktionary 音标衍生产物 `src/data/wiktionary-phonetics-*.tsv` / `wiktionaryPhoneticsManifest.ts` / `reports/wiktionary-phonetics-coverage.txt` | 本 revision **不存在**（`git ls-files` 无此产物；仅生成器在本地临时目录产出） | `generate_wiktionary_phonetics.py` 输出路径；`test:phonetics` 使用合成夹具，不需要真实产物 |

> 由于上述 Wiktionay dump 产物在本 revision 不存在，"既有 dump 产物"实际可核对的即
> `scripts/data/dictionary-pronunciation-audit.json`（由 ECDICT 数据推导）。如实记录，不虚构 hash。

## G. 复算命令

```sh
# 逐文件 sha256（与 baseline-sha256.tsv 完全一致）
E=openspec/changes/correct-dictionary-pronunciations/evidence
for f in src/data/ecdict-{core,bnc,cet4,cet6,gk,gre,ielts,ky,toefl,zk}.tsv \
         src/data/ecdictManifest.ts \
         src/data/ecdict-inflections.tsv src/data/ecdict-inflection-index.tsv \
         src/data/ecdictInflectionManifest.ts \
         scripts/data/dictionary-pronunciation-audit.json scripts/data/README.md \
         src/data/dictionarySystemCorrections.json \
         src/data/dictionarySystemCorrections.example.json src/data/SYSTEM_CORRECTIONS.md; do
  sha256sum "$f"
done
```

本次复算与保存清单 `diff` 结果为空（IDENTICAL），确认测试运行前后不可变数据未变。
