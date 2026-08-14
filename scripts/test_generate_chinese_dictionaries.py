#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""中文词库生成器的数据合并与已提交快照契约测试。"""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from generate_chinese_dictionaries import (
    MEANING_SEPARATOR,
    CategoryConflictError,
    ChineseEntry,
    read_mapull_words,
    render_snapshot,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PACK_IDS = (
    "chinese-xinhua",
    "chinese-xinhua-words",
    "chinese-dictionary",
    "chinese-dictionary-words",
)


class GenerateChineseDictionariesTest(unittest.TestCase):
    def test_merges_pronunciations_meanings_and_nfkc_equivalent_headwords(self) -> None:
        # Given: 同一词头的异音、多释义、重复记录，以及 NFKC 等价标点。
        entries = [
            ChineseEntry("为山九仞﹐功亏一篑", "wéi shān", "词语", ("释义一",)),
            ChineseEntry("为山九仞，功亏一篑", "wèi shān", "词语", ("释义二",)),
            ChineseEntry("为山九仞，功亏一篑", "wéi shān", "词语", ("释义一",)),
        ]

        # When: 将条目渲染为运行时使用的 TSV。
        rendered = render_snapshot(entries, "fixture", "commit")

        # Then: 等价词头合为一条，完整拼音变体有明确边界，释义保持去重。
        rows = rendered.splitlines()
        self.assertEqual(rows[0], "# fixture commit | entries 1")
        self.assertEqual(
            rows[1],
            f"为山九仞,功亏一篑\twéi shān / wèi shān\t词语\t释义一{MEANING_SEPARATOR}释义二",
        )

    def test_rejects_category_conflicts_after_normalization(self) -> None:
        # Given: NFKC 后词头相同、类别却不同的两条数据。
        entries = [
            ChineseEntry("Ａ", "a", "汉字", ("字义",)),
            ChineseEntry("A", "a", "词语", ("词义",)),
        ]

        # When / Then: 生成器拒绝静默覆盖不同类别。
        with self.assertRaisesRegex(CategoryConflictError, "类别冲突"):
            render_snapshot(entries, "fixture", "commit")

    def test_preserves_metadata_variants_within_the_same_category(self) -> None:
        # Given: 同一汉字的固定上游记录含有互相矛盾的笔画元数据。
        entries = [
            ChineseEntry("薭", "bài", "汉字 · 16画 · 部首艹", ("释义一",)),
            ChineseEntry("薭", "bài", "汉字 · 8画", ("释义二",)),
        ]

        # When: 合并同一语义类别下的记录。
        rendered = render_snapshot(entries, "fixture", "commit")

        # Then: 两种元数据均显式保留，不会因整段类别字符串不同而丢失条目。
        self.assertIn("\t汉字 · 16画 · 部首艹 / 汉字 · 8画\t", rendered)

    def test_mapull_word_reader_preserves_complete_pinyin_variants(self) -> None:
        # Given: Mapull 词语 JSON 中两个 NFKC 等价词头及一个完全重复项。
        items = [
            {"word": "测试﹐词", "pinyin": "cè shì cí", "explanation": "释义一"},
            {"word": "测试，词", "pinyin": "cè shí cí", "explanation": "释义二"},
            {"word": "测试，词", "pinyin": "cè shì cí", "explanation": "释义一"},
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "word.json"
            source.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

            # When: 读取并合并词语快照。
            entries = read_mapull_words(source)

        # Then: 只生成一条，拼音和释义都按完整值去重。
        self.assertEqual(
            entries,
            [
                ChineseEntry(
                    "测试,词",
                    "cè shì cí / cè shí cí",
                    "词语",
                    ("释义一", "释义二"),
                )
            ],
        )

    def test_checked_in_snapshots_match_headers_and_manifest_counts(self) -> None:
        # Given: 准备发布的四个中文 TSV 与生成 manifest。
        data_directory = PROJECT_ROOT / "src" / "data"
        manifest = (data_directory / "chineseDictionaryManifest.ts").read_text(
            encoding="utf-8"
        )

        for pack_id in PACK_IDS:
            snapshot = (data_directory / f"{pack_id}.tsv").read_text(encoding="utf-8")
            rows = snapshot.splitlines()
            header_count = int(rows[0].rsplit(" ", 1)[1])
            constant = pack_id.upper().replace("-", "_")
            metadata_match = re.search(
                rf"export const {constant}_DICTIONARY_METADATA = \{{\s+entryCount: (\d+)",
                manifest,
            )

            # When / Then: 文件实际行数、头部计数和运行时 manifest 完全一致。
            if metadata_match is None:
                self.fail(f"manifest 缺少 {constant} 元数据")
            self.assertEqual(header_count, len(rows) - 1)
            self.assertEqual(int(metadata_match.group(1)), header_count)

        # Then: chinese-dictionary 的两个词包共享同一个对外来源名。
        self.assertEqual(manifest.count("label: 'chinese-dictionary'"), 2)


if __name__ == "__main__":
    unittest.main()
