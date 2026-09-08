#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "requests>=2.32,<3",
# ]
# ///
# noqa: SIZE_OK - Todo 1 requires a standalone uv single-file generator.

# How to run:
#   uv run scripts/generate_wiktionary_phonetics.py
#   uv run scripts/generate_wiktionary_phonetics.py --check

"""从固定 Kaikki/Wiktextract 快照生成与 ECDICT 词包对齐的英美音标。"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import tempfile
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

SNAPSHOT_PATH: Final = Path("data_sources/wiktionary/raw-wiktextract-data.jsonl.gz")
SOURCE_URL: Final = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz"
SOURCE_PAGE_URL: Final = "https://kaikki.org/dictionary/rawdata.html"
SNAPSHOT_DUMP_DATE: Final = "2026-08-05"
SOURCE_RETRIEVED_AT: Final = "2026-08-28"
WIKTEXTRACT_COMMIT: Final = "872fc7b"
EXPECTED_SHA256: Final = "__SNAPSHOT_SHA256__"
LICENSE_NOTE: Final = "Wiktionary-derived data: CC BY-SA 3.0"
PACK_ORDER: Final = ("core", "zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre", "bnc")

EXPLICIT_ACCENT_TAGS: Final = frozenset(
    {"Received-Pronunciation", "UK", "General-American", "US"}
)
UK_TAGS: Final = frozenset({"Received-Pronunciation", "UK"})
US_TAGS: Final = frozenset({"General-American", "US"})
NEUTRAL_TAGS: Final = frozenset({"IPA"})
HARD_EXCLUDE_TAGS: Final = frozenset(
    {
        "African-American-Vernacular-English",
        "Appalachia",
        "Atlantic-Canada",
        "Australia",
        "Boston",
        "British",
        "California",
        "Canada",
        "Canadian",
        "Caribbean",
        "Cockney",
        "Cork",
        "East-Coast",
        "Eastern-New-England",
        "England",
        "Estuary-English",
        "General-South-African",
        "Geordie",
        "Hiberno-English",
        "Hong-Kong",
        "India",
        "Inland-Northern-American",
        "Ireland",
        "Irish",
        "Jamaica",
        "Malaysia",
        "Midlands",
        "Midwestern-US",
        "Multicultural-London-English",
        "Munster",
        "New-England",
        "New-York",
        "New-York-City",
        "New-Zealand",
        "North",
        "Northern-England",
        "Northern-Ireland",
        "Northern-US",
        "Northumbria",
        "Northwestern",
        "Ontario",
        "Philadelphia",
        "Philippines",
        "Scotland",
        "Singapore",
        "South",
        "South-Asia",
        "Southern",
        "Southern-England",
        "Southern-US",
        "Ulster",
        "Virginia",
        "Wales",
        "Wearside",
        "West-Country",
        "West-Midlands",
        "Western",
        "Yorkshire",
        "archaic",
        "colloquial",
        "dated",
        "dialectal",
        "historical",
        "informal",
        "nonstandard",
        "obsolete",
        "proscribed",
        "rare",
        "regional",
        "slang",
        "traditional",
        "uncommon",
    }
)
ALLOWED_TAGS: Final = EXPLICIT_ACCENT_TAGS | NEUTRAL_TAGS

MINIMUM_HIT_RATES: Final = {
    "core": 0.0,
    "zk": 0.0,
    "gk": 0.0,
    "cet4": 0.0,
    "cet6": 0.0,
    "ky": 0.0,
    "ielts": 0.0,
    "toefl": 0.0,
    "gre": 0.0,
    "bnc": 0.0,
}

Notation = Literal["phonemic", "phonetic", "plain"]
type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]


@dataclass(frozen=True, slots=True)
class Candidate:
    ipa: str
    notation: Notation
    explicit_uk: bool
    explicit_us: bool
    order: int


@dataclass(slots=True)  # noqa: MUTABLE_OK - accumulator for streaming records
class SpellingSounds:
    first_order: int
    candidates: list[Candidate] = field(default_factory=list)
    dropped_tags: Counter[str] = field(default_factory=Counter)
    invalid_ipa: int = 0


@dataclass(frozen=True, slots=True)
class SelectedPronunciation:
    uk: str
    us: str
    dropped_tags: Counter[str]
    invalid_ipa: int
    case_collision: bool


@dataclass(frozen=True, slots=True)
class Extraction:
    pronunciations: dict[str, dict[str, SpellingSounds]]
    english_records: int
    language_name_mismatches: int
    notation_counts: Counter[str]


@dataclass(frozen=True, slots=True)
class PackCoverage:
    entries: int
    hits: int
    both: int
    uk_only: int
    us_only: int
    missing: int
    case_collisions: int
    dropped_tags: Counter[str]
    invalid_ipa: int

    @property
    def hit_rate(self) -> float:
        return self.hits / self.entries


@dataclass(frozen=True, slots=True)
class GeneratedArtifacts:
    files: dict[Path, bytes]
    coverage: dict[str, PackCoverage]
    english_records: int
    language_name_mismatches: int


class GenerationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MissingSnapshotError(GenerationError):
    source: Path

    def __str__(self) -> str:
        return (
            f"缺少 Wiktextract 快照：{self.source}\n"
            f"请从 {SOURCE_URL} 下载到该路径；快照说明：{SOURCE_PAGE_URL}"
        )


@dataclass(frozen=True, slots=True)
class SnapshotMismatchError(GenerationError):
    expected: str
    actual: str

    def __str__(self) -> str:
        return f"Wiktextract 快照校验失败：期望 {self.expected}，实际 {self.actual}"


@dataclass(frozen=True, slots=True)
class StructureError(GenerationError):
    line_number: int
    reason: str

    def __str__(self) -> str:
        return f"Wiktextract 第 {self.line_number} 行结构错误：{self.reason}"


@dataclass(frozen=True, slots=True)
class CheckMismatchError(GenerationError):
    paths: tuple[Path, ...]

    def __str__(self) -> str:
        return "生成产物与提交版本不一致：" + ", ".join(map(str, self.paths))


def normalize_word(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().lower().split())


def sha256_file(source: Path) -> str:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def read_pack_headwords(directory: Path) -> dict[str, tuple[str, ...]]:
    packs: dict[str, tuple[str, ...]] = {}
    for pack_id in PACK_ORDER:
        source = directory / f"ecdict-{pack_id}.tsv"
        words = tuple(
            line.partition("\t")[0]
            for line in source.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")
        )
        packs[pack_id] = words
    return packs


def clean_ipa(raw_ipa: JsonValue) -> tuple[str, Notation] | None:
    if not isinstance(raw_ipa, str):
        return None
    if any(unicodedata.category(character) == "Cc" for character in raw_ipa):
        return None
    ipa = raw_ipa.strip()
    if not ipa:
        return None
    if len(ipa) >= 2 and ipa.startswith("/") and ipa.endswith("/"):
        return ipa[1:-1], "phonemic"
    if len(ipa) >= 2 and ipa.startswith("[") and ipa.endswith("]"):
        return ipa[1:-1], "phonetic"
    return ipa, "plain"


def classify_sound(sound: JsonValue, order: int) -> tuple[Candidate | None, Counter[str], bool]:
    if not isinstance(sound, dict) or "ipa" not in sound:
        return None, Counter(), False
    cleaned = clean_ipa(sound.get("ipa"))
    if cleaned is None:
        return None, Counter(), True
    raw_tags = sound.get("tags", [])
    if not isinstance(raw_tags, list) or any(not isinstance(tag, str) for tag in raw_tags):
        return None, Counter({"<invalid-tags>": 1}), False
    tags = frozenset(tag for tag in raw_tags if isinstance(tag, str))
    excluded = tags & HARD_EXCLUDE_TAGS
    unknown = tags - ALLOWED_TAGS - HARD_EXCLUDE_TAGS
    if excluded or unknown:
        return None, Counter((*sorted(excluded), *sorted(unknown))), False
    ipa, notation = cleaned
    return (
        Candidate(
            ipa=ipa,
            notation=notation,
            explicit_uk=bool(tags & UK_TAGS),
            explicit_us=bool(tags & US_TAGS),
            order=order,
        ),
        Counter(),
        False,
    )


def extract_pronunciations(source: Path, target_words: frozenset[str]) -> Extraction:
    pronunciations: dict[str, dict[str, SpellingSounds]] = {}
    english_records = 0
    language_name_mismatches = 0
    notation_counts: Counter[str] = Counter()
    sound_order = 0
    with gzip.open(source, "rt", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            entry = json.loads(line)
            if not isinstance(entry, dict):
                raise StructureError(line_number, "条目不是 JSON 对象")
            if entry.get("lang_code") != "en":
                continue
            english_records += 1
            if entry.get("lang") != "English":
                language_name_mismatches += 1
            raw_word = entry.get("word")
            if not isinstance(raw_word, str):
                raise StructureError(line_number, "英语条目的 word 不是字符串")
            key = normalize_word(raw_word)
            raw_sounds = entry.get("sounds", [])
            if not isinstance(raw_sounds, list):
                raise StructureError(line_number, "英语条目的 sounds 不是数组")
            if key not in target_words:
                continue
            spellings = pronunciations.setdefault(key, {})
            spelling = spellings.setdefault(raw_word, SpellingSounds(first_order=english_records))
            for sound in raw_sounds:
                candidate, dropped_tags, invalid_ipa = classify_sound(sound, sound_order)
                sound_order += 1
                spelling.dropped_tags.update(dropped_tags)
                spelling.invalid_ipa += int(invalid_ipa)
                if candidate is not None:
                    spelling.candidates.append(candidate)
                    notation_counts[candidate.notation] += 1
    return Extraction(pronunciations, english_records, language_name_mismatches, notation_counts)


def select_pronunciation(extraction: Extraction, headword: str) -> SelectedPronunciation:
    spellings = extraction.pronunciations.get(normalize_word(headword), {})
    if not spellings:
        return SelectedPronunciation("", "", Counter(), 0, False)
    selected = spellings.get(headword)
    if selected is None:
        selected = min(spellings.values(), key=lambda item: item.first_order)
    dropped_tags: Counter[str] = Counter()
    invalid_ipa = 0
    for spelling in spellings.values():
        dropped_tags.update(spelling.dropped_tags)
        invalid_ipa += spelling.invalid_ipa
    notation_rank = {"phonemic": 0, "phonetic": 1, "plain": 2}

    def choose(column: Literal["uk", "us"]) -> str:
        candidates = [
            candidate
            for candidate in selected.candidates
            if (candidate.explicit_uk if column == "uk" else candidate.explicit_us)
            or (not candidate.explicit_uk and not candidate.explicit_us)
        ]
        if not candidates:
            return ""
        return min(
            candidates,
            key=lambda candidate: (
                0
                if (candidate.explicit_uk if column == "uk" else candidate.explicit_us)
                else 1,
                notation_rank[candidate.notation],
                candidate.order,
            ),
        ).ipa

    return SelectedPronunciation(
        uk=choose("uk"),
        us=choose("us"),
        dropped_tags=dropped_tags,
        invalid_ipa=invalid_ipa,
        case_collision=len(spellings) > 1,
    )


def render_pack(pack_id: str, digest: str, headwords: tuple[str, ...], rows: tuple[str, ...]) -> str:
    header = (
        f"# Wiktionary phonetics | enwiktionary dump {SNAPSHOT_DUMP_DATE} | "
        f"extracted {SOURCE_RETRIEVED_AT} | wiktextract {WIKTEXTRACT_COMMIT} | "
        f"source {SOURCE_URL} | sha256 {digest} | license {LICENSE_NOTE} | "
        f"pack {pack_id} | entries {len(headwords)}"
    )
    return "\n".join((header, *rows, ""))


def render_manifest(coverage: dict[str, PackCoverage], digest: str) -> str:
    names: list[str] = []
    blocks: list[str] = []
    for pack_id in PACK_ORDER:
        constant = f"{pack_id.upper()}_WIKTIONARY_PHONETICS_METADATA"
        names.append(constant)
        blocks.append(
            f"export const {constant} = {{\n"
            f"  id: '{pack_id}',\n"
            "  source: 'Wiktionary via kaikki.org/wiktextract',\n"
            f"  sourceUrl: '{SOURCE_URL}',\n"
            f"  sourceRetrievedAt: '{SOURCE_RETRIEVED_AT}',\n"
            f"  sourceSha256: '{digest}',\n"
            f"  entries: {coverage[pack_id].entries},\n"
            "} as const;"
        )
    aggregate = (
        "export const WIKTIONARY_PHONETICS_MANIFEST = [\n  "
        + ",\n  ".join(names)
        + ",\n] as const;"
    )
    return (
        "// 此文件由 scripts/generate_wiktionary_phonetics.py 生成，请勿手工修改。\n\n"
        + "\n\n".join((*blocks, aggregate))
        + "\n"
    )


def render_coverage_report(
    coverage: dict[str, PackCoverage], extraction: Extraction, digest: str
) -> str:
    lines = [
        "Wiktionary phonetics coverage report",
        f"source_url: {SOURCE_URL}",
        f"source_sha256: {digest}",
        f"enwiktionary_dump_date: {SNAPSHOT_DUMP_DATE}",
        f"extraction_date: {SOURCE_RETRIEVED_AT}",
        f"wiktextract_commit: {WIKTEXTRACT_COMMIT}",
        f"english_records: {extraction.english_records}",
        f"lang_name_mismatches: {extraction.language_name_mismatches}",
        "notation_counts: "
        + ", ".join(f"{key}={value}" for key, value in sorted(extraction.notation_counts.items())),
        "",
        "minimum_hit_rate_thresholds:",
    ]
    lines.extend(f"  {pack_id}: {MINIMUM_HIT_RATES[pack_id]:.6f}" for pack_id in PACK_ORDER)
    for pack_id in PACK_ORDER:
        item = coverage[pack_id]
        lines.extend(
            (
                "",
                f"[{pack_id}]",
                f"entries: {item.entries}",
                f"hits: {item.hits}",
                f"hit_rate: {item.hit_rate:.6f}",
                f"both: {item.both}",
                f"uk_only: {item.uk_only}",
                f"us_only: {item.us_only}",
                f"missing: {item.missing}",
                f"case_collisions: {item.case_collisions}",
                f"invalid_ipa: {item.invalid_ipa}",
                "dropped_tags: "
                + (", ".join(f"{tag}={count}" for tag, count in sorted(item.dropped_tags.items())) or "none"),
            )
        )
    return "\n".join((*lines, ""))


def build_artifacts(source: Path, vocabulary_directory: Path) -> GeneratedArtifacts:
    if not source.exists():
        raise MissingSnapshotError(source)
    digest = sha256_file(source)
    if EXPECTED_SHA256 != "__SNAPSHOT_SHA256__" and digest != EXPECTED_SHA256:
        raise SnapshotMismatchError(EXPECTED_SHA256, digest)
    packs = read_pack_headwords(vocabulary_directory)
    target_words = frozenset(normalize_word(word) for words in packs.values() for word in words)
    extraction = extract_pronunciations(source, target_words)
    if extraction.english_records == 0:
        raise GenerationError("Wiktextract 快照没有 lang_code == 'en' 的记录")
    files: dict[Path, bytes] = {}
    coverage: dict[str, PackCoverage] = {}
    for pack_id in PACK_ORDER:
        rendered_rows: list[str] = []
        both = uk_only = us_only = case_collisions = invalid_ipa = 0
        dropped_tags: Counter[str] = Counter()
        for headword in packs[pack_id]:
            selected = select_pronunciation(extraction, headword)
            rendered_rows.append(f"{headword}\t{selected.uk}\t{selected.us}")
            both += int(bool(selected.uk and selected.us))
            uk_only += int(bool(selected.uk and not selected.us))
            us_only += int(bool(selected.us and not selected.uk))
            case_collisions += int(selected.case_collision)
            invalid_ipa += selected.invalid_ipa
            dropped_tags.update(selected.dropped_tags)
        hits = both + uk_only + us_only
        item = PackCoverage(
            entries=len(packs[pack_id]),
            hits=hits,
            both=both,
            uk_only=uk_only,
            us_only=us_only,
            missing=len(packs[pack_id]) - hits,
            case_collisions=case_collisions,
            dropped_tags=dropped_tags,
            invalid_ipa=invalid_ipa,
        )
        coverage[pack_id] = item
        if item.hit_rate < MINIMUM_HIT_RATES[pack_id]:
            raise GenerationError(
                f"{pack_id} 命中率 {item.hit_rate:.6f} 低于阈值 {MINIMUM_HIT_RATES[pack_id]:.6f}"
            )
        relative = Path("src/data") / f"wiktionary-phonetics-{pack_id}.tsv"
        files[relative] = render_pack(
            pack_id, digest, packs[pack_id], tuple(rendered_rows)
        ).encode()
    files[Path("src/data/wiktionaryPhoneticsManifest.ts")] = render_manifest(coverage, digest).encode()
    files[Path("reports/wiktionary-phonetics-coverage.txt")] = render_coverage_report(
        coverage, extraction, digest
    ).encode()
    return GeneratedArtifacts(
        files,
        coverage,
        extraction.english_records,
        extraction.language_name_mismatches,
    )


def write_artifacts(artifacts: GeneratedArtifacts, root: Path) -> None:
    for relative, content in artifacts.files.items():
        output = root / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(content)
        print(f"已生成：{output}")


def check_artifacts(artifacts: GeneratedArtifacts, root: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="wiktionary-phonetics-") as temporary:
        temporary_root = Path(temporary)
        write_artifacts(artifacts, temporary_root)
        mismatches: list[Path] = []
        for relative in artifacts.files:
            committed = root / relative
            rendered = temporary_root / relative
            if not committed.exists() or committed.read_bytes() != rendered.read_bytes():
                mismatches.append(relative)
        if mismatches:
            raise CheckMismatchError(tuple(mismatches))
    print("--check 通过：所有 Wiktionary 音标产物逐字节一致")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="重渲染并逐字节校验提交产物")
    parser.add_argument("--source", type=Path, default=SNAPSHOT_PATH)
    parser.add_argument("--project-root", type=Path, default=Path("."))
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    root = arguments.project_root.resolve()
    source = arguments.source if arguments.source.is_absolute() else root / arguments.source
    try:
        artifacts = build_artifacts(source, root / "src/data")
        if arguments.check:
            check_artifacts(artifacts, root)
        else:
            write_artifacts(artifacts, root)
        print(f"英语记录：{artifacts.english_records:,}")
        if artifacts.language_name_mismatches:
            print(
                f"警告：{artifacts.language_name_mismatches:,} 条英语记录的 lang 不是 English",
                file=sys.stderr,
            )
        return 0
    except (GenerationError, OSError, json.JSONDecodeError) as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
