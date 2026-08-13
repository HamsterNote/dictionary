#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""从固定 ECDICT CSV 生成高频核心和可选分类词汇包。"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Final

CORE_ENTRY_LIMIT: Final = 5_000
EXPECTED_SHA256: Final = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf"
SNAPSHOT_COMMIT: Final = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
MEANING_SEPARATOR: Final = "\u001f"
CJK_CHARACTER: Final = r"[\u3400-\u9fff]"
PACK_LABELS: Final = {
    "bnc": "BNC",
    "cet4": "CET-4",
    "cet6": "CET-6",
    "gk": "高考",
    "gre": "GRE",
    "ielts": "IELTS",
    "ky": "考研",
    "toefl": "TOEFL",
    "zk": "中考",
}
TAG_PACK_IDS: Final = tuple(pack_id for pack_id in PACK_LABELS if pack_id != "bnc")


@dataclass(frozen=True, slots=True)
class SourceEntry:
    word: str
    phonetic: str
    translation: str
    tags: frozenset[str]
    bnc: int
    frq: int

    @property
    def frequency_key(self) -> tuple[int, int, str]:
        """优先采用更靠前的语料排名，并让无排名词稳定靠后。"""

        missing_rank = 1_000_000
        frq_rank = self.frq if self.frq > 0 else missing_rank
        bnc_rank = self.bnc if self.bnc > 0 else missing_rank
        return min(frq_rank, bnc_rank), max(frq_rank, bnc_rank), self.word


@dataclass(frozen=True, slots=True)
class SnapshotMetadata:
    entry_count: int
    gzip_bytes: int


class SnapshotMismatchError(RuntimeError):
    """输入 CSV 不是项目固定并审核过的 ECDICT 快照。"""


def normalize_word(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().lower().split())


def compact_field(value: str, *, preserve_meanings: bool = False) -> str:
    normalized = (
        unicodedata.normalize("NFC", value)
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
    )
    if preserve_meanings:
        return MEANING_SEPARATOR.join(
            normalize_translation(part.strip())
            for part in normalized.split("\n")
            if part.strip()
        )
    return " ".join(normalized.replace("\t", " ").split())


def normalize_translation(value: str) -> str:
    normalized = re.sub(rf"(?<={CJK_CHARACTER}),\s*", "，", value).replace("...", "……")

    def normalize_parentheses(match: re.Match[str]) -> str:
        content = match.group(1)
        return f"（{content}）" if re.search(CJK_CHARACTER, content) else match.group(0)

    return re.sub(r"\(([^()]*)\)", normalize_parentheses, normalized)


def read_entries(source: Path) -> list[SourceEntry]:
    entries: list[SourceEntry] = []
    with source.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            word = normalize_word(row["word"])
            translation = compact_field(row["translation"], preserve_meanings=True)
            if not word or not translation:
                continue
            entries.append(
                SourceEntry(
                    word=word,
                    phonetic=compact_field(row["phonetic"]),
                    translation=translation,
                    tags=frozenset(row["tag"].split()),
                    bnc=int(row["bnc"] or 0),
                    frq=int(row["frq"] or 0),
                )
            )
    return entries


def deduplicate(entries: list[SourceEntry]) -> list[SourceEntry]:
    selected: list[SourceEntry] = []
    seen: set[str] = set()
    for entry in sorted(entries, key=lambda item: item.frequency_key):
        if entry.word in seen:
            continue
        seen.add(entry.word)
        selected.append(entry)
    return selected


def select_snapshots(entries: list[SourceEntry]) -> dict[str, list[SourceEntry]]:
    """生成小型核心、完整考试标签包和 BNC 排名包。"""

    unique_entries = deduplicate(entries)
    ranked_entries = [entry for entry in unique_entries if entry.bnc > 0 or entry.frq > 0]
    core = ranked_entries[:CORE_ENTRY_LIMIT]
    core_words = {entry.word for entry in core}
    snapshots = {
        "core": core,
        "bnc": sorted(
            (entry for entry in unique_entries if entry.bnc > 0 and entry.word not in core_words),
            key=lambda entry: (entry.bnc, entry.word),
        ),
    }
    for pack_id in TAG_PACK_IDS:
        snapshots[pack_id] = [
            entry for entry in unique_entries if pack_id in entry.tags and entry.word not in core_words
        ]
    return snapshots


def render_snapshot(pack_id: str, entries: list[SourceEntry]) -> str:
    header = (
        f"# ECDICT {SNAPSHOT_COMMIT} | sha256 {EXPECTED_SHA256} | "
        f"pack {pack_id} | entries {len(entries)}"
    )
    rows = (f"{entry.word}\t{entry.phonetic}\t{entry.translation}" for entry in entries)
    return "\n".join((header, *rows, ""))


def render_manifest(metadata: dict[str, SnapshotMetadata]) -> str:
    rows = []
    for pack_id, item in metadata.items():
        label = "高频核心" if pack_id == "core" else PACK_LABELS[pack_id]
        constant = pack_id.upper().replace("-", "_")
        rows.append(
            f"export const {constant}_VOCABULARY_METADATA = {{\n"
            f"  entryCount: {item.entry_count},\n"
            f"  gzipBytes: {item.gzip_bytes},\n"
            f"  id: '{pack_id}',\n"
            f"  label: '{label}',\n"
            "} as const;"
        )
    return "// 此文件由 scripts/generate_ecdict.py 生成，请勿手工修改。\n\n" + "\n".join(rows) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="ECDICT 仓库中的 ecdict.csv")
    parser.add_argument("--output-directory", type=Path, default=Path("src/data"))
    arguments = parser.parse_args()

    digest = hashlib.sha256(arguments.source.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SnapshotMismatchError(f"ECDICT 快照校验失败：期望 {EXPECTED_SHA256}，实际 {digest}")

    arguments.output_directory.mkdir(parents=True, exist_ok=True)
    metadata: dict[str, SnapshotMetadata] = {}
    for pack_id, entries in select_snapshots(read_entries(arguments.source)).items():
        rendered = render_snapshot(pack_id, entries)
        output = arguments.output_directory / f"ecdict-{pack_id}.tsv"
        output.write_text(rendered, encoding="utf-8", newline="\n")
        metadata[pack_id] = SnapshotMetadata(
            entry_count=len(entries),
            gzip_bytes=len(gzip.compress(rendered.encode(), mtime=0)),
        )
        print(f"已生成 {len(entries):,} 条词条：{output}")

    manifest = arguments.output_directory / "ecdictManifest.ts"
    manifest.write_text(render_manifest(metadata), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
