"""Read-only verification of the full data file set and both frozen baselines."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "openspec/changes/correct-dictionary-pronunciations/evidence"


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
    if len(expected) != 55 or expected != actual or len(legacy) != 19:
        raise RuntimeError("immutable file set changed")
    for expected_hash, path in full:
        data = (ROOT / path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise RuntimeError(f"immutable hash changed: {path}")
    for expected_hash, size, path in legacy:
        data = (ROOT / path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_hash or len(data) != int(size):
            raise RuntimeError(f"legacy baseline changed: {path}")
    print(json.dumps({"srcDataFiles": len(actual), "legacyBaselineFiles": len(legacy),
                      "fullBaselineFiles": len(full), "fileSetUnchanged": True,
                      "allSha256Unchanged": True,
                      "fullBaselineSha256": hashlib.sha256(full_path.read_bytes()).hexdigest(),
                      "legacyBaselineSha256": hashlib.sha256(baseline_path.read_bytes()).hexdigest()},
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    check()
