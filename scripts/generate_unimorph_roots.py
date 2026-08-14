#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""从固定 UniMorph 英语派生快照生成按词包懒加载的派生词根数据。

CityLex 词表仅用于可选覆盖率校验，不参与筛选，也不会写入发布产物。

How to run:
    uv run scripts/generate_unimorph_roots.py /path/to/eng.derivations.tsv
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Final

EXPECTED_SHA256: Final = "743fff8ddb3ff26ae413af1fa859806106ffff69628be4cb7ed4d34f677deed2"
UNIMORPH_COMMIT: Final = "66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b"
UNIMORPH_SOURCE_URL: Final = (
    f"https://github.com/unimorph/eng/blob/{UNIMORPH_COMMIT}/eng.derivations.tsv"
)
CITYLEX_SOURCE_URL: Final = "https://github.com/CUNY-CL/citylex"
PACK_ORDER: Final = ("core", "zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre", "bnc")
PACK_LABELS: Final = {
    "core": "高频核心",
    "zk": "中考",
    "gk": "高考",
    "cet4": "CET-4",
    "cet6": "CET-6",
    "ky": "考研",
    "ielts": "IELTS",
    "toefl": "TOEFL",
    "gre": "GRE",
    "bnc": "BNC",
}


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    source: Path
    vocabulary_directory: Path
    output_directory: Path
    citylex_words: Path | None = None
    expected_sha256: str | None = EXPECTED_SHA256


@dataclass(frozen=True, slots=True)
class Derivation:
    base: str
    affix: str
    source_part_of_speech: str
    target_part_of_speech: str

    def serialize(self, word: str) -> str:
        return "\t".join(
            (word, self.base, self.affix, self.source_part_of_speech, self.target_part_of_speech)
        )


@dataclass(frozen=True, slots=True)
class GenerationReport:
    generated_entries: int
    citylex_matched_entries: int


@dataclass(frozen=True, slots=True)
class SnapshotMetadata:
    entry_count: int
    gzip_bytes: int


class SnapshotMismatchError(RuntimeError):
    pass


def normalize_word(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().split())


def read_pack_words(directory: Path) -> dict[str, frozenset[str]]:
    packs: dict[str, frozenset[str]] = {}
    for source in sorted(directory.glob("ecdict-*.tsv")):
        pack_id = source.stem.removeprefix("ecdict-")
        words = {
            normalize_word(line.partition("\t")[0])
            for line in source.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")
        }
        packs[pack_id] = frozenset(word for word in words if word)
    return packs


def sha256_file(source: Path) -> str:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def parse_derivations(source: Path, target_words: frozenset[str]) -> dict[str, tuple[Derivation, ...]]:
    selected: dict[str, list[Derivation]] = {}
    seen: dict[str, set[Derivation]] = {}
    for line in source.read_text(encoding="utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) != 4:
            continue
        raw_base, raw_derived, raw_parts, raw_affix = fields
        base = normalize_word(raw_base)
        derived = normalize_word(raw_derived)
        parts = raw_parts.strip().split(":", maxsplit=1)
        affix = unicodedata.normalize("NFKC", raw_affix).strip()
        if derived not in target_words or not base or not affix or len(parts) != 2:
            continue
        source_part, target_part = (part.strip() for part in parts)
        if not source_part or not target_part:
            continue
        derivation = Derivation(base, affix, source_part, target_part)
        word_seen = seen.setdefault(derived, set())
        if derivation in word_seen:
            continue
        word_seen.add(derivation)
        selected.setdefault(derived, []).append(derivation)
    return {word: tuple(items) for word, items in selected.items()}


def read_citylex_words(source: Path | None) -> frozenset[str]:
    if source is None:
        return frozenset()
    words = {
        normalize_word(line.partition("\t")[0].partition(",")[0])
        for line in source.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    }
    return frozenset(word for word in words if word)


def render_pack(pack_id: str, source_digest: str, entries: dict[str, tuple[Derivation, ...]]) -> str:
    header = (
        f"# UniMorph eng {UNIMORPH_COMMIT} | sha256 {source_digest} | "
        f"pack {pack_id} | entries {len(entries)}"
    )
    rows = (
        item.serialize(word)
        for word in sorted(entries)
        for item in entries[word]
    )
    return "\n".join((header, *rows, ""))


def render_manifest(metadata: dict[str, SnapshotMetadata]) -> str:
    rows: list[str] = []
    for pack_id in (*PACK_ORDER, *sorted(metadata.keys() - PACK_ORDER)):
        item = metadata.get(pack_id)
        if item is None:
            continue
        constant = pack_id.upper().replace("-", "_")
        label = PACK_LABELS.get(pack_id, pack_id)
        rows.append(
            f"export const {constant}_ROOT_METADATA = {{\n"
            f"  entryCount: {item.entry_count},\n"
            f"  gzipBytes: {item.gzip_bytes},\n"
            f"  id: '{pack_id}',\n"
            f"  label: '{label}派生词根',\n"
            "} as const;"
        )
    return "// 此文件由 scripts/generate_unimorph_roots.py 生成，请勿手工修改。\n\n" + "\n".join(rows) + "\n"


def generate_root_packs(request: GenerationRequest) -> GenerationReport:
    source_digest = sha256_file(request.source)
    if request.expected_sha256 is not None and source_digest != request.expected_sha256:
        raise SnapshotMismatchError(
            f"UniMorph 快照校验失败：期望 {request.expected_sha256}，实际 {source_digest}"
        )
    packs = read_pack_words(request.vocabulary_directory)
    target_words = frozenset().union(*packs.values())
    all_derivations = parse_derivations(request.source, target_words)
    request.output_directory.mkdir(parents=True, exist_ok=True)
    metadata: dict[str, SnapshotMetadata] = {}
    for pack_id, words in packs.items():
        entries = {word: all_derivations[word] for word in words if word in all_derivations}
        rendered = render_pack(pack_id, source_digest, entries)
        output = request.output_directory / f"unimorph-roots-{pack_id}.tsv"
        output.write_text(rendered, encoding="utf-8", newline="\n")
        metadata[pack_id] = SnapshotMetadata(
            entry_count=len(entries),
            gzip_bytes=len(gzip.compress(rendered.encode(), mtime=0)),
        )
        print(f"已生成 {len(entries):,} 个单词的派生词根：{output}")
    manifest = request.output_directory / "unimorphRootManifest.ts"
    manifest.write_text(render_manifest(metadata), encoding="utf-8", newline="\n")
    citylex_words = read_citylex_words(request.citylex_words)
    generated_words = frozenset(all_derivations)
    return GenerationReport(
        generated_entries=len(generated_words),
        citylex_matched_entries=len(generated_words & citylex_words),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help=f"固定快照，来源 {UNIMORPH_SOURCE_URL}")
    parser.add_argument("--citylex-words", type=Path, help=f"可选覆盖率词表，方法来源 {CITYLEX_SOURCE_URL}")
    parser.add_argument("--vocabulary-directory", type=Path, default=Path("src/data"))
    parser.add_argument("--output-directory", type=Path, default=Path("src/data"))
    arguments = parser.parse_args()
    report = generate_root_packs(
        GenerationRequest(
            source=arguments.source,
            vocabulary_directory=arguments.vocabulary_directory,
            output_directory=arguments.output_directory,
            citylex_words=arguments.citylex_words,
        )
    )
    if arguments.citylex_words is not None:
        print(f"CityLex 本地词表覆盖 {report.citylex_matched_entries:,} / {report.generated_entries:,} 个词头")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
