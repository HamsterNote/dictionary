#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""从固定 WordNet 3.1 快照为英文词包生成近义词补充包。

How to run:
    uv run scripts/generate_wordnet_synonyms.py /path/to/wn3.1.dict.tar.gz
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import tarfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Final

EXPECTED_SHA256: Final = "3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a"
SYNONYM_SEPARATOR: Final = "\u001f"
WORDNET_SOURCE_URL: Final = "https://wordnetcode.princeton.edu/"
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
DATA_MEMBERS: Final = tuple(f"dict/data.{part}" for part in ("noun", "verb", "adj", "adv"))


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    source: Path
    vocabulary_directory: Path
    output_directory: Path
    expected_sha256: str | None = EXPECTED_SHA256


@dataclass(frozen=True, slots=True)
class SnapshotMetadata:
    entry_count: int
    gzip_bytes: int


class SnapshotMismatchError(RuntimeError):
    pass


def normalize_word(value: str) -> str:
    return " ".join(
        unicodedata.normalize("NFKC", value.replace("_", " ")).strip().casefold().split()
    )


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


def parse_synset_words(line: str) -> tuple[str, ...]:
    if not line or line[0].isspace():
        return ()
    fields = line.partition("|")[0].split()
    if len(fields) < 5:
        return ()
    word_count = int(fields[3], 16)
    word_fields_end = 4 + word_count * 2
    if len(fields) < word_fields_end:
        return ()
    return tuple(
        dict.fromkeys(
            normalized
            for index in range(4, word_fields_end, 2)
            if (normalized := normalize_word(fields[index]))
        )
    )


def collect_synonyms(
    archive: tarfile.TarFile, target_words: frozenset[str]
) -> dict[str, tuple[str, ...]]:
    selected: dict[str, list[str]] = {}
    seen: dict[str, set[str]] = {}
    available_members = frozenset(archive.getnames())
    for member_name in DATA_MEMBERS:
        if member_name not in available_members:
            continue
        stream = archive.extractfile(member_name)
        if stream is None:
            continue
        with stream:
            for raw_line in stream:
                synset_words = parse_synset_words(raw_line.decode("utf-8"))
                for word in synset_words:
                    if word not in target_words:
                        continue
                    word_synonyms = selected.setdefault(word, [])
                    word_seen = seen.setdefault(word, set())
                    for synonym in synset_words:
                        if synonym == word or synonym in word_seen:
                            continue
                        word_seen.add(synonym)
                        word_synonyms.append(synonym)
    return {word: tuple(synonyms) for word, synonyms in selected.items() if synonyms}


def render_pack(pack_id: str, source_digest: str, synonyms: dict[str, tuple[str, ...]]) -> str:
    header = f"# WordNet 3.1 | sha256 {source_digest} | pack {pack_id} | entries {len(synonyms)}"
    rows = (f"{word}\t{SYNONYM_SEPARATOR.join(synonyms[word])}" for word in sorted(synonyms))
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
            f"export const {constant}_SYNONYM_METADATA = {{\n"
            f"  entryCount: {item.entry_count},\n"
            f"  gzipBytes: {item.gzip_bytes},\n"
            f"  id: '{pack_id}',\n"
            f"  label: '{label}近义词',\n"
            "} as const;"
        )
    return "// 此文件由 scripts/generate_wordnet_synonyms.py 生成，请勿手工修改。\n\n" + "\n".join(rows) + "\n"


def generate_synonym_packs(request: GenerationRequest) -> None:
    source_digest = sha256_file(request.source)
    if request.expected_sha256 is not None and source_digest != request.expected_sha256:
        raise SnapshotMismatchError(
            f"WordNet 快照校验失败：期望 {request.expected_sha256}，实际 {source_digest}"
        )

    packs = read_pack_words(request.vocabulary_directory)
    target_words = frozenset().union(*packs.values())
    with tarfile.open(request.source, "r:gz") as archive:
        all_synonyms = collect_synonyms(archive, target_words)

    request.output_directory.mkdir(parents=True, exist_ok=True)
    metadata: dict[str, SnapshotMetadata] = {}
    for pack_id, words in packs.items():
        synonyms = {word: all_synonyms[word] for word in words if word in all_synonyms}
        rendered = render_pack(pack_id, source_digest, synonyms)
        output = request.output_directory / f"wordnet-synonyms-{pack_id}.tsv"
        output.write_text(rendered, encoding="utf-8", newline="\n")
        metadata[pack_id] = SnapshotMetadata(
            entry_count=len(synonyms),
            gzip_bytes=len(gzip.compress(rendered.encode(), mtime=0)),
        )
        print(f"已生成 {len(synonyms):,} 个单词的近义词：{output}")

    manifest = request.output_directory / "wordnetSynonymManifest.ts"
    manifest.write_text(render_manifest(metadata), encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help=f"固定快照，来源 {WORDNET_SOURCE_URL}")
    parser.add_argument("--vocabulary-directory", type=Path, default=Path("src/data"))
    parser.add_argument("--output-directory", type=Path, default=Path("src/data"))
    arguments = parser.parse_args()
    generate_synonym_packs(
        GenerationRequest(
            source=arguments.source,
            vocabulary_directory=arguments.vocabulary_directory,
            output_directory=arguments.output_directory,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
