#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""WordNet 3.1 近义词包生成器的端到端夹具测试。

How to run:
    uv run scripts/test_generate_wordnet_synonyms.py
"""

from __future__ import annotations

import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from generate_wordnet_synonyms import (
    PACK_ORDER,
    SYNONYM_SEPARATOR,
    WORDNET_SOURCE_URL,
    GenerationRequest,
    generate_synonym_packs,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class GenerateWordNetSynonymsTest(unittest.TestCase):
    def test_uses_the_wordnet_project_homepage_as_the_source_link(self) -> None:
        # Given / When / Then: 对外归属链接只指向 WordNet 项目主页。
        self.assertEqual(WORDNET_SOURCE_URL, "https://wordnetcode.princeton.edu/")

    def test_generates_pack_specific_bidirectional_synonyms(self) -> None:
        # Given: 两个词包以及包含重复词义和多词短语的微型 WordNet 快照。
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vocabulary_directory = root / "vocabulary"
            output_directory = root / "output"
            vocabulary_directory.mkdir()
            (vocabulary_directory / "ecdict-core.tsv").write_text(
                "# fixture\nquick\t\t快的\nfast\t\t快的\nunknown\t\t未知\n",
                encoding="utf-8",
            )
            (vocabulary_directory / "ecdict-gre.tsv").write_text(
                "# fixture\nrapid\t\t迅速的\nhigh speed\t\t高速\n",
                encoding="utf-8",
            )
            source = root / "wordnet.tar.gz"
            data = (
                "  WordNet header line\n"
                "00000001 00 a 04 quick 0 fast 0 rapid 0 high_speed 0 000 | moving quickly\n"
                "00000002 00 a 02 quick 0 fast 0 000 | another sense\n"
            ).encode()
            with tarfile.open(source, "w:gz") as archive:
                info = tarfile.TarInfo("dict/data.adj")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))

            # When: 按现有英文词包过滤并生成独立异步数据块。
            generate_synonym_packs(
                GenerationRequest(
                    source=source,
                    vocabulary_directory=vocabulary_directory,
                    output_directory=output_directory,
                    expected_sha256=None,
                )
            )

            # Then: 每包只包含自身词头，同义词排除自身、规范多词短语并稳定去重。
            core = (output_directory / "wordnet-synonyms-core.tsv").read_text(encoding="utf-8")
            gre = (output_directory / "wordnet-synonyms-gre.tsv").read_text(encoding="utf-8")
            manifest = (output_directory / "wordnetSynonymManifest.ts").read_text(encoding="utf-8")
            quick_row = next(row for row in core.splitlines() if row.startswith("quick\t"))
            self.assertEqual(
                quick_row,
                f"quick\tfast{SYNONYM_SEPARATOR}rapid{SYNONYM_SEPARATOR}high speed",
            )
            self.assertIn("fast\tquick", core)
            self.assertNotIn("rapid\t", core)
            self.assertIn("rapid\tquick", gre)
            self.assertIn("high speed\tquick", gre)
            self.assertNotIn("unknown\t", core)
            self.assertIn("CORE_SYNONYM_METADATA", manifest)
            self.assertIn("entryCount: 2", manifest)

    def test_checked_in_packs_follow_the_runtime_contract(self) -> None:
        # Given: 仓库中准备发布的十个 WordNet 近义词快照及 manifest。
        data_directory = PROJECT_ROOT / "src" / "data"
        manifest = (data_directory / "wordnetSynonymManifest.ts").read_text(encoding="utf-8")

        for pack_id in PACK_ORDER:
            snapshot = (data_directory / f"wordnet-synonyms-{pack_id}.tsv").read_text(
                encoding="utf-8"
            )
            rows = snapshot.splitlines()
            self.assertRegex(rows[0], rf"^# WordNet 3\.1 .* pack {pack_id} .* entries \d+$")

            # When: 按运行时 TSV 契约解析词头和近义词。
            entries: dict[str, list[str]] = {}
            for row in rows[1:]:
                word, separator, serialized_synonyms = row.partition("\t")
                self.assertEqual(separator, "\t")
                self.assertNotIn(word, entries)
                synonyms = serialized_synonyms.split(SYNONYM_SEPARATOR)
                entries[word] = synonyms

                # Then: 近义词非空、无自身项且稳定去重。
                self.assertTrue(all(synonyms))
                self.assertNotIn(word, synonyms)
                self.assertEqual(len(synonyms), len(set(synonyms)))

            constant = pack_id.upper().replace("-", "_")
            metadata_start = manifest.index(f"export const {constant}_SYNONYM_METADATA")
            metadata_end = manifest.index("} as const;", metadata_start)
            metadata = manifest[metadata_start:metadata_end]
            self.assertIn(f"entryCount: {len(entries)}", metadata)


if __name__ == "__main__":
    unittest.main()
