#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""OANC 例句包生成器的最小端到端夹具测试。

How to run:
    uv run scripts/test_generate_oanc_examples.py
"""

from __future__ import annotations

import tempfile
import unittest
import unicodedata
import zipfile
from pathlib import Path

from generate_oanc_examples import (
    EXAMPLE_SEPARATOR,
    PACK_ORDER,
    GenerationRequest,
    contains_complete_word,
    generate_example_packs,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class GenerateOancExamplesTest(unittest.TestCase):
    def test_generates_customized_packs_with_at_most_two_clean_examples(self) -> None:
        # Given: 两个词包，以及含有效、重复、过短和 URL 句子的微型 OANC 快照。
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vocabulary_directory = root / "vocabulary"
            output_directory = root / "output"
            vocabulary_directory.mkdir()
            (vocabulary_directory / "ecdict-core.tsv").write_text(
                "# fixture\napple\t\t苹果\npear\t\t梨\nfa\t\t音名\nabd\t\t缩写\nm\t\t米\n",
                encoding="utf-8",
            )
            (vocabulary_directory / "ecdict-gre.tsv").write_text(
                "# fixture\nmeticulous\t\t一丝不苟的\n",
                encoding="utf-8",
            )

            sentences = (
                "An apple rested beside the open notebook.\n"
                "She sliced the apple and shared it after lunch.\n"
                "This apple sentence is the third acceptable candidate.\n"
                "Apple.\n"
                "Visit https://example.com to read about an apple.\n"
                "The pineapple remained untouched on the counter.\n"
                "The façade remained unchanged after the careful restoration.\n"
                "Abdül reviewed the document before the afternoon meeting.\n"
                "The sample measured 20 μm under the laboratory microscope.\n"
                "Her meticulous notes made the difficult review much easier.\n"
            )
            boundaries: list[tuple[int, int]] = []
            cursor = 0
            for sentence in sentences.splitlines(keepends=True):
                boundaries.append((cursor, cursor + len(sentence.rstrip("\n"))))
                cursor += len(sentence)

            source = root / "oanc.zip"
            regions = "".join(
                f'<region xml:id="s-r{index}" anchors="{start} {end}" />'
                for index, (start, end) in enumerate(boundaries)
            )
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("OANC/data/fixture.txt", sentences)
                archive.writestr(
                    "OANC/data/fixture-s.xml",
                    f'<graph xmlns:xml="http://www.w3.org/XML/1998/namespace">{regions}</graph>',
                )

            # When: 对全部现有词包进行一次语料扫描和定制输出。
            generate_example_packs(
                GenerationRequest(
                    source=source,
                    vocabulary_directory=vocabulary_directory,
                    output_directory=output_directory,
                    expected_sha256=None,
                )
            )

            # Then: 每包只含自身词汇，过滤劣质匹配，并且每词最多保留两句。
            core = (output_directory / "oanc-examples-core.tsv").read_text(encoding="utf-8")
            gre = (output_directory / "oanc-examples-gre.tsv").read_text(encoding="utf-8")
            manifest = (output_directory / "oancExampleManifest.ts").read_text(encoding="utf-8")
            apple_row = next(line for line in core.splitlines() if line.startswith("apple\t"))

            self.assertEqual(apple_row.count("\u001f"), 1)
            self.assertNotIn("https://", core)
            self.assertNotIn("pineapple", core)
            self.assertNotIn("façade", core)
            self.assertNotIn("Abdül", core)
            self.assertNotIn("μm", core)
            self.assertNotIn("\npear\t", core)
            self.assertIn("meticulous\tHer meticulous notes", gre)
            self.assertNotIn("apple\t", gre)
            self.assertIn("CORE_EXAMPLE_METADATA", manifest)
            self.assertIn("entryCount: 1", manifest)

    def test_checked_in_packs_follow_the_generated_data_contract(self) -> None:
        # Given: 仓库中准备发布的十个 OANC 例句快照及其 manifest。
        data_directory = PROJECT_ROOT / "src" / "data"
        manifest = (data_directory / "oancExampleManifest.ts").read_text(encoding="utf-8")

        for pack_id in PACK_ORDER:
            snapshot = (data_directory / f"oanc-examples-{pack_id}.tsv").read_text(encoding="utf-8")
            rows = snapshot.splitlines()
            self.assertRegex(rows[0], rf"^# OANC GrAF .* pack {pack_id} .* entries \d+$")

            # When: 按运行时 TSV 契约解析每一个词头和例句列表。
            entries: dict[str, list[str]] = {}
            for row in rows[1:]:
                word, separator, serialized_examples = row.partition("\t")
                self.assertEqual(separator, "\t")
                self.assertNotIn(word, entries)
                examples = serialized_examples.split(EXAMPLE_SEPARATOR)
                entries[word] = examples

                # Then: 每个已覆盖词头有 1–2 条完整词形匹配的例句。
                self.assertIn(len(examples), (1, 2))
                normalized_word = unicodedata.normalize("NFKC", word).casefold()
                for example in examples:
                    normalized_example = unicodedata.normalize("NFKC", example).casefold()
                    self.assertTrue(
                        contains_complete_word(normalized_example, normalized_word),
                        f"{pack_id}:{word} 错配到 {example}",
                    )

            constant = pack_id.upper().replace("-", "_")
            metadata_start = manifest.index(f"export const {constant}_EXAMPLE_METADATA")
            metadata_end = manifest.index("} as const;", metadata_start)
            metadata = manifest[metadata_start:metadata_end]
            self.assertIn(f"entryCount: {len(entries)}", metadata)


if __name__ == "__main__":
    unittest.main()
