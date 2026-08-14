#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""从固定 OANC GrAF 快照为每个英文词包生成独立例句补充包。

How to run:
    uv run scripts/generate_oanc_examples.py /path/to/OANC_GrAF.zip
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import re
import unicodedata
import xml.etree.ElementTree as ElementTree
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

EXPECTED_SHA256: Final = "5a26559a1becba41a527cb674fff4fb9c4fb70b276f60422c4f07a0ef23fd867"
EXAMPLE_SEPARATOR: Final = "\u001f"
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
TOKEN_PATTERN: Final = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*")
WEB_ADDRESS_PATTERN: Final = re.compile(r"(?:https?://|www\.|\b\S+@\S+\.\S+)", re.IGNORECASE)


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
    """输入 ZIP 不是项目固定并审核过的 OANC 快照。"""


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


def normalize_sentence(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).replace("\u00a0", " ").split())


def is_eligible_sentence(sentence: str) -> bool:
    if not 20 <= len(sentence) <= 240 or WEB_ADDRESS_PATTERN.search(sentence):
        return False
    letter_count = sum(character.isalpha() for character in sentence)
    return letter_count >= 12 and letter_count / len(sentence) >= 0.55


def sentence_score(sentence: str) -> tuple[int, int, str]:
    return abs(len(sentence) - 90), len(sentence), sentence.casefold()


def contains_complete_word(sentence: str, word: str) -> bool:
    for match in re.finditer(re.escape(word), sentence):
        starts_at_boundary = match.start() == 0 or not sentence[match.start() - 1].isalpha()
        ends_at_boundary = match.end() == len(sentence) or not sentence[match.end()].isalpha()
        if starts_at_boundary and ends_at_boundary:
            return True
    return False


def extract_sentences(archive: zipfile.ZipFile, annotation_name: str) -> list[str]:
    text_name = str(PurePosixPath(annotation_name).with_name(PurePosixPath(annotation_name).name.removesuffix("-s.xml") + ".txt"))
    try:
        text = archive.read(text_name).decode("utf-8-sig")
    except KeyError:
        return []

    root = ElementTree.fromstring(archive.read(annotation_name))
    sentences: list[str] = []
    for element in root.iter():
        if not element.tag.endswith("region"):
            continue
        anchors = element.get("anchors", "").split()
        if len(anchors) != 2:
            continue
        start, end = (int(anchor) for anchor in anchors)
        sentence = normalize_sentence(text[start:end])
        if sentence:
            sentences.append(sentence)
    return sentences


def collect_examples(
    archive: zipfile.ZipFile, target_words: frozenset[str]
) -> dict[str, tuple[str, ...]]:
    words_by_token: dict[str, set[str]] = {}
    for word in target_words:
        for token in TOKEN_PATTERN.findall(word):
            words_by_token.setdefault(token.casefold(), set()).add(word)

    selected: dict[str, dict[str, tuple[int, int, str]]] = {}
    annotations = sorted(name for name in archive.namelist() if name.endswith("-s.xml"))
    for annotation_name in annotations:
        for sentence in extract_sentences(archive, annotation_name):
            if not is_eligible_sentence(sentence):
                continue
            normalized_sentence = unicodedata.normalize("NFKC", sentence).casefold()
            candidate_words: set[str] = set()
            for token in TOKEN_PATTERN.findall(normalized_sentence):
                candidate_words.update(words_by_token.get(token.casefold(), ()))
            for word in candidate_words:
                if not contains_complete_word(normalized_sentence, word):
                    continue
                examples = selected.setdefault(word, {})
                examples[sentence] = sentence_score(sentence)
                if len(examples) > 2:
                    worst = max(examples, key=examples.__getitem__)
                    del examples[worst]

    return {
        word: tuple(sorted(examples, key=examples.__getitem__))
        for word, examples in selected.items()
    }


def render_pack(pack_id: str, source_digest: str, examples: dict[str, tuple[str, ...]]) -> str:
    header = f"# OANC GrAF | sha256 {source_digest} | pack {pack_id} | entries {len(examples)}"
    rows = (f"{word}\t{EXAMPLE_SEPARATOR.join(examples[word])}" for word in sorted(examples))
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
            f"export const {constant}_EXAMPLE_METADATA = {{\n"
            f"  entryCount: {item.entry_count},\n"
            f"  gzipBytes: {item.gzip_bytes},\n"
            f"  id: '{pack_id}',\n"
            f"  label: '{label}例句',\n"
            "} as const;"
        )
    return "// 此文件由 scripts/generate_oanc_examples.py 生成，请勿手工修改。\n\n" + "\n".join(rows) + "\n"


def generate_example_packs(request: GenerationRequest) -> None:
    source_digest = sha256_file(request.source)
    if request.expected_sha256 is not None and source_digest != request.expected_sha256:
        raise SnapshotMismatchError(
            f"OANC 快照校验失败：期望 {request.expected_sha256}，实际 {source_digest}"
        )

    packs = read_pack_words(request.vocabulary_directory)
    target_words = frozenset().union(*packs.values())
    with zipfile.ZipFile(request.source) as archive:
        all_examples = collect_examples(archive, target_words)

    request.output_directory.mkdir(parents=True, exist_ok=True)
    metadata: dict[str, SnapshotMetadata] = {}
    for pack_id, words in packs.items():
        examples = {word: all_examples[word] for word in words if word in all_examples}
        rendered = render_pack(pack_id, source_digest, examples)
        output = request.output_directory / f"oanc-examples-{pack_id}.tsv"
        output.write_text(rendered, encoding="utf-8", newline="\n")
        metadata[pack_id] = SnapshotMetadata(
            entry_count=len(examples),
            gzip_bytes=len(gzip.compress(rendered.encode(), mtime=0)),
        )
        print(f"已生成 {len(examples):,} 个单词的例句：{output}")

    manifest = request.output_directory / "oancExampleManifest.ts"
    manifest.write_text(render_manifest(metadata), encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="固定快照 OANC_GrAF.zip")
    parser.add_argument("--vocabulary-directory", type=Path, default=Path("src/data"))
    parser.add_argument("--output-directory", type=Path, default=Path("src/data"))
    arguments = parser.parse_args()
    generate_example_packs(
        GenerationRequest(
            source=arguments.source,
            vocabulary_directory=arguments.vocabulary_directory,
            output_directory=arguments.output_directory,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
