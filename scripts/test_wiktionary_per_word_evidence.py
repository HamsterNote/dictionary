#!/usr/bin/env python3
"""不可变证据与响应缓存离线 unittest：task 6.4。

覆盖：same revid 语义变化可识别、无关文本不误触、截断不入成功缓存、历史证据
不覆盖、write-once 缓存、带来源许可的离线重解析。
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import english_html  # noqa: E402

from wiktionary_per_word.evidence import (  # noqa: E402
    DEFAULT_ATTRIBUTION,
    WIKTIONARY_LICENSE_ID,
    CacheIntegrityError,
    EvidenceLedger,
    ImmutableViolation,
    IncompleteCacheError,
    ResponseCache,
    SourceEvidence,
    compute_semantic_fingerprint,
)
from wiktionary_per_word.html_extract import extract_observations  # noqa: E402
from wiktionary_per_word.offline_reparse import (  # noqa: E402
    build_source_evidence,
    detect_semantic_change,
    reparse_cached_entry,
    reparse_html,
)

UNRELATED_HTML = english_html().replace(
    "</li>",
    '</li><li><span class="ignored">unrelated note</span></li>',
)


class FingerprintTest(unittest.TestCase):
    def test_unrelated_text_does_not_change_fingerprint(self) -> None:
        base = extract_observations(english_html())
        unrelated = extract_observations(UNRELATED_HTML.replace("unrelated note", "different text"))
        self.assertEqual(
            compute_semantic_fingerprint(base.observations),
            compute_semantic_fingerprint(unrelated.observations),
        )

    def test_same_revid_semantic_change_detected(self) -> None:
        base_evidence = build_source_evidence(
            word="read",
            page_url="https://en.wiktionary.org/wiki/read",
            history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
            revid=42,
            fetched_at="2026-01-01T00:00:00Z",
            body=english_html().encode(),
            observations=extract_observations(english_html()).observations,
        )
        changed_html = english_html().replace("/ri&#720;d/", "/r\u026ad/")
        changed_result = extract_observations(changed_html)
        self.assertTrue(
            detect_semantic_change(
                base_evidence, compute_semantic_fingerprint(changed_result.observations)
            )
        )

    def test_usage_label_change_detected(self) -> None:
        # region/archaic/rare 等用途标签变化必须改变 fingerprint（不能忽略 tags）。
        base = (
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA">/x/</span></li></ul>'
        )
        archaic = base.replace('class="IPA"', 'class="IPA archaic"')
        rare = base.replace('class="IPA"', 'class="IPA rare"')
        regional = base.replace('class="IPA"', 'class="IPA regional-label"')
        base_fp = self._fp(base)
        self.assertNotEqual(base_fp, self._fp(archaic))
        self.assertNotEqual(self._fp(archaic), self._fp(rare))
        self.assertNotEqual(base_fp, self._fp(regional))

    def test_unknown_restriction_class_changes_fingerprint(self) -> None:
        # 本轮 gap4：未知限制 class 变化必须保留（供 3.2 unresolved），不静默丢弃。
        first = '<div class="nonstandard-new"><span class="IPA">/x/</span></div>'
        second = '<div class="other-restriction"><span class="IPA">/x/</span></div>'
        self.assertNotEqual(self._fp(first), self._fp(second))

    def test_layout_class_does_not_change_fingerprint(self) -> None:
        # 明确 layout class（mw-* 等）不参与语义 fingerprint，避免误触。
        wrapped = '<div class="mw-parser-output"><span class="IPA">/x/</span></div>'
        bare = '<span class="IPA">/x/</span>'
        self.assertEqual(self._fp(wrapped), self._fp(bare))

    def test_layout_change_does_not_change_fingerprint(self) -> None:
        # 纯排版/包装 class 变化不应误触语义 fingerprint。
        relayout = english_html().replace("mw-heading", "layout-mark")
        self.assertEqual(self._fp(english_html()), self._fp(relayout))

    def test_qualifier_nfc_normalized_for_comparison(self) -> None:
        composed = (
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="qualifier-content">caf\u00e9</span>'
            '<span class="IPA">/x/</span></li></ul>'
        )
        decomposed = composed.replace("caf\u00e9", "cafe\u0301")
        self.assertEqual(self._fp(composed), self._fp(decomposed))

    @staticmethod
    def _fp(html: str) -> str:
        return compute_semantic_fingerprint(extract_observations(html).observations)


class CacheTest(unittest.TestCase):
    def test_existing_disk_hit_must_confirm_persistence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            cache = ResponseCache(path)
            arguments = dict(content_type="text/html", complete=True,
                             source_url="https://en.wiktionary.org/wiki/read", fetched_at="offline")
            entry = cache.put(b"complete response", **arguments)
            for hit in (cache, ResponseCache(path)):
                with self.subTest(reloaded=hit is not cache):
                    with mock.patch.object(hit, "_persist", side_effect=OSError("sync failed")) as persist:
                        with self.assertRaises(OSError):
                            hit.put(entry.body, **arguments)
                        persist.assert_called_once_with(entry)
                    body_path = path / f"{entry.http_sha256}.body"
                    body_path.write_bytes(b"damaged")
                    with self.assertRaises(ImmutableViolation):
                        hit.put(entry.body, **arguments)
                    body_path.write_bytes(entry.body)
                    self.assertEqual(hit.put(entry.body, **arguments), entry)

    def test_atomic_write_failures_are_unindexed_and_retryable(self) -> None:
        for suffix in (".body", ".meta.json"):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as directory:
                cache = ResponseCache(Path(directory))
                arguments = dict(content_type="text/html", complete=True,
                                 source_url="https://en.wiktionary.org/wiki/read",
                                 fetched_at="2026-10-17T00:00:00Z")
                real_replace = os.replace
                def fail_replace(source, target):
                    if str(target).endswith(suffix):
                        raise OSError("injected rename failure")
                    return real_replace(source, target)
                with mock.patch("wiktionary_per_word.evidence.os.replace", side_effect=fail_replace):
                    with self.assertRaises(OSError):
                        cache.put(b"complete response", **arguments)
                self.assertEqual(len(cache), 0)
                self.assertEqual(list(Path(directory).glob(".cache-*.tmp")), [])
                # Metadata failure can leave a complete body, never a partial file.
                for path in Path(directory).glob("*.body"):
                    self.assertEqual(path.read_bytes(), b"complete response")
                entry = cache.put(b"complete response", **arguments)
                self.assertEqual(len(cache), 1)
                self.assertEqual(ResponseCache(Path(directory)).get_by_provenance(entry.provenance_id), entry)

    def test_readback_failure_never_indexes_unverified_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = ResponseCache(Path(directory))
            arguments = dict(content_type="text/html", complete=True,
                             source_url="https://en.wiktionary.org/wiki/read", fetched_at="offline")
            real_read = Path.read_bytes
            def bad_read(path):
                return b"corrupt readback" if path.suffix == ".body" else real_read(path)
            with mock.patch.object(Path, "read_bytes", bad_read):
                with self.assertRaises(CacheIntegrityError):
                    cache.put(b"complete response", **arguments)
            self.assertEqual(len(cache), 0)
            self.assertEqual(list(Path(directory).glob("*.meta.json")), [])
            self.assertEqual(len(cache.put(b"complete response", **arguments).body), 17)

    def test_truncated_not_cached(self) -> None:
        cache = ResponseCache()
        with self.assertRaises(IncompleteCacheError):
            cache.put(
                b"<html>partial",
                content_type="text/html",
                complete=False,
                source_url="https://x",
                fetched_at="2026-01-01T00:00:00Z",
            )
        self.assertEqual(len(cache), 0)

    def test_write_once_roundtrip_with_license(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = ResponseCache(directory=Path(directory))
            entry = cache.put(
                english_html().encode(),
                content_type="text/html",
                complete=True,
                source_url="https://en.wiktionary.org/w/api.php?page=read",
                fetched_at="2026-01-01T00:00:00Z",
            )
            self.assertEqual(entry.license_id, WIKTIONARY_LICENSE_ID)
            reloaded = ResponseCache(directory=Path(directory))
            self.assertIsNotNone(reloaded.get(entry.http_sha256))

    def test_offline_reparse_from_cache(self) -> None:
        cache = ResponseCache()
        entry = cache.put(
            english_html().encode(),
            content_type="text/html",
            complete=True,
            source_url="https://en.wiktionary.org/w/api.php?page=read",
            fetched_at="2026-01-01T00:00:00Z",
        )
        result = reparse_cached_entry(entry)
        self.assertGreaterEqual(len(result.observations), 4)
        self.assertTrue(result.semantic_fingerprint)

    def test_same_body_different_source_keeps_provenance(self) -> None:
        cache = ResponseCache()
        body = b'{"parse": {"tocdata": {"sections": []}}}'
        first = cache.put(
            body,
            content_type="application/json",
            complete=True,
            source_url="https://en.wiktionary.org/w/api.php?page=read",
            fetched_at="2026-01-01T00:00:00Z",
        )
        second = cache.put(
            body,
            content_type="application/json",
            complete=True,
            source_url="https://en.wiktionary.org/w/api.php?page=reed",
            fetched_at="2026-02-02T00:00:00Z",
        )
        self.assertNotEqual(first.provenance_id, second.provenance_id)
        self.assertEqual(len(cache), 2)
        self.assertEqual(len(cache.provenance_for(first.http_sha256)), 2)

    def test_identical_provenance_is_idempotent(self) -> None:
        cache = ResponseCache()
        body = b"payload"
        first = cache.put(
            body,
            content_type="text/html",
            complete=True,
            source_url="https://x",
            fetched_at="2026-01-01T00:00:00Z",
        )
        second = cache.put(
            body,
            content_type="text/html",
            complete=True,
            source_url="https://x",
            fetched_at="2026-01-01T00:00:00Z",
        )
        self.assertEqual(first.provenance_id, second.provenance_id)
        self.assertEqual(len(cache), 1)

    def test_reload_verifies_hash_and_license(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = ResponseCache(directory=Path(directory))
            entry = cache.put(
                english_html().encode(),
                content_type="text/html",
                complete=True,
                source_url="https://en.wiktionary.org/w/api.php?page=read",
                fetched_at="2026-01-01T00:00:00Z",
            )
            reloaded = ResponseCache(directory=Path(directory))
            restored = reloaded.get(entry.http_sha256)
            self.assertIsNotNone(restored)
            self.assertEqual(restored.license_id, WIKTIONARY_LICENSE_ID)
            self.assertEqual(restored.attribution, DEFAULT_ATTRIBUTION)
            self.assertTrue(restored.complete)

    def test_tampered_body_rejected_on_load(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = ResponseCache(directory=Path(directory))
            entry = cache.put(
                b"original-body",
                content_type="text/html",
                complete=True,
                source_url="https://x",
                fetched_at="2026-01-01T00:00:00Z",
            )
            (Path(directory) / f"{entry.http_sha256}.body").write_bytes(b"tampered-body")
            with self.assertRaises(CacheIntegrityError):
                ResponseCache(directory=Path(directory))

    def test_missing_license_rejected_on_load(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = ResponseCache(directory=Path(directory))
            entry = cache.put(
                b"body",
                content_type="text/html",
                complete=True,
                source_url="https://x",
                fetched_at="2026-01-01T00:00:00Z",
            )
            meta_path = Path(directory) / f"{entry.provenance_id}.meta.json"
            payload = json.loads(meta_path.read_text(encoding="utf-8"))
            payload["licenseId"] = ""
            meta_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(CacheIntegrityError):
                ResponseCache(directory=Path(directory))

    def test_complete_must_be_strict_true(self) -> None:
        cache = ResponseCache()
        for bad in ("false", 1, "true", None):
            with self.assertRaises(IncompleteCacheError):
                cache.put(
                    b"body",
                    content_type="text/html",
                    complete=bad,  # type: ignore[arg-type]
                    source_url="https://x",
                    fetched_at="2026-01-01T00:00:00Z",
                )
        self.assertEqual(len(cache), 0)

    def test_empty_license_or_source_rejected(self) -> None:
        cache = ResponseCache()
        with self.assertRaises(ValueError):
            cache.put(
                b"body",
                content_type="text/html",
                complete=True,
                source_url="https://x",
                fetched_at="t",
                license_id="",
            )
        with self.assertRaises(ValueError):
            cache.put(
                b"body",
                content_type="text/html",
                complete=True,
                source_url="",
                fetched_at="t",
            )

    def test_whitespace_and_spoofed_license_rejected(self) -> None:
        cache = ResponseCache()
        with self.assertRaises(ValueError):
            cache.put(
                b"body", content_type="text/html", complete=True,
                source_url="   ", fetched_at="t",
            )
        with self.assertRaises(ValueError):
            cache.put(
                b"body", content_type="text/html", complete=True,
                source_url="https://x", fetched_at="t", attribution=" ",
            )
        # 任意 https 不得冒充 CC BY-SA 4.0。
        with self.assertRaises(ValueError):
            cache.put(
                b"body", content_type="text/html", complete=True,
                source_url="https://x", fetched_at="t",
                license_url="https://evil.example/license",
            )
        with self.assertRaises(ValueError):
            cache.put(
                b"body", content_type="text/html", complete=True,
                source_url="https://x", fetched_at="t",
                license_id="MIT",
            )

    def test_get_ambiguous_multiple_provenance_fails_closed(self) -> None:
        cache = ResponseCache()
        body = b"same-body"
        first = cache.put(
            body, content_type="text/html", complete=True,
            source_url="https://a", fetched_at="t",
        )
        cache.put(
            body, content_type="text/html", complete=True,
            source_url="https://b", fetched_at="t",
        )
        with self.assertRaises(CacheIntegrityError):
            cache.get(first.http_sha256)
        self.assertEqual(len(cache.provenance_for(first.http_sha256)), 2)

    def test_load_rejects_non_strict_complete_and_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            body = b"payload"
            digest = hashlib.sha256(body).hexdigest()
            (Path(directory) / f"{digest}.body").write_bytes(body)
            base = {
                "httpSha256": digest,
                "bodyFile": f"{digest}.body",
                "contentType": "text/html",
                "complete": True,
                "sourceUrl": "https://x",
                "licenseId": WIKTIONARY_LICENSE_ID,
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                "attribution": DEFAULT_ATTRIBUTION,
                "fetchedAt": "t",
                "bytes": len(body),
            }
            meta = Path(directory) / "deadbeef.meta.json"
            payload = dict(base)
            payload["complete"] = "false"
            meta.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(CacheIntegrityError):
                ResponseCache(directory=Path(directory))

            payload = dict(base)
            payload["bodyFile"] = "../../etc/passwd"
            meta.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(CacheIntegrityError):
                ResponseCache(directory=Path(directory))

            # bytes=True（bool 是 int 子类，True==1 漏洞）必须拒绝。
            payload = dict(base)
            payload["bytes"] = True
            meta.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(CacheIntegrityError):
                ResponseCache(directory=Path(directory))

            # 声明 provenanceId 与文件名不一致必须拒绝。
            payload = dict(base)
            payload["provenanceId"] = "deadbeef"
            meta.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(CacheIntegrityError):
                ResponseCache(directory=Path(directory))

    def test_evidence_id_covers_provenance_metadata(self) -> None:
        def make(**overrides):
            kwargs = dict(
                word="read",
                page_url="https://en.wiktionary.org/wiki/read",
                history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
                revid=42,
                fetched_at="2026-01-01T00:00:00Z",
                body=b"same-body",
                observations=extract_observations(english_html()).observations,
            )
            kwargs.update(overrides)
            return build_source_evidence(**kwargs)

        base = make()
        other_page = make(page_url="https://en.wiktionary.org/wiki/reed")
        other_license = make(change_note=None, status="revalidated")
        self.assertNotEqual(base.evidence_id, other_page.evidence_id)
        self.assertNotEqual(base.evidence_id, other_license.evidence_id)
        # same body 但不同 provenance → 不同 evidenceId（不碰撞）。
        self.assertEqual(base.http_sha256, other_page.http_sha256)

    def test_source_evidence_from_json_strict(self) -> None:
        payload = build_source_evidence(
            word="read",
            page_url="https://en.wiktionary.org/wiki/read",
            history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
            revid=5,
            fetched_at="2026-01-05T00:00:00Z",
            body=english_html().encode(),
            observations=extract_observations(english_html()).observations,
        ).to_json()
        self.assertEqual(SourceEvidence.from_json(payload).evidence_id, payload["evidenceId"])
        # None / 类型不符 / 许可不实 / evidenceId 不符一律拒绝，不 str() 强转通过。
        for key in ("pageUrl", "licenseId", "licenseUrl", "attribution"):
            broken = dict(payload)
            broken[key] = None
            with self.assertRaises(ValueError):
                SourceEvidence.from_json(broken)
        spoofed = dict(payload)
        spoofed["licenseUrl"] = "https://evil.example/license"
        with self.assertRaises(ValueError):
            SourceEvidence.from_json(spoofed)
        whitespace = dict(payload)
        whitespace["attribution"] = "   "
        with self.assertRaises(ValueError):
            SourceEvidence.from_json(whitespace)
        mismatched = dict(payload)
        mismatched["evidenceId"] = "0" * 64
        with self.assertRaises(ValueError):
            SourceEvidence.from_json(mismatched)
        del payload["licenseId"]
        with self.assertRaises(ValueError):
            SourceEvidence.from_json(payload)


class EvidenceLedgerTest(unittest.TestCase):
    def _evidence(self, revid: int, ipa_html: str | None = None) -> SourceEvidence:
        html = ipa_html or english_html()
        return build_source_evidence(
            word="read",
            page_url="https://en.wiktionary.org/wiki/read",
            history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
            revid=revid,
            fetched_at=f"2026-01-0{revid}T00:00:00Z",
            body=html.encode(),
            observations=extract_observations(html).observations,
        )

    def test_history_not_overwritten(self) -> None:
        ledger = EvidenceLedger()
        first = self._evidence(1)
        second = self._evidence(2)
        self.assertTrue(ledger.record(first))
        self.assertTrue(ledger.record(second))
        self.assertEqual(len(ledger.history_for("read")), 2)
        # 最新一条是 revid 2。
        self.assertEqual(ledger.latest_for("read").revid, 2)

    def test_record_is_idempotent_for_identical(self) -> None:
        ledger = EvidenceLedger()
        first = self._evidence(1)
        self.assertTrue(ledger.record(first))
        self.assertFalse(ledger.record(first))

    def test_evidence_includes_license_and_source(self) -> None:
        evidence = self._evidence(3)
        payload = evidence.to_json()
        self.assertEqual(payload["licenseId"], WIKTIONARY_LICENSE_ID)
        self.assertEqual(payload["attribution"], DEFAULT_ATTRIBUTION)
        self.assertIn("historyUrl", payload)
        self.assertIn("semanticFingerprint", payload)


if __name__ == "__main__":
    unittest.main()
