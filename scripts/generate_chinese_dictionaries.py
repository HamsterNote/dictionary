#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""从两个固定上游快照生成按需加载的中文词库。"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import unicodedata
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

# ─── How to run ───
# uv run scripts/generate_chinese_dictionaries.py <六个上游数据文件>

MEANING_SEPARATOR: Final = "\u001f"
PINYIN_VARIANT_SEPARATOR: Final = " / "
CATEGORY_VARIANT_SEPARATOR: Final = " / "
XINHUA_COMMIT: Final = "fe6d6c2e8baa82187f4c96bbe042e43f96c05666"
MAPULL_COMMIT: Final = "e804ada333b68afddfdccbe8dcc938a72da157a7"
EXPECTED_SHA256: Final = {
    "xinhua_word": "8ae3453eacc5b0f3fdfba47eac8bb686cd73914d278e8b851ae6ef81082f80e7",
    "xinhua_idiom": "1d4b4f454ce1c416d6a1ab2369d6e66c0ff99e04390172eef70790499e21ce19",
    "xinhua_ci": "739e086d61dc9b95cd1df92095720e6391f952a41c476d3281ef95ebed869a09",
    "mapull_base": "88fa110d0c708af8ae43f19537ac453ebe1b40ae02c738a7578498505eb771ab",
    "mapull_detail": "100f3d9557016be9fe3e893d3dad9d7756d852033b9514a85fa5d1d214a8004d",
    "mapull_words": "a85d96a3c6e55e831406b534b533ab4641176fdd80ac7dceaeb5af9bed333c58",
}


@dataclass(frozen=True, slots=True)
class SourcePaths:
    xinhua_word: Path
    xinhua_idiom: Path
    xinhua_ci: Path
    mapull_base: Path
    mapull_detail: Path
    mapull_words: Path
    output_directory: Path


@dataclass(frozen=True, slots=True)
class ChineseEntry:
    headword: str
    pinyin: str
    category: str
    meanings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SnapshotMetadata:
    entry_count: int
    gzip_bytes: int
    id: str
    label: str


class SnapshotMismatchError(RuntimeError):
    pass


class CategoryConflictError(RuntimeError):
    pass


def compact(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).replace("\t", " ").split())


def merge_word_entry(entries: dict[str, ChineseEntry], entry: ChineseEntry) -> None:
    previous = entries.get(entry.headword)
    if previous is None:
        entries[entry.headword] = entry
        return
    previous_categories = previous.category.split(CATEGORY_VARIANT_SEPARATOR)
    entry_categories = entry.category.split(CATEGORY_VARIANT_SEPARATOR)
    category_kinds = {
        category.partition(" · ")[0] for category in (*previous_categories, *entry_categories)
    }
    if len(category_kinds) != 1:
        raise CategoryConflictError(
            f"词头 {entry.headword!r} 的类别冲突：{previous.category!r} 与 {entry.category!r}"
        )
    category = CATEGORY_VARIANT_SEPARATOR.join(
        dict.fromkeys((*previous_categories, *entry_categories))
    )
    pinyin_variants = (
        *previous.pinyin.split(PINYIN_VARIANT_SEPARATOR),
        *entry.pinyin.split(PINYIN_VARIANT_SEPARATOR),
    )
    pinyin = PINYIN_VARIANT_SEPARATOR.join(
        dict.fromkeys(value for value in pinyin_variants if value)
    )
    meanings = tuple(dict.fromkeys((*previous.meanings, *entry.meanings)))
    entries[entry.headword] = replace(
        previous, pinyin=pinyin, category=category, meanings=meanings
    )


def verify_snapshot(path: Path, source_id: str) -> None:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    expected = EXPECTED_SHA256[source_id]
    if digest != expected:
        raise SnapshotMismatchError(f"{source_id} 快照校验失败：期望 {expected}，实际 {digest}")


def read_xinhua(paths: SourcePaths) -> list[ChineseEntry]:
    words = json.loads(paths.xinhua_word.read_text(encoding="utf-8"))
    idioms = json.loads(paths.xinhua_idiom.read_text(encoding="utf-8"))
    entries: list[ChineseEntry] = []
    for item in words:
        headword = compact(item.get("word", ""))
        explanation = compact(item.get("explanation", ""))
        if not headword or not explanation:
            continue
        details = [explanation]
        oldword = compact(item.get("oldword", ""))
        if oldword and oldword != headword:
            details.append(f"繁体：{oldword}")
        strokes = compact(item.get("strokes", ""))
        radical = compact(item.get("radicals", ""))
        category = "汉字" + (f" · {strokes}画" if strokes else "") + (f" · 部首{radical}" if radical else "")
        entries.append(
            ChineseEntry(headword, compact(item.get("pinyin", "")), category, tuple(details))
        )

    for item in idioms:
        headword = compact(item.get("word", ""))
        explanation = compact(item.get("explanation", ""))
        if not headword or not explanation:
            continue
        meanings = [explanation]
        derivation = compact(item.get("derivation", ""))
        example = compact(item.get("example", ""))
        if derivation and derivation != "无":
            meanings.append(f"出处：{derivation}")
        if example and example != "无":
            meanings.append(f"例句：{example}")
        entries.append(
            ChineseEntry(headword, compact(item.get("pinyin", "")), "成语", tuple(meanings))
        )
    return entries


def read_xinhua_words(path: Path) -> list[ChineseEntry]:
    entries: dict[str, ChineseEntry] = {}
    for item in json.loads(path.read_text(encoding="utf-8")):
        headword = unicodedata.normalize("NFKC", compact(item.get("ci", "")))
        explanation = compact(item.get("explanation", ""))
        if headword and explanation:
            merge_word_entry(entries, ChineseEntry(headword, "", "词语", (explanation,)))
    return list(entries.values())


def read_ndjson(path: Path) -> list[dict]:
    """读取上游逐行 JSON；每行末尾的逗号不是标准 NDJSON 的一部分。"""

    return [
        json.loads(line.rstrip().removesuffix(","))
        for line in path.read_text(encoding="utf-8").splitlines()
    ]


def read_mapull(paths: SourcePaths) -> list[ChineseEntry]:
    bases = {item["char"]: item for item in read_ndjson(paths.mapull_base)}
    entries: list[ChineseEntry] = []
    for detail in read_ndjson(paths.mapull_detail):
        headword = compact(detail.get("char", ""))
        base = bases.get(headword, {})
        meanings: list[str] = []
        pinyin: list[str] = []
        for pronunciation in detail.get("pronunciations", []):
            pronunciation_pinyin = compact(pronunciation.get("pinyin", ""))
            if pronunciation_pinyin:
                pinyin.append(pronunciation_pinyin)
            for explanation in pronunciation.get("explanations", []):
                content = compact(explanation.get("content", ""))
                if content and content not in meanings:
                    meanings.append(content)
        if not headword or not meanings:
            continue
        strokes = base.get("strokes")
        radical = compact(base.get("radicals", ""))
        category = "常用汉字" + (f" · {strokes}画" if strokes else "") + (f" · 部首{radical}" if radical else "")
        entries.append(ChineseEntry(headword, " ".join(dict.fromkeys(pinyin)), category, tuple(meanings)))
    return entries


def read_mapull_words(path: Path) -> list[ChineseEntry]:
    entries: dict[str, ChineseEntry] = {}
    for item in json.loads(path.read_text(encoding="utf-8")):
        headword = unicodedata.normalize("NFKC", compact(item.get("word", "")))
        explanation = compact(item.get("explanation", ""))
        if headword and explanation:
            merge_word_entry(
                entries,
                ChineseEntry(headword, compact(item.get("pinyin", "")), "词语", (explanation,)),
            )
    return list(entries.values())


def render_snapshot(entries: list[ChineseEntry], source: str, commit: str) -> str:
    unique: dict[str, ChineseEntry] = {}
    for entry in entries:
        normalized_headword = unicodedata.normalize("NFKC", entry.headword)
        merge_word_entry(unique, replace(entry, headword=normalized_headword))
    header = f"# {source} {commit} | entries {len(unique)}"
    rows = (
        f"{entry.headword}\t{entry.pinyin}\t{entry.category}\t{MEANING_SEPARATOR.join(entry.meanings)}"
        for entry in unique.values()
    )
    return "\n".join((header, *rows, ""))


def write_snapshot(paths: SourcePaths, metadata: SnapshotMetadata, rendered: str) -> SnapshotMetadata:
    output = paths.output_directory / f"{metadata.id}.tsv"
    output.write_text(rendered, encoding="utf-8", newline="\n")
    actual = SnapshotMetadata(rendered.count("\n") - 1, len(gzip.compress(rendered.encode(), mtime=0)), metadata.id, metadata.label)
    print(f"已生成 {actual.entry_count:,} 条词条：{output}")
    return actual


def render_manifest(items: tuple[SnapshotMetadata, ...]) -> str:
    constants = []
    for item in items:
        constant = item.id.upper().replace("-", "_")
        constants.append(
            f"export const {constant}_DICTIONARY_METADATA = {{\n"
            f"  entryCount: {item.entry_count},\n"
            f"  gzipBytes: {item.gzip_bytes},\n"
            f"  id: '{item.id}',\n"
            f"  label: '{item.label}',\n"
            "} as const;"
        )
    return "// 此文件由 scripts/generate_chinese_dictionaries.py 生成，请勿手工修改。\n\n" + "\n".join(constants) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xinhua_word", type=Path)
    parser.add_argument("xinhua_idiom", type=Path)
    parser.add_argument("xinhua_ci", type=Path)
    parser.add_argument("mapull_base", type=Path)
    parser.add_argument("mapull_detail", type=Path)
    parser.add_argument("mapull_words", type=Path)
    parser.add_argument("--output-directory", type=Path, default=Path("src/data"))
    arguments = parser.parse_args()
    paths = SourcePaths(**vars(arguments))
    for source_id in EXPECTED_SHA256:
        verify_snapshot(getattr(paths, source_id), source_id)

    paths.output_directory.mkdir(parents=True, exist_ok=True)
    xinhua = write_snapshot(
        paths,
        SnapshotMetadata(0, 0, "chinese-xinhua", "chinese-xinhua 上游整理"),
        render_snapshot(read_xinhua(paths), "chinese-xinhua", XINHUA_COMMIT),
    )
    xinhua_words = write_snapshot(
        paths,
        SnapshotMetadata(0, 0, "chinese-xinhua-words", "chinese-xinhua 词语"),
        render_snapshot(read_xinhua_words(paths.xinhua_ci), "chinese-xinhua", XINHUA_COMMIT),
    )
    mapull = write_snapshot(
        paths,
        SnapshotMetadata(0, 0, "chinese-dictionary", "chinese-dictionary"),
        render_snapshot(read_mapull(paths), "chinese-dictionary", MAPULL_COMMIT),
    )
    mapull_words = write_snapshot(
        paths,
        SnapshotMetadata(0, 0, "chinese-dictionary-words", "chinese-dictionary"),
        render_snapshot(read_mapull_words(paths.mapull_words), "chinese-dictionary", MAPULL_COMMIT),
    )
    (paths.output_directory / "chineseDictionaryManifest.ts").write_text(
        render_manifest((xinhua, xinhua_words, mapull, mapull_words)), encoding="utf-8", newline="\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
