#!/usr/bin/env python3

from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from generate_offline_dictionary_resources import PackSpec, build_pack, generate


class OfflineDictionaryResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.source_root = self.root / "source"
        self.output_root = self.root / "output"
        self.source_root.mkdir()
        self.spec = PackSpec(
            "fixture",
            "fixture",
            "chinese",
            "测试词库",
            "fixture.tsv",
            {"repository": "https://example.invalid/fixture", "license": "MIT"},
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_snapshot(self, contents: str) -> bytes:
        raw = contents.encode("utf-8")
        (self.source_root / "fixture.tsv").write_bytes(raw)
        return raw

    def test_shards_preserve_utf8_long_rows_and_source_order(self) -> None:
        long_meaning = "长" * 200
        raw = self.write_snapshot(
            "# fixture\n"
            "心\txīn\t汉字\t内心\n"
            f"超长\tchāng cháng\t词语\t{long_meaning}\n"
            "心安\txīn ān\t词语\t内心安定\n"
        )
        pack = build_pack(self.spec, self.source_root, self.output_root, shard_target_bytes=40)
        self.assertGreater(len(pack["shards"]), 2)
        self.assertEqual(pack["recordCount"], 3)
        self.assertEqual(pack["entryCount"], 3)
        self.assertEqual(pack["uncompressedSha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(pack["header"], "# fixture")

        reassembled = pack["header"].encode() + b"\n" + b"".join(
            gzip.decompress((self.output_root / shard["id"]).read_bytes())
            for shard in pack["shards"]
        )
        self.assertEqual(reassembled, raw)
        self.assertTrue(any(shard["uncompressedBytes"] > 40 for shard in pack["shards"]))

        index = gzip.decompress((self.output_root / pack["index"]["id"]).read_bytes()).decode()
        self.assertEqual([line.split("\t")[0] for line in index.splitlines()], ["心", "心安", "超长"])
        for shard in pack["shards"]:
            zipped = (self.output_root / shard["id"]).read_bytes()
            self.assertEqual(shard["bytes"], len(zipped))
            self.assertEqual(shard["sha256"], hashlib.sha256(zipped).hexdigest())
            self.assertEqual(
                shard["uncompressedSha256"], hashlib.sha256(gzip.decompress(zipped)).hexdigest()
            )

    def test_rebuild_is_deterministic(self) -> None:
        self.write_snapshot("# fixture\n心\txīn\t汉字\t内心\n心安\txīn ān\t词语\t内心安定\n")
        first = generate(self.source_root, self.output_root, "1.0.0", (self.spec,), 32)
        first_files = {
            str(path.relative_to(self.output_root)): path.read_bytes()
            for path in self.output_root.rglob("*")
            if path.is_file()
        }
        second = generate(self.source_root, self.output_root, "1.0.0", (self.spec,), 32)
        second_files = {
            str(path.relative_to(self.output_root)): path.read_bytes()
            for path in self.output_root.rglob("*")
            if path.is_file()
        }
        self.assertEqual(first, second)
        self.assertEqual(first_files, second_files)
        manifest = json.loads(first_files["manifest.json"])
        self.assertEqual(manifest["packageVersion"], "1.0.0")
        self.assertEqual(manifest["packs"][0]["rowOrder"], "source")

    def test_invalid_utf8_and_empty_inputs_fail(self) -> None:
        (self.source_root / "fixture.tsv").write_bytes(b"# fixture\n\xff\n")
        with self.assertRaises(UnicodeDecodeError):
            build_pack(self.spec, self.source_root, self.output_root)
        self.write_snapshot("")
        with self.assertRaisesRegex(ValueError, "缺少 TSV 表头"):
            build_pack(self.spec, self.source_root, self.output_root)

    def test_repository_resources_match_every_fixed_snapshot(self) -> None:
        from generate_offline_dictionary_resources import ALL_SPECS, CHINESE_SPECS, SUPPLEMENT_SPECS

        repository_root = Path(__file__).resolve().parent.parent
        output_root = repository_root / "resources" / "dictionary"
        manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
        package = json.loads((repository_root / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["packageVersion"], package["version"])
        self.assertEqual([pack["id"] for pack in manifest["packs"][:4]], [spec.id for spec in CHINESE_SPECS])
        self.assertEqual(len(SUPPLEMENT_SPECS), 20)
        self.assertEqual(len(ALL_SPECS), 24)
        self.assertFalse(any("example" in spec.id for spec in ALL_SPECS))
        self.assertFalse(any("inflection" in spec.id for spec in ALL_SPECS))

        packs = {pack["id"]: pack for pack in manifest["packs"]}
        self.assertEqual(set(packs), {spec.id for spec in ALL_SPECS})
        for spec in ALL_SPECS:
            with self.subTest(pack=spec.id):
                pack = packs[spec.id]
                source = (repository_root / "src" / "data" / spec.source_file).read_bytes()
                reassembled = pack["header"].encode("utf-8") + b"\n" + b"".join(
                    gzip.decompress((output_root / shard["id"]).read_bytes())
                    for shard in pack["shards"]
                )
                self.assertEqual(reassembled, source)
                self.assertEqual(pack["uncompressedBytes"], len(source))
                self.assertEqual(pack["uncompressedSha256"], hashlib.sha256(source).hexdigest())
                headwords = [line.split("\t", 1)[0] for line in source.decode("utf-8").splitlines()[1:] if line]
                self.assertEqual(pack["recordCount"], len(headwords))
                self.assertEqual(pack["entryCount"], len(set(headwords)))
                resources = [pack["index"], *pack["shards"]]
                for resource in resources:
                    contents = (output_root / resource["id"]).read_bytes()
                    self.assertTrue(resource["id"].startswith(("indexes/", "shards/")))
                    self.assertNotIn("..", Path(resource["id"]).parts)
                    self.assertEqual(resource["bytes"], len(contents))
                    self.assertEqual(resource["sha256"], hashlib.sha256(contents).hexdigest())
                    self.assertEqual(resource["uncompressedBytes"], len(gzip.decompress(contents)))
                    self.assertEqual(
                        resource["uncompressedSha256"],
                        hashlib.sha256(gzip.decompress(contents)).hexdigest(),
                    )


if __name__ == "__main__":
    unittest.main()
