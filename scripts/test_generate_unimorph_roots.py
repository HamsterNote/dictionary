#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""UniMorph 英语派生词根包生成器的端到端夹具测试。

How to run:
    uv run scripts/test_generate_unimorph_roots.py
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from generate_unimorph_roots import (
    PACK_ORDER,
    UNIMORPH_COMMIT,
    GenerationRequest,
    generate_root_packs,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class GenerateUnimorphRootsTest(unittest.TestCase):
    def test_generates_normalized_pack_specific_derivations(self) -> None:
        # Given: 两个词包、一份微型 UniMorph 派生快照和仅用于覆盖率校验的 CityLex 词表。
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vocabulary_directory = root / "vocabulary"
            output_directory = root / "output"
            vocabulary_directory.mkdir()
            (vocabulary_directory / "ecdict-core.tsv").write_text(
                "# fixture\nhappiness\t\t幸福\nunfair\t\t不公平\nmissing\t\t缺失\n",
                encoding="utf-8",
            )
            (vocabulary_directory / "ecdict-gre.tsv").write_text(
                "# fixture\nmodernism\t\t现代主义\n",
                encoding="utf-8",
            )
            source = root / "eng.derivations.tsv"
            source.write_text(
                "happy\thappiness\tADJ:N\t-ness\n"
                "happy\thappiness\tADJ:N\t-ness\n"
                "fair\tunfair\tADJ:ADJ\tun-\n"
                "modern\tmodernism\tADJ:N\t-ism\n"
                "bad row\n",
                encoding="utf-8",
            )
            citylex = root / "citylex-words.txt"
            citylex.write_text("happiness\nunfair\n", encoding="utf-8")

            # When: 生成器按现有英文词包过滤，并用 CityLex 词表计算覆盖率。
            report = generate_root_packs(
                GenerationRequest(
                    source=source,
                    vocabulary_directory=vocabulary_directory,
                    output_directory=output_directory,
                    citylex_words=citylex,
                    expected_sha256=None,
                )
            )

            # Then: 直接派生关系被规范化、稳定去重，CityLex 内容不写入数据行。
            core = (output_directory / "unimorph-roots-core.tsv").read_text(encoding="utf-8")
            gre = (output_directory / "unimorph-roots-gre.tsv").read_text(encoding="utf-8")
            manifest = (output_directory / "unimorphRootManifest.ts").read_text(encoding="utf-8")
            self.assertIn(
                "happiness\thappy\t-ness\tADJ\tN",
                core,
            )
            self.assertEqual(core.count("happiness\t"), 1)
            self.assertIn(
                "unfair\tfair\tun-\tADJ\tADJ",
                core,
            )
            self.assertIn("modernism\tmodern", gre)
            self.assertNotIn("missing\t", core)
            self.assertEqual(report.citylex_matched_entries, 2)
            self.assertEqual(report.generated_entries, 3)
            self.assertIn("CORE_ROOT_METADATA", manifest)
            self.assertIn("entryCount: 2", manifest)

    def test_checked_in_packs_follow_the_runtime_contract(self) -> None:
        # Given: 仓库中准备发布的十个 UniMorph 派生词根快照及 manifest。
        data_directory = PROJECT_ROOT / "src" / "data"
        manifest = (data_directory / "unimorphRootManifest.ts").read_text(encoding="utf-8")

        for pack_id in PACK_ORDER:
            snapshot = (data_directory / f"unimorph-roots-{pack_id}.tsv").read_text(
                encoding="utf-8"
            )
            rows = snapshot.splitlines()
            self.assertRegex(
                rows[0],
                rf"^# UniMorph eng {UNIMORPH_COMMIT} .* pack {pack_id} .* entries \d+$",
            )

            # When: 按运行时 TSV 契约解析每个词头的派生记录。
            entries: dict[str, list[tuple[str, str, str, str]]] = {}
            for row in rows[1:]:
                fields = row.split("\t")
                self.assertEqual(len(fields), 5)
                word, base, affix, source_part, target_part = fields
                derivation = (base, affix, source_part, target_part)
                entries.setdefault(word, []).append(derivation)

                # Then: 每条记录都含四个非空字段，且按词头稳定去重。
                self.assertTrue(all(derivation))

            for derivations in entries.values():
                self.assertEqual(len(derivations), len(set(derivations)))

            constant = pack_id.upper().replace("-", "_")
            metadata_start = manifest.index(f"export const {constant}_ROOT_METADATA")
            metadata_end = manifest.index("} as const;", metadata_start)
            metadata = manifest[metadata_start:metadata_end]
            self.assertIn(f"entryCount: {len(entries)}", metadata)


if __name__ == "__main__":
    unittest.main()
