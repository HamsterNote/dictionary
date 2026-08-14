#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""ECDICT 词形与反向索引生成器的端到端夹具测试。

How to run:
    uv run scripts/test_generate_ecdict_inflections.py
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from generate_ecdict_inflections import GenerationRequest, generate_inflection_packs


class GenerateEcdictInflectionsTest(unittest.TestCase):
    def test_generates_forward_and_reverse_lazy_packs(self) -> None:
        # Given: 含规则、不规则、重复词形及无效记录的微型 ECDICT CSV。
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "ecdict.csv"
            output_directory = root / "output"
            source.write_text(
                "word,exchange\n"
                'study,"p:studied/d:studied/i:studying/3:studies"\n'
                'good,"r:better/t:best"\n'
                'child,"s:children"\n'
                'perceived,"0:perceive/1:pd"\n'
                'court-martial,"s:court-martials/f:courts-martial"\n'
                'empty,"0:empty"\n'
                'broken,"not-an-exchange"\n',
                encoding="utf-8",
            )

            # When: 从 exchange 字段生成两个彼此独立的懒加载快照。
            report = generate_inflection_packs(
                GenerationRequest(
                    source=source,
                    output_directory=output_directory,
                    expected_sha256=None,
                )
            )

            # Then: 正向包保留词形类型，反向包可由变形词精确找到原词。
            forms = (output_directory / "ecdict-inflections.tsv").read_text(encoding="utf-8")
            reverse = (output_directory / "ecdict-inflection-index.tsv").read_text(
                encoding="utf-8"
            )
            manifest = (output_directory / "ecdictInflectionManifest.ts").read_text(
                encoding="utf-8"
            )
            self.assertIn("study\tp\tstudied", forms)
            self.assertIn("study\td\tstudied", forms)
            self.assertIn("study\ti\tstudying", forms)
            self.assertIn("study\t3\tstudies", forms)
            self.assertIn("good\tr\tbetter", forms)
            self.assertIn("good\tt\tbest", forms)
            self.assertIn("child\ts\tchildren", forms)
            self.assertIn("perceive\tp\tperceived", forms)
            self.assertIn("perceive\td\tperceived", forms)
            self.assertIn("court-martial\ts\tcourts-martial", forms)
            self.assertNotIn("empty\t0", forms)
            self.assertNotIn("broken", forms)
            self.assertIn("studying\tstudy\ti", reverse)
            self.assertIn("studied\tstudy\tp", reverse)
            self.assertIn("studied\tstudy\td", reverse)
            self.assertEqual(report.lemma_count, 5)
            self.assertEqual(report.form_count, 10)
            self.assertIn("INFLECTION_FORMS_METADATA", manifest)
            self.assertIn("INFLECTION_INDEX_METADATA", manifest)


if __name__ == "__main__":
    unittest.main()
