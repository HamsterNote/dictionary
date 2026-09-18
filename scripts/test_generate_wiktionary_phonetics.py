#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""Wiktionary 音标生成器的完整性与覆盖率门禁夹具测试。"""

from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from generate_wiktionary_phonetics import (
    PACK_ORDER,
    GenerationError,
    SnapshotMismatchError,
    build_artifacts,
    check_artifacts,
    write_artifacts,
)


def write_snapshot(path: Path, entries: list[dict[str, object]]) -> str:
    serialized = "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in entries)
    path.write_bytes(gzip.compress(serialized.encode(), mtime=0))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_vocabulary(directory: Path, words: tuple[str, ...] = ("alpha", "missing")) -> None:
    directory.mkdir()
    for pack_id in PACK_ORDER:
        rows = ["# fixture", *(f"{word}\t\tfixture" for word in words)]
        (directory / f"ecdict-{pack_id}.tsv").write_text("\n".join((*rows, "")), encoding="utf-8")


class GenerateWiktionaryPhoneticsTest(unittest.TestCase):
    def test_generates_and_checks_all_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "snapshot.jsonl.gz"
            vocabulary = root / "vocabulary"
            write_vocabulary(vocabulary)
            digest = write_snapshot(
                source,
                [
                    {
                        "lang": "English",
                        "lang_code": "en",
                        "sounds": [
                            {"ipa": "/ˈæl.fə/", "tags": ["UK"]},
                            {"ipa": "/ˈæl.fə/", "tags": ["US"]},
                        ],
                        "word": "alpha",
                    }
                ],
            )
            thresholds = dict.fromkeys(PACK_ORDER, 0.5)

            artifacts = build_artifacts(
                source,
                vocabulary,
                expected_sha256=digest,
                minimum_hit_rates=thresholds,
            )
            self.assertEqual(len(artifacts.files), 12)
            self.assertTrue(all(item.hits == 1 for item in artifacts.coverage.values()))

            write_artifacts(artifacts, root)
            check_artifacts(artifacts, root)

    def test_rejects_a_tampered_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "snapshot.jsonl.gz"
            vocabulary = root / "vocabulary"
            write_vocabulary(vocabulary)
            digest = write_snapshot(
                source,
                [{"lang": "English", "lang_code": "en", "sounds": [], "word": "alpha"}],
            )
            source.write_bytes(source.read_bytes() + b"tampered")

            with self.assertRaises(SnapshotMismatchError):
                build_artifacts(source, vocabulary, expected_sha256=digest)

    def test_rejects_zero_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "snapshot.jsonl.gz"
            vocabulary = root / "vocabulary"
            write_vocabulary(vocabulary)
            digest = write_snapshot(
                source,
                [{"lang": "English", "lang_code": "en", "sounds": [], "word": "other"}],
            )

            with self.assertRaisesRegex(GenerationError, "命中率 0.000000 低于阈值"):
                build_artifacts(
                    source,
                    vocabulary,
                    expected_sha256=digest,
                    minimum_hit_rates=dict.fromkeys(PACK_ORDER, 0.01),
                )

    def test_rejects_a_significant_coverage_drop(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "snapshot.jsonl.gz"
            vocabulary = root / "vocabulary"
            write_vocabulary(vocabulary)
            digest = write_snapshot(
                source,
                [
                    {
                        "lang": "English",
                        "lang_code": "en",
                        "sounds": [{"ipa": "/ˈæl.fə/", "tags": ["IPA"]}],
                        "word": "alpha",
                    }
                ],
            )

            with self.assertRaisesRegex(GenerationError, "命中率 0.500000 低于阈值 0.750000"):
                build_artifacts(
                    source,
                    vocabulary,
                    expected_sha256=digest,
                    minimum_hit_rates=dict.fromkeys(PACK_ORDER, 0.75),
                )


if __name__ == "__main__":
    unittest.main()
