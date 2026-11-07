#!/usr/bin/env python3

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

MAPULL_COMMIT: Final = "e804ada333b68afddfdccbe8dcc938a72da157a7"
XINHUA_COMMIT: Final = "fe6d6c2e8baa82187f4c96bbe042e43f96c05666"
UNIMORPH_COMMIT: Final = "66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b"
DEFAULT_SHARD_BYTES: Final = 256 * 1024
MAX_RESOURCE_BYTES: Final = 40 * 1024 * 1024
ENGLISH_PACK_IDS: Final = ("core", "zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre", "bnc")
MAPULL_LICENSES: Final = ("LICENSES/MAPULL-MIT.txt", "LICENSES/CC-BY-SA-4.0.txt")
XINHUA_LICENSES: Final = ("LICENSES/CHINESE-XINHUA-MIT.txt",)
WORDNET_LICENSES: Final = ("LICENSES/WORDNET-3.1.txt",)
UNIMORPH_LICENSES: Final = ("LICENSES/CC-BY-SA-3.0.txt",)


@dataclass(frozen=True, slots=True)
class PackSpec:
    id: str
    legacy_id: str
    kind: str
    label: str
    source_file: str
    source: dict[str, str]
    license_files: tuple[str, ...]


CHINESE_SPECS: Final = (
    PackSpec(
        "chinese-dictionary",
        "chinese-dictionary",
        "chinese",
        "chinese-dictionary",
        "chinese-dictionary.tsv",
        {
            "repository": "https://github.com/mapull/chinese-dictionary",
            "commit": MAPULL_COMMIT,
            "license": "MIT（仓库级；上游授权链见 THIRD_PARTY_NOTICES.md）",
        },
        MAPULL_LICENSES,
    ),
    PackSpec(
        "chinese-dictionary-words",
        "chinese-dictionary-words",
        "chinese",
        "chinese-dictionary",
        "chinese-dictionary-words.tsv",
        {
            "repository": "https://github.com/mapull/chinese-dictionary",
            "commit": MAPULL_COMMIT,
            "license": "MIT（仓库级；上游授权链见 THIRD_PARTY_NOTICES.md）",
        },
        MAPULL_LICENSES,
    ),
    PackSpec(
        "chinese-xinhua",
        "chinese-xinhua",
        "chinese",
        "chinese-xinhua 上游整理",
        "chinese-xinhua.tsv",
        {
            "repository": "https://github.com/pwxcoo/chinese-xinhua",
            "commit": XINHUA_COMMIT,
            "license": "MIT（仓库级；上游授权链见 THIRD_PARTY_NOTICES.md）",
        },
        XINHUA_LICENSES,
    ),
    PackSpec(
        "chinese-xinhua-words",
        "chinese-xinhua-words",
        "chinese",
        "chinese-xinhua 词语",
        "chinese-xinhua-words.tsv",
        {
            "repository": "https://github.com/pwxcoo/chinese-xinhua",
            "commit": XINHUA_COMMIT,
            "license": "MIT（仓库级；上游授权链见 THIRD_PARTY_NOTICES.md）",
        },
        XINHUA_LICENSES,
    ),
)

SYNONYM_LABELS: Final = {
    "core": "高频核心近义词",
    "zk": "中考近义词",
    "gk": "高考近义词",
    "cet4": "CET-4近义词",
    "cet6": "CET-6近义词",
    "ky": "考研近义词",
    "ielts": "IELTS近义词",
    "toefl": "TOEFL近义词",
    "gre": "GRE近义词",
    "bnc": "BNC近义词",
}
ROOT_LABELS: Final = {
    "core": "高频核心派生词根",
    "zk": "中考派生词根",
    "gk": "高考派生词根",
    "cet4": "CET-4派生词根",
    "cet6": "CET-6派生词根",
    "ky": "考研派生词根",
    "ielts": "IELTS派生词根",
    "toefl": "TOEFL派生词根",
    "gre": "GRE派生词根",
    "bnc": "BNC派生词根",
}
WORDNET_SOURCE: Final = {
    "repository": "https://wordnet.princeton.edu/",
    "snapshot": "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz",
    "snapshotSha256": "3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a",
    "license": "WordNet 3.1",
}
UNIMORPH_SOURCE: Final = {
    "repository": "https://github.com/unimorph/eng",
    "commit": UNIMORPH_COMMIT,
    "snapshotSha256": "743fff8ddb3ff26ae413af1fa859806106ffff69628be4cb7ed4d34f677deed2",
    "license": "CC BY-SA 3.0",
}
SUPPLEMENT_SPECS: Final = tuple(
    [
        PackSpec(
            f"wordnet-synonyms-{pack_id}",
            pack_id,
            "synonyms",
            SYNONYM_LABELS[pack_id],
            f"wordnet-synonyms-{pack_id}.tsv",
            WORDNET_SOURCE,
            WORDNET_LICENSES,
        )
        for pack_id in ENGLISH_PACK_IDS
    ]
    + [
        PackSpec(
            f"unimorph-roots-{pack_id}",
            pack_id,
            "roots",
            ROOT_LABELS[pack_id],
            f"unimorph-roots-{pack_id}.tsv",
            UNIMORPH_SOURCE,
            UNIMORPH_LICENSES,
        )
        for pack_id in ENGLISH_PACK_IDS
    ]
)
ALL_SPECS: Final = (*CHINESE_SPECS, *SUPPLEMENT_SPECS)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compressed(data: bytes) -> bytes:
    return gzip.compress(data, compresslevel=9, mtime=0)


def resource_metadata(resource_id: str, raw: bytes) -> tuple[dict[str, object], bytes]:
    zipped = compressed(raw)
    return (
        {
            "id": resource_id,
            "bytes": len(zipped),
            "sha256": sha256(zipped),
            "uncompressedBytes": len(raw),
            "uncompressedSha256": sha256(raw),
        },
        zipped,
    )


def write_resource(output_root: Path, resource_id: str, raw: bytes) -> dict[str, object]:
    metadata, zipped = resource_metadata(resource_id, raw)
    destination = output_root / resource_id
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(zipped)
    return metadata


def utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be")


def build_pack(
    spec: PackSpec,
    source_root: Path,
    output_root: Path,
    shard_target_bytes: int = DEFAULT_SHARD_BYTES,
) -> dict[str, object]:
    source_bytes = (source_root / spec.source_file).read_bytes()
    source_text = source_bytes.decode("utf-8")
    lines = source_text.splitlines(keepends=True)
    if not lines:
        raise ValueError(f"{spec.id} 缺少 TSV 表头")
    header = lines[0]
    rows = [line.encode("utf-8") for line in lines[1:] if line.strip()]
    if shard_target_bytes <= 0:
        raise ValueError("分片目标必须大于零")

    shards: list[dict[str, object]] = []
    index_records: list[tuple[str, int, int]] = []
    current_rows: list[bytes] = []
    current_size = 0

    def flush_shard() -> None:
        nonlocal current_rows, current_size
        if not current_rows:
            return
        shard_number = len(shards)
        shard_id = f"shards/{spec.id}/{shard_number:06d}.tsv.gz"
        shard_raw = b"".join(current_rows)
        metadata = write_resource(output_root, shard_id, shard_raw)
        shards.append(
            {
                **metadata,
                "firstRow": shards[-1]["lastRow"] + 1 if shards else 0,
                "lastRow": (shards[-1]["lastRow"] if shards else -1) + len(current_rows),
            }
        )
        current_rows = []
        current_size = 0

    for row_number, row in enumerate(rows):
        headword = row.decode("utf-8").split("\t", 1)[0]
        if not headword:
            raise ValueError(f"{spec.id} 第 {row_number + 2} 行缺少词头")
        if current_rows and current_size + len(row) > shard_target_bytes:
            flush_shard()
        shard_number = len(shards)
        index_records.append((headword, shard_number, row_number))
        current_rows.append(row)
        current_size += len(row)
    flush_shard()

    index_records.sort(key=lambda record: (utf16_sort_key(record[0]), record[2]))
    index_raw = "".join(
        f"{headword}\t{shard_number}\t{row_number}\n"
        for headword, shard_number, row_number in index_records
    ).encode("utf-8")
    index_id = f"indexes/{spec.id}.tsv.gz"
    index_metadata = write_resource(output_root, index_id, index_raw)

    reassembled = header.encode("utf-8") + b"".join(
        gzip.decompress((output_root / str(shard["id"])).read_bytes()) for shard in shards
    )
    if reassembled != source_bytes:
        raise ValueError(f"{spec.id} 分片重组后与源 TSV 不一致")
    if gzip.decompress((output_root / index_id).read_bytes()) != index_raw:
        raise ValueError(f"{spec.id} 索引解压校验失败")

    return {
        "id": spec.id,
        "legacyId": spec.legacy_id,
        "kind": spec.kind,
        "label": spec.label,
        "source": spec.source,
        "licenseFiles": list(spec.license_files),
        "header": header.rstrip("\r\n"),
        "rowOrder": "source",
        "recordCount": len(rows),
        "entryCount": len({record[0] for record in index_records}),
        "uncompressedBytes": len(source_bytes),
        "uncompressedSha256": sha256(source_bytes),
        "index": {**index_metadata, "recordCount": len(index_records)},
        "shards": shards,
    }


def generate(
    source_root: Path,
    output_root: Path,
    package_version: str,
    specs: tuple[PackSpec, ...] = ALL_SPECS,
    shard_target_bytes: int = DEFAULT_SHARD_BYTES,
) -> dict[str, object]:
    output_root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{output_root.name}-", dir=output_root.parent
    ) as temporary_directory:
        temporary_root = Path(temporary_directory) / "dictionary"
        packs = [
            build_pack(spec, source_root, temporary_root, shard_target_bytes) for spec in specs
        ]
        manifest: dict[str, object] = {
            "formatVersion": 1,
            "packageVersion": package_version,
            "shardTargetBytes": shard_target_bytes,
            "packs": packs,
        }
        manifest_bytes = (
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        (temporary_root / "manifest.json").write_bytes(manifest_bytes)
        copy_notices(Path(__file__).resolve().parent.parent, temporary_root)
        total_bytes = sum(
            path.stat().st_size for path in temporary_root.rglob("*") if path.is_file()
        )
        if total_bytes > MAX_RESOURCE_BYTES:
            raise ValueError(f"离线资源总计 {total_bytes} bytes，超过 {MAX_RESOURCE_BYTES} bytes")

        previous_root = Path(temporary_directory) / "previous"
        if output_root.exists():
            output_root.replace(previous_root)
        try:
            temporary_root.replace(output_root)
        except Exception:
            if previous_root.exists():
                previous_root.replace(output_root)
            raise
        return manifest


def copy_notices(repository_root: Path, output_root: Path) -> None:
    shutil.copyfile(repository_root / "THIRD_PARTY_NOTICES.md", output_root / "THIRD_PARTY_NOTICES.md")
    license_files = sorted({license_file for spec in ALL_SPECS for license_file in spec.license_files})
    for license_file in license_files:
        source = repository_root / license_file
        destination = output_root / license_file
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("src/data"))
    parser.add_argument("--output-root", type=Path, default=Path("resources/dictionary"))
    arguments = parser.parse_args()
    repository_root = Path(__file__).resolve().parent.parent
    package_version = json.loads((repository_root / "package.json").read_text(encoding="utf-8"))[
        "version"
    ]
    generate(arguments.source_root, arguments.output_root, package_version)
    total_bytes = sum(path.stat().st_size for path in arguments.output_root.rglob("*") if path.is_file())
    print(f"已生成 {len(ALL_SPECS)} 个包；资源总计 {total_bytes} bytes：{arguments.output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
