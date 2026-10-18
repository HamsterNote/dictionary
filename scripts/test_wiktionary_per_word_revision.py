"""Offline production-path regressions for TOC revision and MAIN language binding."""
from __future__ import annotations

import json
import unittest
from urllib.parse import parse_qs, urlparse

from test_wiktionary_per_word_support import (
    SYNTHETIC_UA, ScriptedTransport, english_html, fixed_now, plain_response,
    text_payload, tocdata_payload,
)
from wiktionary_per_word.action_api import ActionApiError, build_parse_text_url
from wiktionary_per_word.collector import Collector
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache
from wiktionary_per_word.html_extract import extract_observations
from wiktionary_per_word.http_adapter import FakeClock, HttpAdapter
from wiktionary_per_word.ledger import BatchAuthorization, BatchLedger, WordStatus
from wiktionary_per_word.offline_reparse import generate_candidates, reparse_cached_entry


# Real-cache shape for "in": display number 2, English section index 5.
SECTIONS = [{"tocLevel": 1, "hLevel": 2, "line": "English", "number": "2", "index": "5"}]
GERMAN = '<h2 id="German">German</h2><h3>Noun</h3><span class="IPA">/x/</span>'


class RevisionBindingTests(unittest.TestCase):
    def harness(self, responses=None, *, transport=None):
        ledger = BatchLedger.create(
            batch_id="synthetic-revision-binding",
            authorization=BatchAuthorization(distinct_heads=100, decompressed_bytes=20971520,
                granted=True, source="synthetic-test", synthetic=True),
            created_at="2026-01-01T00:00:00Z", allow_synthetic_authorization=True)
        transport = transport or ScriptedTransport(responses)
        adapter = HttpAdapter(transport=transport, budget=ledger.budget, clock=FakeClock(),
            user_agent=SYNTHETIC_UA, allow_synthetic_user_agent=True, interval_seconds=5)
        evidence = EvidenceLedger()
        collector = Collector(ledger=ledger, adapter=adapter, cache=ResponseCache(),
                              evidence_ledger=evidence, now=fixed_now())
        return collector, ledger, evidence, transport

    def assert_failed(self, toc, main, *, reason):
        collector, ledger, evidence, transport = self.harness([
            plain_response(toc), plain_response(main)])
        entry = collector.collect_word("in")
        self.assertEqual(entry.status, WordStatus.FAILED)
        self.assertIn(reason, entry.note)
        self.assertEqual(evidence.history_for("in"), [])
        self.assertEqual(entry.evidence_ids, [])
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(ledger.budget.request_count, 2)
        self.assertEqual(ledger.budget.network_bytes, len(toc) + len(main))
        self.assertIsNone(ledger.checkpoint.active_request)

    def test_page_section_shift_uses_snapshot_oldid_and_reaches_candidates(self):
        calls = []
        def moving_page(url, headers):
            query = parse_qs(urlparse(url).query)
            calls.append(query)
            if query["prop"] == ["tocdata|revid"]:
                return plain_response(tocdata_payload(SECTIONS, revid=201))
            # Live revision 202 moved English; page+section=5 now contains German.
            # Only the frozen revision 201 still has English at section 5.
            if query.get("oldid") == ["201"] and "page" not in query:
                return plain_response(text_payload(english_html(), revid=201))
            return plain_response(text_payload(GERMAN, revid=202))
        collector, ledger, evidence, _ = self.harness(transport=moving_page)
        entry = collector.collect_word("in")
        self.assertEqual(entry.status, WordStatus.EXTRACTED)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1], {"action": ["parse"], "oldid": ["201"],
            "section": ["5"], "prop": ["text|revid"], "format": ["json"]})
        source = evidence.history_for("in")[0]
        self.assertEqual(source.revid, 201)
        observations = [o for cached in collector.cache.entries()
                        for o in reparse_cached_entry(cached).observations]
        self.assertTrue(observations)
        self.assertTrue(all(o.applicability.language.values == ("English",) for o in observations))
        candidates = generate_candidates(head="in", current_value=None, observations=observations)
        self.assertTrue(any(c.readings for c in candidates))
        self.assertFalse(any("/x/" in c.readings for c in candidates))
        self.assertEqual(ledger.budget.request_count, 2)

    def test_different_main_revision_fails_without_candidate_evidence(self):
        self.assert_failed(tocdata_payload(SECTIONS, revid=201),
            text_payload(english_html(), revid=202), reason="MAIN revid differs")

    def test_german_body_at_matching_revision_fails_without_english_evidence(self):
        self.assert_failed(tocdata_payload(SECTIONS, revid=201),
            text_payload(GERMAN, revid=201), reason="language root rejected")

    def test_missing_ambiguous_or_wrong_level_language_roots_fail(self):
        for html in ('<span class="IPA">/x/</span>', '<h3>English</h3><span class="IPA">/x/</span>',
                     '<h2>english</h2><span class="IPA">/x/</span>', english_html() + GERMAN,
                     '<h1>English</h1>' + english_html(), english_html() + '<h2>English</h2>'):
            with self.subTest(html=html):
                self.assert_failed(tocdata_payload(SECTIONS), text_payload(html), reason="language root rejected")

    def test_ipa_before_language_root_cannot_acquire_later_english_scope(self):
        self.assert_failed(tocdata_payload(SECTIONS),
            text_payload('<span class="IPA">/x/</span>' + english_html()), reason="language root rejected")

    def test_missing_or_invalid_toc_revision_stops_before_main_dispatch(self):
        for revision in (None, True, "201", 0, -1):
            for missing in (False, True) if revision is None else (False,):
                payload = {"parse": {"tocdata": {"sections": SECTIONS}, "revid": revision}}
                if missing:
                    del payload["parse"]["revid"]
                collector, ledger, evidence, transport = self.harness([
                    plain_response(json.dumps(payload).encode())])
                with self.subTest(revision=revision, missing=missing):
                    entry = collector.collect_word("in")
                    self.assertEqual(entry.status, WordStatus.FAILED)
                    self.assertIn("TOC response requires", entry.note)
                    self.assertEqual(len(transport.calls), 1)
                    self.assertEqual(ledger.budget.request_count, 1)
                    self.assertEqual(evidence.history_for("in"), [])

    def test_missing_or_illegal_oldid_cannot_build_main_url(self):
        with self.assertRaises(TypeError):
            build_parse_text_url(section_index="5")
        for oldid in (None, True, "201", 0, -1, 201.0):
            with self.subTest(oldid=oldid), self.assertRaises(ActionApiError):
                build_parse_text_url(oldid, "5")

    def test_invalid_section_cannot_build_main_url(self):
        for index in (None, 5, "", "0", "-1", "5.1", "5&oldid=202"):
            with self.subTest(index=index), self.assertRaises(ActionApiError):
                build_parse_text_url(201, index)

    def test_out_of_range_section_is_failed_not_missing_or_extracted(self):
        self.assert_failed(tocdata_payload(SECTIONS),
            b'{"error":{"code":"nosuchsection","info":"There is no section 5"}}',
            reason="parse-api-error:nosuchsection")

    def test_unavailable_oldid_is_failed_not_a_missing_head(self):
        self.assert_failed(tocdata_payload(SECTIONS),
            b'{"error":{"code":"nosuchrevid"}}', reason="MAIN snapshot unavailable:nosuchrevid")

    def test_extractor_derives_language_or_unknown_instead_of_assuming_english(self):
        german = extract_observations(GERMAN)
        self.assertEqual(german.languages, ["German"])
        self.assertEqual(german.observations[0].applicability.language.values, ("German",))
        unknown = extract_observations('<span class="IPA">/x/</span>')
        self.assertTrue(unknown.observations[0].applicability.language.is_unknown)
        self.assertIn("language-not-determinable", unknown.observations[0].unresolved_reasons)

    def test_english_heading_with_nested_markup_and_edit_link_is_verified(self):
        html = ('<h2><span class="mw-headline" id="English">Eng&#108;ish</span>'
                '<span class="mw-editsection"><a>[edit]</a></span></h2>'
                '<h3>Noun</h3><span class="IPA">/x/</span>')
        collector, _, evidence, _ = self.harness([
            plain_response(tocdata_payload(SECTIONS)), plain_response(text_payload(html))])
        self.assertEqual(collector.collect_word("in").status, WordStatus.EXTRACTED)
        self.assertEqual(evidence.history_for("in")[0].language, "English")
        observation = extract_observations(html, expected_language="English").observations[0]
        self.assertEqual(observation.applicability.language.values, ("English",))


if __name__ == "__main__":
    unittest.main()
