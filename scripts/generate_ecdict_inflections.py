#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""从固定 ECDICT CSV 生成正向词形与反向词源索引懒加载包。

How to run:
    uv run scripts/generate_ecdict_inflections.py /path/to/ecdict.csv
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Final

EXPECTED_SHA256: Final = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf"
SNAPSHOT_COMMIT: Final = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
SUPPORTED_TYPES: Final = frozenset(("p", "d", "i", "3", "r", "t", "s"))
LEGACY_TYPES: Final = {"b": "r", "f": "s", "z": "t"}


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    source: Path
    output_directory: Path
    expected_sha256: str | None = EXPECTED_SHA256


@dataclass(frozen=True, slots=True)
class Inflection:
    lemma: str
    kind: str
    form: str


@dataclass(frozen=True, slots=True)
class GenerationReport:
    lemma_count: int
    form_count: int


@dataclass(frozen=True, slots=True)
class SnapshotMetadata:
    entry_count: int
    gzip_bytes: int


class SnapshotMismatchError(RuntimeError):
    pass


def normalize_word(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().split())


def sha256_file(source: Path) -> str:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def parse_exchange(word: str, exchange: str) -> tuple[Inflection, ...]:
    values: dict[str, str] = {}
    for item in exchange.split("/"):
        raw_kind, separator, raw_value = item.partition(":")
        if separator:
            values[raw_kind.strip()] = raw_value.strip()

    inflections: list[Inflection] = []
    seen: set[tuple[str, str]] = set()
    for raw_kind, raw_forms in values.items():
        kind = LEGACY_TYPES.get(raw_kind, raw_kind)
        if kind not in SUPPORTED_TYPES or (raw_kind == "s" and "f" in values):
            continue
        for raw_form in raw_forms.split(","):
            form = normalize_word(raw_form)
            identity = (kind, form)
            if not form or form == word or identity in seen:
                continue
            seen.add(identity)
            inflections.append(Inflection(lemma=word, kind=kind, form=form))

    source = normalize_word(values.get("0", ""))
    for raw_kind in values.get("1", ""):
        kind = LEGACY_TYPES.get(raw_kind, raw_kind)
        identity = (kind, word)
        if source and source != word and kind in SUPPORTED_TYPES and identity not in seen:
            seen.add(identity)
            inflections.append(Inflection(lemma=source, kind=kind, form=word))
    return tuple(inflections)


def read_inflections(source: Path) -> tuple[Inflection, ...]:
    selected: list[Inflection] = []
    seen: set[Inflection] = set()
    with source.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            lemma = normalize_word(row["word"])
            if not lemma:
                continue
            for inflection in parse_exchange(lemma, row["exchange"]):
                if inflection in seen:
                    continue
                seen.add(inflection)
                selected.append(inflection)
    return tuple(sorted(selected, key=lambda item: (item.lemma, item.kind, item.form)))


def render_forms(source_digest: str, inflections: tuple[Inflection, ...]) -> str:
    lemma_count = len({item.lemma for item in inflections})
    header = (
        f"# ECDICT {SNAPSHOT_COMMIT} | sha256 {source_digest} | "
        f"forward lemmas {lemma_count} | forms {len(inflections)}"
    )
    rows = (f"{item.lemma}\t{item.kind}\t{item.form}" for item in inflections)
    return "\n".join((header, *rows, ""))


def render_index(source_digest: str, inflections: tuple[Inflection, ...]) -> str:
    ordered = sorted(inflections, key=lambda item: (item.form, item.lemma, item.kind))
    form_count = len({item.form for item in ordered})
    header = (
        f"# ECDICT {SNAPSHOT_COMMIT} | sha256 {source_digest} | "
        f"reverse forms {form_count} | relations {len(ordered)}"
    )
    rows = (f"{item.form}\t{item.lemma}\t{item.kind}" for item in ordered)
    return "\n".join((header, *rows, ""))


def render_manifest(forms: SnapshotMetadata, index: SnapshotMetadata) -> str:
    return (
        "// 此文件由 scripts/generate_ecdict_inflections.py 生成，请勿手工修改。\n\n"
        "export const INFLECTION_FORMS_METADATA = {\n"
        f"  entryCount: {forms.entry_count},\n"
        f"  gzipBytes: {forms.gzip_bytes},\n"
        "  id: 'ecdict-inflections',\n"
        "  label: 'ECDICT 变形',\n"
        "} as const;\n\n"
        "export const INFLECTION_INDEX_METADATA = {\n"
        f"  entryCount: {index.entry_count},\n"
        f"  gzipBytes: {index.gzip_bytes},\n"
        "  id: 'ecdict-inflection-index',\n"
        "  label: 'ECDICT 变形反向索引',\n"
        "} as const;\n"
    )


def generate_inflection_packs(request: GenerationRequest) -> GenerationReport:
    source_digest = sha256_file(request.source)
    if request.expected_sha256 is not None and source_digest != request.expected_sha256:
        raise SnapshotMismatchError(
            f"ECDICT 快照校验失败：期望 {request.expected_sha256}，实际 {source_digest}"
        )
    inflections = read_inflections(request.source)
    forms = render_forms(source_digest, inflections)
    index = render_index(source_digest, inflections)
    request.output_directory.mkdir(parents=True, exist_ok=True)
    (request.output_directory / "ecdict-inflections.tsv").write_text(
        forms, encoding="utf-8", newline="\n"
    )
    (request.output_directory / "ecdict-inflection-index.tsv").write_text(
        index, encoding="utf-8", newline="\n"
    )
    forms_metadata = SnapshotMetadata(
        entry_count=len({item.lemma for item in inflections}),
        gzip_bytes=len(gzip.compress(forms.encode(), mtime=0)),
    )
    index_metadata = SnapshotMetadata(
        entry_count=len({item.form for item in inflections}),
        gzip_bytes=len(gzip.compress(index.encode(), mtime=0)),
    )
    (request.output_directory / "ecdictInflectionManifest.ts").write_text(
        render_manifest(forms_metadata, index_metadata), encoding="utf-8", newline="\n"
    )
    return GenerationReport(
        lemma_count=forms_metadata.entry_count,
        form_count=len(inflections),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="ECDICT 仓库中的 ecdict.csv")
    parser.add_argument("--output-directory", type=Path, default=Path("src/data"))
    arguments = parser.parse_args()
    report = generate_inflection_packs(
        GenerationRequest(source=arguments.source, output_directory=arguments.output_directory)
    )
    print(f"已生成 {report.lemma_count:,} 个词头、{report.form_count:,} 条词形关系")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
