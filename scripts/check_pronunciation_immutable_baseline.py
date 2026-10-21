"""Read-only verification of the full data file set and both frozen baselines.

第 13 组权威层豁免：``GROUP13_AUTHORITY_FILES`` 中的三个文件是系统音标权威及其
派生/文档，由 `project_system_pronunciation_rules.mjs` 的一致性校验守护，不再受
采集期冻结哈希约束；其余 55-2 个 src/data 文件与 19 个旧基线文件哈希照旧逐字节
校验，旧基线 TSV 本身不修改。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "openspec/changes/archive/2026-10-20-correct-dictionary-pronunciations/evidence"

GROUP13_AUTHORITY_FILES = frozenset({
    "src/data/SYSTEM_CORRECTIONS.md",
    "src/data/dictionarySystemCorrections.json",
    "src/data/dictionarySystemPronunciationRules.json",
})


def check():
    full_path = EVIDENCE / "collection-immutable-baseline.tsv"
    full = [line.split("\t") for line in full_path.read_text().splitlines()
            if line and not line.startswith("#")]
    baseline_path = EVIDENCE / "baseline-sha256.tsv"
    legacy = [line.split("\t") for line in baseline_path.read_text().splitlines()
              if line and not line.startswith("#")]
    expected = {path for _, path in full if path.startswith("src/data/")}
    actual = {path.relative_to(ROOT).as_posix() for path in (ROOT / "src/data").rglob("*")
              if path.is_file()}
    expected_frozen = expected - GROUP13_AUTHORITY_FILES
    actual_frozen = actual - GROUP13_AUTHORITY_FILES
    if (len(expected) != 55 or expected_frozen != actual_frozen or len(legacy) != 19
            or not GROUP13_AUTHORITY_FILES <= actual):
        raise RuntimeError("immutable file set changed")
    for expected_hash, path in full:
        if path in GROUP13_AUTHORITY_FILES:
            continue
        data = (ROOT / path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise RuntimeError(f"immutable hash changed: {path}")
    for expected_hash, size, path in legacy:
        if path in GROUP13_AUTHORITY_FILES:
            continue
        data = (ROOT / path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_hash or len(data) != int(size):
            raise RuntimeError(f"legacy baseline changed: {path}")
    print(json.dumps({"srcDataFiles": len(actual), "legacyBaselineFiles": len(legacy),
                      "fullBaselineFiles": len(full), "fileSetUnchanged": True,
                      "group13AuthorityExempted": sorted(GROUP13_AUTHORITY_FILES),
                      "allSha256Unchanged": True,
                      "fullBaselineSha256": hashlib.sha256(full_path.read_bytes()).hexdigest(),
                      "legacyBaselineSha256": hashlib.sha256(baseline_path.read_bytes()).hexdigest()},
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    check()
