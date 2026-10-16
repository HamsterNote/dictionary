#!/usr/bin/env python3
"""离线重解析 / CLI / collector 集成离线 unittest：tasks 5.1 与端到端。

覆盖：模块边界与默认离线、CLI --help、apply 校验拒绝且不联网、候选动作、
collector 端到端（缺页/无 English 状态、预算暂停、截断不入缓存、同词重试）。
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    REAL_LOOKING_UA,
    SYNTHETIC_UA,
    ScriptedTransport,
    english_html,
    fixed_now,
    plain_response,
    text_payload,
    tocdata_payload,
)

import refresh_wiktionary_pronunciations as cli  # noqa: E402
from wiktionary_per_word import (  # noqa: E402
    action_api,
    collector,
    evidence,
    html_extract,
    http_adapter,
    ledger as ledger_module,
    offline_reparse,
    scope_model,
)
from wiktionary_per_word.evidence import CacheEntry, EvidenceLedger, ResponseCache  # noqa: E402
from wiktionary_per_word.html_extract import extract_observations  # noqa: E402
from wiktionary_per_word.http_adapter import HttpAdapter, RequestKind, RunBudget  # noqa: E402
from wiktionary_per_word.ledger import BatchAuthorization, BatchLedger, WordStatus  # noqa: E402
from wiktionary_per_word.offline_reparse import (  # noqa: E402
    CandidateAction,
    build_source_evidence,
    generate_candidates,
    reparse_cached_entry,
)

MULTI_LANG_SECTIONS = [
    {"toclevel": 1, "level": "2", "line": "German", "number": "1"},
    {"toclevel": 1, "level": "2", "line": "English", "number": "2"},
]


def main_text_json(html: str, *, as_object: bool = True, revid: int = 7) -> bytes:
    """模拟主展开 parse.text：{"*": html} 或裸 str。"""
    text: object = {"*": html} if as_object else html
    return json.dumps(
        {"parse": {"title": "read", "pageid": 1, "revid": revid, "text": text}}
    ).encode("utf-8")


def make_adapter(responses, *, budget=None, **kwargs) -> HttpAdapter:
    return HttpAdapter(
        transport=ScriptedTransport(responses),
        budget=budget or RunBudget(max_decompressed_bytes=1024 * 1024),
        user_agent=SYNTHETIC_UA,
        allow_synthetic_user_agent=True,
        interval_seconds=0.0,
        **kwargs,
    )


def make_ledger(**kwargs) -> BatchLedger:
    return BatchLedger.create(
        batch_id="integration",
        authorization=BatchAuthorization(
            distinct_heads=100,
            decompressed_bytes=20 * 1024 * 1024,
            granted=True,
            source="unit-test-grant",
            synthetic=True,
        ),
        created_at="2026-01-01T00:00:00Z",
        allow_synthetic_authorization=True,
        **kwargs,
    )


class ModuleBoundaryTest(unittest.TestCase):
    def test_submodules_exist(self) -> None:
        for module in (
            scope_model,
            http_adapter,
            html_extract,
            evidence,
            ledger_module,
            offline_reparse,
            action_api,
            collector,
        ):
            self.assertTrue(hasattr(module, "__name__"))

    def test_no_requests_or_kaikki_dependency(self) -> None:
        self.assertNotIn("requests", sys.modules)
        source_root = Path(__file__).parent / "wiktionary_per_word"
        for path in source_root.glob("*.py"):
            text = path.read_text(encoding="utf-8").lower()
            self.assertNotIn("import requests", text)
            self.assertNotIn("from requests", text)
            # 不强依赖 Kaikki 下载入口。
            self.assertNotIn("import kaikki", text)

    def test_scope_three_formats_roundtrip(self) -> None:
        from wiktionary_per_word.scope_model import Scope

        known = Scope.from_json({"kind": "known", "values": ["RP"]})
        explicit = Scope.from_json({"kind": "explicit-all", "evidence": "obs:1"})
        unknown = Scope.from_json({"kind": "unknown", "reason": "why"})
        self.assertTrue(known.is_known)
        self.assertTrue(explicit.is_wildcard)
        self.assertTrue(unknown.is_unknown)
        # 坏引用降级 unknown，绝不升成 explicit-all。
        self.assertTrue(Scope.from_json({"kind": "explicit-all"}).is_unknown)


class CandidateGenerationTest(unittest.TestCase):
    def test_add_when_no_current(self) -> None:
        observations = extract_observations(english_html()).observations
        candidates = generate_candidates(
            head="read", current_value=None, observations=observations
        )
        self.assertTrue(any(c.action is CandidateAction.ADD for c in candidates))

    def test_keep_when_current_present(self) -> None:
        observations = extract_observations(english_html()).observations
        candidates = generate_candidates(
            head="read", current_value="/ri\u02d0d/", observations=observations
        )
        self.assertTrue(any(c.action is CandidateAction.KEEP for c in candidates))

    def test_review_when_legacy_scope_unknown(self) -> None:
        observations = extract_observations(english_html()).observations
        candidates = generate_candidates(
            head="read", current_value="/zzz/", observations=observations
        )
        review = [c for c in candidates if c.action is CandidateAction.REVIEW]
        self.assertTrue(review)
        self.assertIn("requires-human-scope-resolution", review[0].reasons)

    def test_fragment_only_is_unresolved(self) -> None:
        html = '<ul><li><span class="IPA">/fr\u00e6g</li></ul>'
        observations = extract_observations(html).observations
        candidates = generate_candidates(head="x", current_value=None, observations=observations)
        self.assertEqual(candidates[0].status, "unresolved")


class CandidateScopeTest(unittest.TestCase):
    """候选生成保留逐条 scope，不跨 scope/口音按 IPA 折叠。"""

    def test_same_ipa_different_accent_not_collapsed(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            "<ul>"
            '<li><span class="qualifier-content">(GA)</span><span class="IPA">/x/</span></li>'
            '<li><span class="qualifier-content">(RP)</span><span class="IPA">/x/</span></li>'
            "</ul>"
        )
        observations = extract_observations(html).observations
        candidates = generate_candidates(head="x", current_value=None, observations=observations)
        candidate = candidates[0]
        self.assertEqual(len(candidate.reading_refs), 2)
        # 完整来源读法进入 pending（classification-pending），不冒充 default qualified。
        self.assertEqual(len(candidate.pending_readings), 2)
        self.assertEqual(candidate.default_readings, ())

    def test_true_duplicate_merged_by_scope(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            "<ul>"
            '<li><span class="qualifier-content">(GA)</span><span class="IPA">/x/</span></li>'
            '<li><span class="qualifier-content">(GA)</span><span class="IPA">/x/</span></li>'
            "</ul>"
        )
        observations = extract_observations(html).observations
        candidates = generate_candidates(head="x", current_value=None, observations=observations)
        candidate = candidates[0]
        self.assertEqual(len(candidate.reading_refs), 1)
        self.assertIn(";", candidate.reading_refs[0].ref)
        self.assertEqual(len(candidate.pending_readings), 1)

    def test_usage_label_distinguishes_true_duplicate(self) -> None:
        # gap4：archaic 与非限定同 IPA 不是真重复，且都不冒充 default qualified。
        html = (
            '<li><span class="IPA archaic">/x/</span>'
            '<span class="IPA">/x/</span>'
            '<span class="IPA">/x\x01/</span></li>'
        )
        observations = extract_observations(html).observations
        candidates = generate_candidates(head="x", current_value=None, observations=observations)
        candidate = candidates[0]
        # 两个完整读法（archaic / 非限定）不因 IPA 相同被合并。
        self.assertEqual(len(candidate.reading_refs), 2)
        self.assertEqual(candidate.default_readings, ())
        self.assertEqual(candidate.supplemental_readings, ())
        usage = sorted(label for ref in candidate.reading_refs for label in ref.usage_labels)
        self.assertIn("archaic", usage)
        # 控制字符损坏仅为 evidence-only（在独立的 evidence-only 候选里）。
        evidence_candidate = next(c for c in candidates if c.status == "evidence-only")
        self.assertIn("/x\x01/", evidence_candidate.evidence_only_readings)
        self.assertEqual(evidence_candidate.supplemental_readings, ())

    def test_reading_refs_carry_full_scope(self) -> None:
        observations = extract_observations(english_html()).observations
        candidates = generate_candidates(
            head="read", current_value=None, observations=observations, evidence_id="ev:1"
        )
        candidate = candidates[0]
        self.assertTrue(candidate.reading_refs)
        for ref in candidate.reading_refs:
            self.assertEqual(
                set(ref.applicability),
                {"language", "entry", "lexeme", "role", "pos", "sense", "accent", "other"},
            )
            self.assertTrue(ref.ref.startswith("ev:1#"))
            self.assertIn(ref.qualification, {"classification-pending", "evidence-only"})
            self.assertIsInstance(ref.usage_labels, tuple)

    def test_reading_refs_traceable_to_source_observations(self) -> None:
        # 本轮 gap7：ref.indices 可解回源观测，且保留 rawIpa/tags/path 等原 metadata。
        html = (
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA archaic">/x/</span></li>'
            '<li><span class="IPA">/x/</span></li></ul>'
        )
        observations = extract_observations(html).observations
        candidate = generate_candidates(head="x", current_value=None, observations=observations)[0]
        self.assertTrue(candidate.reading_refs)
        for ref in candidate.reading_refs:
            self.assertTrue(ref.indices)
            for index in ref.indices:
                self.assertEqual(ref.raw_ipa, observations[index].raw_ipa)
                self.assertEqual(ref.tags, observations[index].tags)
                self.assertEqual(ref.path, observations[index].path)
            self.assertIsInstance(ref.unclassified_tags, tuple)

    def test_fragment_marked_evidence_only(self) -> None:
        html = '<ul><li><span class="IPA">/fr\u00e6g</li></ul>'
        observations = extract_observations(html).observations
        candidates = generate_candidates(head="x", current_value=None, observations=observations)
        self.assertEqual(candidates[0].status, "unresolved")
        self.assertIn("/fr\u00e6g", candidates[0].evidence_only_readings)

    def test_control_fragment_marked_evidence_only(self) -> None:
        # 未达完整/损坏 ALL 仅 evidence-only，不标 supplemental。
        html = '<ul><li><span class="IPA">/x\u0000/</span></li></ul>'
        observations = extract_observations(html).observations
        candidates = generate_candidates(head="x", current_value=None, observations=observations)
        self.assertEqual(candidates[0].status, "unresolved")
        self.assertIn("/x\u0000/", candidates[0].evidence_only_readings)
        self.assertEqual(candidates[0].supplemental_readings, ())


class JsonCacheReparseTest(unittest.TestCase):
    """application/json 缓存：主 parse.text 展开内容不得被当 tocdata。"""

    @staticmethod
    def _entry(body: bytes, content_type: str = "application/json") -> CacheEntry:
        import hashlib

        return CacheEntry(
            http_sha256=hashlib.sha256(body).hexdigest(),
            body=body,
            content_type=content_type,
            complete=True,
            source_url="https://en.wiktionary.org/w/api.php?page=read",
            fetched_at="2026-01-01T00:00:00Z",
        )

    def test_main_parse_text_object_reparsed(self) -> None:
        body = main_text_json(english_html(), as_object=True)
        result = reparse_cached_entry(self._entry(body))
        self.assertGreaterEqual(len(result.observations), 4)
        self.assertEqual(result.warnings, [])

    def test_main_parse_text_bare_str_reparsed(self) -> None:
        body = main_text_json(english_html(), as_object=False)
        result = reparse_cached_entry(self._entry(body))
        self.assertGreaterEqual(len(result.observations), 4)

    def test_main_json_http_hash_is_json_not_html(self) -> None:
        import hashlib

        body = main_text_json(english_html())
        observations = reparse_cached_entry(self._entry(body)).observations
        evidence = build_source_evidence(
            word="read",
            page_url="https://en.wiktionary.org/wiki/read",
            history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
            revid=7,
            fetched_at="2026-01-01T00:00:00Z",
            body=body,
            observations=observations,
        )
        self.assertEqual(evidence.http_sha256, hashlib.sha256(body).hexdigest())
        self.assertNotEqual(
            evidence.http_sha256, hashlib.sha256(english_html().encode()).hexdigest()
        )

    def test_tocdata_json_not_treated_as_html(self) -> None:
        body = tocdata_payload([MULTI_LANG_SECTIONS[0]])  # 只有 German
        result = reparse_cached_entry(self._entry(body))
        self.assertEqual(result.observations, [])
        self.assertIn("no-english-section", result.warnings)

    def test_tocdata_json_with_english_has_no_warning(self) -> None:
        body = tocdata_payload(MULTI_LANG_SECTIONS)
        result = reparse_cached_entry(self._entry(body))
        self.assertEqual(result.observations, [])
        self.assertEqual(result.warnings, [])

    def test_root_error_json_fails_closed(self) -> None:
        # 本轮 gap6：根级 error 在 parse 判断前处理，不落 HTML 得 warnings=[]。
        body = b'{"error": {"code": "missingtitle"}}'
        result = reparse_cached_entry(self._entry(body))
        self.assertEqual(result.observations, [])
        self.assertIn("api-error", result.warnings)

    def test_malformed_json_fails_closed(self) -> None:
        result = reparse_cached_entry(self._entry(b'{"broken":'))
        self.assertEqual(result.observations, [])
        self.assertIn("malformed-json", result.warnings)

    def test_string_false_entry_rejected(self) -> None:
        # 本轮 gap5：手工坏 entry complete="false" 不得成功重解析。
        import hashlib

        body = b"notjson"
        bad = CacheEntry(
            http_sha256=hashlib.sha256(body).hexdigest(),
            body=body,
            content_type="application/json",
            complete="false",  # type: ignore[arg-type]
            source_url="u",
            fetched_at="t",
        )
        with self.assertRaises(ValueError):
            reparse_cached_entry(bad)

    def test_hash_mismatch_entry_rejected(self) -> None:
        body = b'{"parse": {"text": "x"}}'
        bad = CacheEntry(
            http_sha256="0" * 64,
            body=body,
            content_type="application/json",
            complete=True,
            source_url="u",
            fetched_at="t",
        )
        with self.assertRaises(ValueError):
            reparse_cached_entry(bad)



    def test_help_returns_zero(self) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer), self.assertRaises(SystemExit) as context:
            cli.main(["--help"])
        self.assertEqual(context.exception.code, 0)
        self.assertIn("离线", buffer.getvalue())

    def test_offline_reparse_default_no_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = ResponseCache(directory=Path(directory))
            cache.put(
                english_html().encode(),
                content_type="text/html",
                complete=True,
                source_url="https://en.wiktionary.org/w/api.php?page=read",
                fetched_at="2026-01-01T00:00:00Z",
            )
            current = Path(directory) / "current.json"
            current.write_text(json.dumps({"read": "/zzz/"}), encoding="utf-8")
            output = Path(directory) / "out.json"
            code = cli.main(
                [
                    "--offline-reparse",
                    "--cache-dir",
                    directory,
                    "--current",
                    str(current),
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(code, 0)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "offline-reparse")
            self.assertGreaterEqual(len(payload["candidates"]), 1)

    def test_apply_alone_refuses_without_network(self) -> None:
        self.assertEqual(cli.main(["--apply"]), 2)

    def test_apply_missing_user_agent_refused(self) -> None:
        parser = cli.build_parser()
        args = parser.parse_args(["--apply", "--heads-file", "/nope", "--authorization-file", "/nope"])
        with self.assertRaises(cli.CliError):
            cli.validate_apply_config(args)

    def test_apply_synthetic_user_agent_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            heads = Path(directory) / "heads.txt"
            heads.write_text("read\n", encoding="utf-8")
            auth = Path(directory) / "auth.json"
            auth.write_text(
                json.dumps(
                    {
                        "distinctHeads": 1,
                        "decompressedBytes": 1024 * 1024,
                        "granted": True,
                        "source": "grant",
                    }
                ),
                encoding="utf-8",
            )
            args = cli.build_parser().parse_args(
                [
                    "--apply",
                    "--heads-file",
                    str(heads),
                    "--user-agent",
                    SYNTHETIC_UA,
                    "--authorization-file",
                    str(auth),
                    "--budget-heads",
                    "1",
                    "--budget-decompressed-mib",
                    "1",
                    "--checkpoint",
                    str(Path(directory) / "cp.json"),
                    "--cache-dir",
                    str(Path(directory) / "cache"),
                ]
            )
            with self.assertRaises(cli.CliError):
                cli.validate_apply_config(args)

    def test_apply_synthetic_authorization_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            heads = Path(directory) / "heads.txt"
            heads.write_text("read\n", encoding="utf-8")
            auth = Path(directory) / "auth.json"
            auth.write_text(
                json.dumps(
                    {
                        "distinctHeads": 1,
                        "decompressedBytes": 1024 * 1024,
                        "granted": True,
                        "source": "grant",
                        "synthetic": True,
                    }
                ),
                encoding="utf-8",
            )
            args = cli.build_parser().parse_args(
                [
                    "--apply",
                    "--heads-file",
                    str(heads),
                    "--user-agent",
                    REAL_LOOKING_UA,
                    "--authorization-file",
                    str(auth),
                    "--budget-heads",
                    "1",
                    "--budget-decompressed-mib",
                    "1",
                    "--checkpoint",
                    str(Path(directory) / "cp.json"),
                    "--cache-dir",
                    str(Path(directory) / "cache"),
                ]
            )
            with self.assertRaises(cli.CliError):
                cli.validate_apply_config(args)

    def test_apply_valid_config_builds_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            heads = Path(directory) / "heads.txt"
            heads.write_text("read\n", encoding="utf-8")
            auth = Path(directory) / "auth.json"
            auth.write_text(
                json.dumps(
                    {
                        "distinctHeads": 1,
                        "decompressedBytes": 1024 * 1024,
                        "granted": True,
                        "source": "grant",
                    }
                ),
                encoding="utf-8",
            )
            args = cli.build_parser().parse_args(
                [
                    "--apply",
                    "--heads-file",
                    str(heads),
                    "--user-agent",
                    REAL_LOOKING_UA,
                    "--authorization-file",
                    str(auth),
                    "--budget-heads",
                    "1",
                    "--budget-decompressed-mib",
                    "1",
                    "--checkpoint",
                    str(Path(directory) / "cp.json"),
                    "--cache-dir",
                    str(Path(directory) / "cache"),
                ]
            )
            config = cli.validate_apply_config(args)
            self.assertEqual(config.budget_heads, 1)
            self.assertEqual(config.budget_decompressed_bytes, 1024 * 1024)


class CollectorIntegrationTest(unittest.TestCase):
    def _harness(self, responses, *, ledger=None, cache=None, evidence_ledger=None, budget=None):
        ledger = ledger or make_ledger()
        if budget is not None:
            ledger.budget.max_decompressed_bytes = budget
        adapter = make_adapter(responses, budget=ledger.budget)
        collector_instance = collector.Collector(
            ledger=ledger,
            adapter=adapter,
            cache=cache if cache is not None else ResponseCache(),
            evidence_ledger=evidence_ledger or EvidenceLedger(),
            now=fixed_now(),
        )
        return collector_instance, ledger

    def test_found_page_records_evidence_and_cache(self) -> None:
        cache = ResponseCache()
        ledger = make_ledger()
        evidence_ledger = EvidenceLedger()
        collector_instance, ledger = self._harness(
            [
                plain_response(tocdata_payload(MULTI_LANG_SECTIONS)),
                plain_response(text_payload(english_html())),
            ],
            ledger=ledger,
            cache=cache,
            evidence_ledger=evidence_ledger,
        )
        entry = collector_instance.collect_word("read")
        self.assertEqual(entry.status, WordStatus.EXTRACTED)
        self.assertEqual(len(evidence_ledger.history_for("read")), 1)
        # HTML 与 tocdata JSON 都被缓存。
        self.assertGreaterEqual(len(cache), 2)

    def test_missing_page_status_without_clearing(self) -> None:
        collector_instance, _ = self._harness(
            [plain_response(b'{"error": {"code": "missingtitle"}}')]
        )
        entry = collector_instance.collect_word("nope")
        self.assertEqual(entry.status, WordStatus.MISSING)

    def test_no_english_status(self) -> None:
        collector_instance, _ = self._harness(
            [plain_response(tocdata_payload([MULTI_LANG_SECTIONS[0]]))]
        )
        entry = collector_instance.collect_word("nur")
        self.assertEqual(entry.status, WordStatus.NO_QUALIFIED)

    def test_budget_pause_stops_batch_and_caches_nothing_truncated(self) -> None:
        # tocdata 小、text 巨大：text 触发限额，暂停。
        big_html = "<ul><li>" + ('<span class="IPA">/x/</span>' * 5000) + "</li></ul>"
        cache = ResponseCache()
        collector_instance, ledger = self._harness(
            [
                plain_response(tocdata_payload(MULTI_LANG_SECTIONS)),
                plain_response(text_payload(big_html)),
            ],
            cache=cache,
            budget=2000,
        )
        report = collector_instance.run_batch(["read", "next"])
        self.assertIsNotNone(report.paused_reason)
        self.assertEqual(report.stopped_before, "next")
        # 第一个词失败且批次暂停；不启动第二个词。
        self.assertEqual(ledger.checkpoint.words["read"].status, WordStatus.FAILED)
        self.assertNotIn("next", ledger.checkpoint.words)
        # 截断的 text 响应不进入成功缓存（只缓存了完整的 tocdata）。
        self.assertLessEqual(len(cache), 1)

    def test_same_word_retry_does_not_add_distinct(self) -> None:
        responses = [
            plain_response(b'{"error": {"code": "missingtitle"}}'),
            plain_response(b'{"error": {"code": "missingtitle"}}'),
        ]
        collector_instance, ledger = self._harness(responses)
        collector_instance.collect_word("read")
        collector_instance.collect_word("read")
        self.assertEqual(ledger.budget.distinct_heads_started, 1)
        self.assertEqual(ledger.budget.request_count, 2)


    def test_single_head_byte_failure_pauses_without_new_run(self) -> None:
        # heads=1：唯一词的必要请求触限失败后暂停，不自动开新 run。
        big_html = "<ul><li>" + ('<span class="IPA">/x/</span>' * 5000) + "</li></ul>"
        collector_instance, ledger = self._harness(
            [
                plain_response(tocdata_payload(MULTI_LANG_SECTIONS)),
                plain_response(text_payload(big_html)),
            ],
            budget=2000,
        )
        ledger.budget.max_distinct_heads = 1
        report = collector_instance.run_batch(["read", "second"])
        self.assertIsNotNone(report.paused_reason)
        self.assertEqual(report.stopped_before, "second")
        self.assertNotIn("second", ledger.checkpoint.words)
        self.assertEqual(ledger.budget.distinct_heads_started, 1)
        self.assertTrue(ledger.paused)


class ContractShapeTest(unittest.TestCase):
    """自包含的机械对齐形状校验，不 import live contracts.py。

    contracts.py 属另一 lane，正在加入 lexeme/empty 支持；本 lane 的测试不依赖
    其当前内容。终态机械 align 由主编排 integration 完成（见下方被跳过的
    ContractAlignmentTest）。
    """

    def test_scope_json_matches_three_format_contract_shape(self) -> None:
        from wiktionary_per_word.scope_model import Scope

        known = Scope.known(["RP", "GA"]).to_json()
        explicit = Scope.explicit_all(["ev:1", "ev:2"]).to_json()
        unknown = Scope.unknown("role-not-determinable").to_json()
        self.assertEqual(known, {"kind": "known", "values": ["RP", "GA"]})
        self.assertEqual(
            explicit, {"kind": "explicit-all", "evidence": ["ev:1", "ev:2"]}
        )
        self.assertEqual(
            unknown, {"kind": "unknown", "reason": "role-not-determinable"}
        )
        # 坏 explicit-all（无证据）降级 unknown，绝不升成通配。
        self.assertTrue(Scope.from_json({"kind": "explicit-all"}).is_unknown)

    def test_observation_contract_shape(self) -> None:
        from wiktionary_per_word.contract_adapter import observation_to_contract

        observation = extract_observations(english_html()).observations[0]
        payload = observation_to_contract(
            observation,
            observation_id="obs:0",
            evidence_id="ev:1",
            source_spelling="read",
        )
        for key in (
            "schema",
            "observationId",
            "evidenceId",
            "language",
            "sourceSpelling",
            "rawIpa",
            "normalizedIpa",
            "notation",
            "completeness",
            "rawTags",
            "rawQualifiers",
            "structuralPath",
            "applicability",
        ):
            self.assertIn(key, payload)
        self.assertEqual(
            set(payload["applicability"]),
            {"language", "entry", "lexeme", "role", "pos", "sense", "accent", "other"},
        )

    def test_empty_ipa_maps_to_empty_completeness(self) -> None:
        # empty IPA 合法，序列化为 evidence-only 的 completeness="empty"。
        from wiktionary_per_word.contract_adapter import completeness_to_contract
        from wiktionary_per_word.html_extract import Observation
        from wiktionary_per_word.scope_model import Applicability, Scope

        observation = Observation(
            raw_ipa="",
            ipa="",
            notation="unknown",
            complete=False,
            qualifiers=(),
            tags=(),
            path=("English", "Pronunciation"),
            section="Pronunciation",
            etymology=None,
            pos=None,
            form=None,
            role=None,
            applicability=Applicability(language=Scope.known(["English"])),
            unresolved_reasons=("empty-ipa",),
            fragment_reasons=("empty",),
        )
        self.assertEqual(completeness_to_contract(observation), "empty")

    def test_evidence_and_checkpoint_contract_shape(self) -> None:
        from wiktionary_per_word.contract_adapter import (
            checkpoint_to_contract,
            evidence_to_contract,
            pause_reason_to_contract,
        )

        observations = extract_observations(english_html()).observations
        evidence_payload = evidence_to_contract(evidence_module_build(observations))
        for key in (
            "schema",
            "evidenceId",
            "sourceSite",
            "language",
            "pageUrl",
            "historyUrl",
            "revision",
            "extractedAt",
            "requestVersion",
            "renderVersion",
            "extractorVersion",
            "tagRuleVersion",
            "responseContentHash",
            "ipaSemanticFingerprint",
            "license",
        ):
            self.assertIn(key, evidence_payload)
        self.assertEqual(evidence_payload["license"]["spdx"], "CC-BY-SA-4.0")
        self.assertTrue(evidence_payload["license"]["shareAlike"])

        ledger = make_ledger()
        ledger.start_word("read")
        ledger.finish_word("read", WordStatus.EXTRACTED)
        ledger.mark_paused("distinct-head-budget", "reached")
        checkpoint_payload = checkpoint_to_contract(ledger.checkpoint)
        for key in (
            "schema",
            "batchId",
            "schemaVersions",
            "approvedBudget",
            "queue",
            "startedDistinctHeads",
            "headStates",
            "counts",
            "pauseReason",
        ):
            self.assertIn(key, checkpoint_payload)
        self.assertEqual(checkpoint_payload["headStates"]["read"], "extracted")
        self.assertEqual(checkpoint_payload["pauseReason"], "head-limit")
        self.assertEqual(pause_reason_to_contract("decompressed-budget-exhausted"), "byte-limit")
        self.assertEqual(pause_reason_to_contract("consumption-uncertain"), "uncertain-consumption")


class ContractAlignmentTest(unittest.TestCase):
    """用 contracts.py 校验器核对内部序列化（真实启用，不再 skip）。"""

    def test_scope_json_passes_contract(self) -> None:
        from wiktionary_per_word import contracts
        from wiktionary_per_word.scope_model import Scope

        for scope in (
            Scope.known(["RP", "GA"]),
            Scope.explicit_all(["ev:1", "ev:2"]),
            Scope.unknown("role-not-determinable"),
        ):
            issues: list[str] = []
            contracts.validate_scope_constraint(scope.to_json(), "scope", issues)
            self.assertEqual(issues, [], f"{scope.kind} 未通过合同校验: {issues}")

    def test_observation_json_passes_contract(self) -> None:
        from wiktionary_per_word import contracts
        from wiktionary_per_word.contract_adapter import observation_to_contract

        observations = extract_observations(english_html()).observations
        for index, observation in enumerate(observations):
            payload = observation_to_contract(
                observation,
                observation_id=f"obs:{index}",
                evidence_id="ev:1",
                source_spelling="read",
            )
            # 8 维含 lexeme；语言 English → en 等价映射；raw tags 全保留。
            self.assertEqual(
                set(payload["applicability"]),
                {"language", "entry", "lexeme", "role", "pos", "sense", "accent", "other"},
            )
            self.assertEqual(payload["language"], "en")
            self.assertEqual(payload["rawTags"], list(observation.tags))
            issues: list[str] = []
            contracts.validate_observation(payload, f"obs[{index}]", issues)
            self.assertEqual(issues, [], f"observation 未通过合同校验: {issues}")

    def test_empty_and_control_and_fragment_completeness(self) -> None:
        from wiktionary_per_word import contracts
        from wiktionary_per_word.contract_adapter import observation_to_contract

        cases = {
            '<ul><li><span class="IPA"></span></li></ul>': "empty",
            '<ul><li><span class="IPA">/x\u0000/</span></li></ul>': "control-character",
            '<ul><li><span class="IPA">/fr\u00e6g</li></ul>': "broken-delimiter",
            '<span class="IPA">/x': "truncated",
        }
        for html, expected in cases.items():
            observation = extract_observations(html).observations[0]
            payload = observation_to_contract(
                observation,
                observation_id="obs:1",
                evidence_id="ev:1",
                source_spelling="read",
            )
            self.assertEqual(payload["completeness"], expected)
            issues: list[str] = []
            contracts.validate_observation(payload, "obs", issues)
            self.assertEqual(issues, [], f"{expected} 未通过合同校验: {issues}")
            # 空 IPA 允许空 rawIpa/normalizedIpa。
            if expected == "empty":
                self.assertEqual(payload["rawIpa"], "")
                self.assertEqual(payload["normalizedIpa"], "")

    def test_evidence_json_passes_contract(self) -> None:
        from wiktionary_per_word import contracts
        from wiktionary_per_word.contract_adapter import evidence_to_contract

        observations = extract_observations(english_html()).observations
        evidence = evidence_module_build(observations)
        payload = evidence_to_contract(evidence)
        # 语言等价映射、request/render 取自内部证据、来源 metadata 不丢。
        self.assertEqual(payload["language"], "en")
        self.assertEqual(payload["requestVersion"], evidence.request_version)
        self.assertEqual(payload["renderVersion"], evidence.render_version)
        self.assertEqual(payload["pageUrl"], evidence.page_url)
        self.assertEqual(payload["historyUrl"], evidence.history_url)
        self.assertEqual(payload["revision"], str(evidence.revid))
        self.assertEqual(payload["cacheRef"], evidence.cache_sha256)
        self.assertEqual(payload["license"]["spdx"], "CC-BY-SA-4.0")
        self.assertTrue(payload["license"]["shareAlike"])
        issues: list[str] = []
        contracts.validate_source_evidence(payload, "evidence", issues)
        self.assertEqual(issues, [], f"evidence 未通过合同校验: {issues}")

    def test_observation_language_scope_matches_top_level(self) -> None:
        import dataclasses

        from wiktionary_per_word.contract_adapter import observation_to_contract
        from wiktionary_per_word.html_extract import Observation
        from wiktionary_per_word.scope_model import Applicability, Scope

        base = extract_observations(
            '<ul><li><span class="IPA">/x/</span></li></ul>'
        ).observations[0]
        original_scope = base.applicability.to_json()

        def build(scope: Scope) -> Observation:
            applicability: Applicability = dataclasses.replace(
                base.applicability, language=scope
            )
            return dataclasses.replace(base, applicability=applicability)

        def to_payload(scope: Scope) -> dict:
            return observation_to_contract(
                build(scope),
                observation_id="obs:1",
                evidence_id="ev:1",
                source_spelling="x",
            )

        # known 单值：顶层 en 与 scope known en 一致。
        single = to_payload(Scope.known(["English"]))
        self.assertEqual(single["language"], "en")
        self.assertEqual(single["applicability"]["language"], {"kind": "known", "values": ["en"]})

        # known 多值：逐值映射，未知语言原样保留。
        multi = to_payload(Scope.known(["English", "French"]))
        self.assertEqual(
            multi["applicability"]["language"],
            {"kind": "known", "values": ["en", "French"]},
        )

        # unknown / explicit-all 原义保留，不改写、不升为通配。
        unknown = to_payload(Scope.unknown("lang-unknown"))
        self.assertEqual(
            unknown["applicability"]["language"],
            {"kind": "unknown", "reason": "lang-unknown"},
        )
        explicit = to_payload(Scope.explicit_all("ev:lang"))
        self.assertEqual(
            explicit["applicability"]["language"],
            {"kind": "explicit-all", "evidence": ["ev:lang"]},
        )

        # 不 mutate 内部 model：原观测 applicability 不变。
        self.assertEqual(base.applicability.to_json(), original_scope)
        self.assertEqual(
            build(Scope.known(["English"])).applicability.language.values, ("English",)
        )

    def test_evidence_strict_validation_and_change_notice(self) -> None:
        import dataclasses

        from wiktionary_per_word.contract_adapter import (
            CHANGE_NOTICE_FIRST_EXTRACTION,
            evidence_to_contract,
        )

        observations = extract_observations(english_html()).observations
        evidence = evidence_module_build(observations)

        # status=extracted 且无 change_note：显式首轮提取语义（非无声泛化补）。
        payload = evidence_to_contract(evidence)
        self.assertEqual(payload["license"]["changeNotice"], CHANGE_NOTICE_FIRST_EXTRACTION)

        # 显式 change_note 优先。
        noted = evidence_to_contract(dataclasses.replace(evidence, change_note="重新渲染"))
        self.assertEqual(noted["license"]["changeNotice"], "重新渲染")

        # 无 change_note 且非首次提取语义：fail closed，不伪造。
        non_first = dataclasses.replace(evidence, status="revalidated")
        with self.assertRaises(ValueError):
            evidence_to_contract(non_first)

        # 手工非法内部证据：错误许可 / 空白归因 / 假许可 URL 均拒，不伪成 CC4。
        for broken in (
            dataclasses.replace(evidence, license_id="MIT"),
            dataclasses.replace(evidence, license_id=""),
            dataclasses.replace(evidence, attribution="   "),
            dataclasses.replace(evidence, license_url="https://evil.example/license"),
            dataclasses.replace(evidence, request_version=""),
        ):
            with self.assertRaises(ValueError):
                evidence_to_contract(broken)

        # 合法内部证据保留 request/render/cache/revision/source raw。
        self.assertEqual(payload["requestVersion"], evidence.request_version)
        self.assertEqual(payload["renderVersion"], evidence.render_version)
        self.assertEqual(payload["cacheRef"], evidence.cache_sha256)
        self.assertEqual(payload["revision"], str(evidence.revid))
        self.assertEqual(payload["license"]["url"], evidence.license_url)
        self.assertEqual(payload["license"]["attribution"], evidence.attribution)

    def test_completeness_control_categories_not_complete(self) -> None:
        from wiktionary_per_word.contract_adapter import (
            completeness_to_contract,
            observation_to_contract,
        )

        cases = {
            '<ul><li><span class="IPA">/x\u007f/</span></li></ul>': "control-character",  # DEL (Cc)
            '<ul><li><span class="IPA">/x\u200b/</span></li></ul>': "control-character",  # ZWSP (Cf)
            '<ul><li><span class="IPA">/x]/</span></li></ul>': "fragment",  # parser 拒读法
            '<ul><li><span class="IPA"></span></li></ul>': "empty",
            '<span class="IPA">/x': "truncated",
        }
        for html, expected in cases.items():
            observation = extract_observations(html).observations[0]
            self.assertEqual(completeness_to_contract(observation), expected, html)
            payload = observation_to_contract(
                observation,
                observation_id="obs:1",
                evidence_id="ev:1",
                source_spelling="x",
            )
            # 被 parser 判拒的读法绝不当 complete；raw 原值不改。
            if not observation.complete:
                self.assertNotEqual(payload["completeness"], "complete")
            self.assertEqual(payload["rawIpa"], observation.raw_ipa)

    def test_checkpoint_projection_does_not_mutate_and_conservative(self) -> None:
        from wiktionary_per_word.contract_adapter import checkpoint_to_contract

        ledger = make_ledger()
        ledger.start_word("read")
        ledger.finish_word("read", WordStatus.EXTRACTED)
        ledger.mark_paused("mystery-pause", "unrecognized")
        before = ledger.checkpoint.to_json()
        payload = checkpoint_to_contract(ledger.checkpoint)
        # projection 只读，不 mutate 完整 checkpoint。
        self.assertEqual(ledger.checkpoint.to_json(), before)
        # 未知 pause reason 保守映射为 other，绝不解禁（不省略为 None）。
        self.assertEqual(payload["pauseReason"], "other")
        self.assertEqual(ledger.checkpoint.pause_reason, "mystery-pause")
        # 未传入证据时省略 lastCompletionEvidence。
        self.assertNotIn("lastCompletionEvidence", payload)
        # 无暂停时省略 pauseReason（fresh ledger）。
        fresh = make_ledger()
        self.assertNotIn("pauseReason", checkpoint_to_contract(fresh.checkpoint))

    def test_checkpoint_json_passes_contract(self) -> None:
        from wiktionary_per_word import contracts
        from wiktionary_per_word.contract_adapter import checkpoint_to_contract

        ledger = make_ledger()
        ledger.start_word("read")
        ledger.finish_word("read", WordStatus.EXTRACTED)
        ledger.mark_paused("distinct-head-budget", "reached")
        payload = checkpoint_to_contract(ledger.checkpoint)
        # 可选字段无值时省略键，不写 null。
        self.assertNotIn("lastCompletionEvidence", payload)
        self.assertEqual(payload["pauseReason"], "head-limit")
        issues: list[str] = []
        contracts.validate_checkpoint(payload, "checkpoint", issues)
        self.assertEqual(issues, [], f"checkpoint 未通过合同校验: {issues}")


def evidence_module_build(observations):
    from wiktionary_per_word.offline_reparse import build_source_evidence

    return build_source_evidence(
        word="read",
        page_url="https://en.wiktionary.org/wiki/read",
        history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
        revid=42,
        fetched_at="2026-01-01T00:00:00Z",
        body=english_html().encode(),
        observations=observations,
    )


if __name__ == "__main__":
    unittest.main()
