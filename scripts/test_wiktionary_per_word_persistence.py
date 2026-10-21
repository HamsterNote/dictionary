#!/usr/bin/env python3
"""持久账本 / 请求级持久协议 / 严格不变量 离线 unittest（问题 3/4/5/7/9）。

覆盖：
- create 拒绝覆盖已有 checkpoint；load 后未经 resume 不得 start_word/请求。
- 请求级持久：dispatch 前持久 attempt/category/in-flight；完整 response 持久
  bytes 后才解析（坏 JSON 也先计账再收尾）；读取中途失败持久 uncertain 并暂停。
- 崩溃模拟：请求前 / 读中 / 计账后 / clear 前各阶段持久状态可复核。
- 40 heads / 8 MiB 恢复不 reset；版本升级不 reset；触限暂停不可绕过。
- 第 100 词在 bytes 允许下完结，终态立即 pause；第 101 不开始、稳定 report。
- 严格不变量：授权额度精确、非负 int 非 bool、started 集合一致、触限有暂停态、
  请求分类基本一致；绝不修值/清零/取大。
- 结构性 API 错误 → FAILED 且不留 in-flight；仅真实 missing 码 → MISSING；
  maxlag 受限重试。
- journal 持久失败 fail closed。

全部 offline、synthetic、zero network。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    SYNTHETIC_UA,
    ScriptedTransport,
    english_html,
    fixed_now,
    plain_response,
    text_payload,
    tocdata_payload,
)

from wiktionary_per_word import action_api, collector as collector_module  # noqa: E402
from wiktionary_per_word.action_api import ActionApiError  # noqa: E402
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache  # noqa: E402
from wiktionary_per_word.http_adapter import (  # noqa: E402
    BudgetPaused,
    FakeClock,
    FakeResponse,
    HttpAdapter,
    JournalError,
    RequestKind,
    RunBudget,
    TransportError,
)
from wiktionary_per_word.ledger import (  # noqa: E402
    AuthorizationError,
    BatchAuthorization,
    BatchCheckpoint,
    BatchLedger,
    CheckpointInvariantError,
    ResumeRejected,
    VersionMismatch,
    WordStatus,
)

NOW = "2026-01-01T00:00:00Z"
MULTI_LANG = [
    {"tocLevel": 1, "hLevel": 2, "line": "German", "number": "1", "index": "1"},
    {"tocLevel": 1, "hLevel": 2, "line": "English", "number": "2", "index": "2"},
]


def authorization(heads: int = 100, mib: float = 20.0) -> BatchAuthorization:
    return BatchAuthorization(
        distinct_heads=heads,
        decompressed_bytes=int(mib * 1024 * 1024),
        granted=True,
        source="unit-test-grant",
        synthetic=True,
    )


def make_ledger(path: Path | None = None, *, heads: int = 100, mib: float = 20.0) -> BatchLedger:
    return BatchLedger.create(
        batch_id="persistence-batch",
        authorization=authorization(heads, mib),
        path=path,
        created_at=NOW,
        allow_synthetic_authorization=True,
    )


def make_adapter(transport, ledger: BatchLedger, *, clock=None, max_retries=2) -> HttpAdapter:
    return HttpAdapter(
        transport=transport,
        budget=ledger.budget,
        clock=clock or FakeClock(),
        user_agent=SYNTHETIC_UA,
        allow_synthetic_user_agent=True,
        interval_seconds=0.0,
        max_retries=max_retries,
        journal=ledger,
    )


def read_checkpoint(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class _MidFailStream:
    def __init__(self, first: bytes, error: BaseException) -> None:
        self.first = first
        self.error = error
        self.served = False

    def read(self, size: int) -> bytes:
        if not self.served:
            self.served = True
            return self.first
        raise self.error

    def close(self) -> None:
        pass


class RequestPersistenceTest(unittest.TestCase):
    def test_request_started_persisted_before_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            captured: dict = {}

            def transport(url, headers):
                captured["active"] = read_checkpoint(path)["activeRequest"]
                return plain_response(b"{}")

            adapter = make_adapter(transport, ledger)
            adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.TOC, head="read")
            # dispatch 前已持久 attempt/category/in-flight。
            self.assertIsNotNone(captured["active"])
            self.assertEqual(captured["active"]["kind"], "toc")
            self.assertEqual(captured["active"]["head"], "read")
            # 完整 response 持久后已清理。
            self.assertIsNone(read_checkpoint(path)["activeRequest"])

    def test_complete_response_accounted_before_parse(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            # 坏 JSON：解析失败，但 bytes 必须已持久计账、in-flight 已清。
            adapter = make_adapter(ScriptedTransport([plain_response(b"not-json")]), ledger)
            with self.assertRaises(ActionApiError):
                action_api.fetch_english_page(adapter, "read")
            payload = read_checkpoint(path)
            self.assertIsNone(payload["activeRequest"])
            self.assertGreater(payload["budget"]["network_bytes"], 0)

    def test_reader_failure_persists_uncertain_and_pauses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            stream = _MidFailStream(b"knownbytes", TransportError("boom"))
            response = FakeResponse(
                status=200, headers={"Content-Type": "text/html"}, reader=stream.read
            )
            adapter = make_adapter(ScriptedTransport([response]), ledger)
            with self.assertRaises(BudgetPaused):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read")
            payload = read_checkpoint(path)
            self.assertTrue(payload["activeRequest"]["uncertain"])
            self.assertEqual(payload["pauseReason"], "consumption-uncertain")
            self.assertEqual(payload["budget"]["decompressed_bytes"], len(b"knownbytes"))

    def test_crash_before_clear_blocks_resume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            # 模拟：请求已 started 持久，进程崩溃于 accounted/clear 之前。
            ledger.checkpoint.active_request = {"head": "read", "kind": "main", "uncertain": False}
            ledger.persist()
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()
            self.assertEqual(reloaded.checkpoint.pause_reason, "consumption-uncertain")

    def test_journal_persist_failure_fails_closed(self) -> None:
        class FailingJournal:
            def request_started(self, *, head, kind):  # noqa: D401
                return None

            def request_accounted(self, **kwargs):  # noqa: D401
                raise RuntimeError("disk full")

        response = plain_response(b"{}")
        adapter = HttpAdapter(
            transport=ScriptedTransport([response]),
            budget=RunBudget(max_decompressed_bytes=1024 * 1024),
            clock=FakeClock(),
            user_agent=SYNTHETIC_UA,
            allow_synthetic_user_agent=True,
            journal=FailingJournal(),
        )
        with self.assertRaises(JournalError):
            adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.TOC, head="read")
        self.assertEqual(adapter.pause_reason, "journal-persist-failed")
        self.assertTrue(response.closed)


class ResumeGateTest(unittest.TestCase):
    def test_load_without_resume_cannot_start_or_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            ledger.start_word("alpha")
            ledger.finish_word("alpha", WordStatus.EXTRACTED)
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.start_word("beta")
            with self.assertRaises(ResumeRejected):
                reloaded.assert_can_request()

    def test_resume_40_heads_8mib_no_reset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            for index in range(40):
                head = f"w{index:03d}"
                ledger.start_word(head)
                ledger.finish_word(head, WordStatus.EXTRACTED)
            ledger.budget.decompressed_bytes = 8 * 1024 * 1024
            ledger.persist()

            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            reloaded.resume()
            self.assertEqual(reloaded.budget.distinct_heads_started, 40)
            self.assertEqual(reloaded.budget.decompressed_bytes, 8 * 1024 * 1024)
            reloaded.start_word("w040")
            self.assertEqual(reloaded.budget.distinct_heads_started, 41)

    def test_budget_limit_pause_resume_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            ledger.budget.decompressed_bytes = ledger.budget.max_decompressed_bytes
            with self.assertRaises(ResumeRejected):
                ledger.assert_can_request()
            self.assertEqual(ledger.checkpoint.pause_reason, "decompressed-budget-exhausted")
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()

    def test_version_upgrade_does_not_reset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            ledger.start_word("alpha")
            ledger.finish_word("alpha", WordStatus.EXTRACTED)
            before = read_checkpoint(path)
            with self.assertRaises(VersionMismatch):
                BatchLedger.load(path, allow_synthetic_authorization=True, expected_schema="schema/999")
            after = read_checkpoint(path)
            self.assertEqual(
                after["budget"]["distinct_heads_started"],
                before["budget"]["distinct_heads_started"],
            )
            self.assertEqual(after["budget"]["decompressed_bytes"], before["budget"]["decompressed_bytes"])

    def test_create_rejects_existing_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            make_ledger(path)
            with self.assertRaises(AuthorizationError):
                make_ledger(path)


class HeadLimitTest(unittest.TestCase):
    def test_hundredth_completes_then_pauses_and_101st_not_started(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path, heads=100)
            responses = [
                plain_response(b'{"error":{"code":"missingtitle"}}') for _ in range(100)
            ]
            adapter = make_adapter(ScriptedTransport(responses), ledger)
            collector_instance = collector_module.Collector(
                ledger=ledger, adapter=adapter, cache=ResponseCache(),
                evidence_ledger=EvidenceLedger(), now=fixed_now(),
            )
            heads = [f"word{index:03d}" for index in range(101)]
            report = collector_instance.run_batch(heads)
            self.assertEqual(len(report.processed), 100)
            self.assertEqual(report.stopped_before, "word100")
            self.assertEqual(report.paused_reason, "distinct-head-budget")
            self.assertEqual(ledger.budget.distinct_heads_started, 100)
            self.assertNotIn("word100", ledger.checkpoint.words)
            # 终态立即 pause，之后不得请求旧词。
            with self.assertRaises(ResumeRejected):
                ledger.start_word("word000")

    def test_100th_necessary_requests_finish_then_pause(self) -> None:
        # 第 100 词的必要 TOC/MAIN 在 bytes 允许下可完结，随后立即 pause。
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path, heads=100)
            responses = [
                plain_response(b'{"error":{"code":"missingtitle"}}') for _ in range(99)
            ] + [
                plain_response(tocdata_payload(MULTI_LANG)),
                plain_response(text_payload(english_html())),
            ]
            adapter = make_adapter(ScriptedTransport(responses), ledger)
            collector_instance = collector_module.Collector(
                ledger=ledger, adapter=adapter, cache=ResponseCache(),
                evidence_ledger=EvidenceLedger(), now=fixed_now(),
            )
            heads = [f"word{index:03d}" for index in range(100)]
            report = collector_instance.run_batch(heads)
            self.assertEqual(len(report.processed), 100)
            self.assertEqual(ledger.checkpoint.words["word099"].status, WordStatus.EXTRACTED)
            self.assertEqual(report.paused_reason, "distinct-head-budget")
            self.assertEqual(ledger.budget.distinct_heads_started, 100)


class ApiErrorTest(unittest.TestCase):
    def _collect(self, responses, ledger):
        adapter = make_adapter(ScriptedTransport(responses), ledger)
        instance = collector_module.Collector(
            ledger=ledger, adapter=adapter, cache=ResponseCache(),
            evidence_ledger=EvidenceLedger(), now=fixed_now(),
        )
        return instance.collect_word("read"), ledger

    def test_structural_error_finishes_failed_without_inflight(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            entry, _ = self._collect([plain_response(b"not-json")], ledger)
            self.assertEqual(entry.status, WordStatus.FAILED)
            payload = read_checkpoint(path)
            self.assertIsNone(payload["activeRequest"])
            self.assertNotEqual(payload["words"]["read"]["status"], "in-flight")

    def test_missing_title_maps_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            entry, _ = self._collect([plain_response(b'{"error":{"code":"missingtitle"}}')], ledger)
            self.assertEqual(entry.status, WordStatus.MISSING)

    def test_retriable_api_error_bounded_retries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            responses = [
                plain_response(b'{"error":{"code":"maxlag"}}'),
                plain_response(b'{"error":{"code":"maxlag"}}'),
            ]
            adapter = make_adapter(ScriptedTransport(responses), ledger, max_retries=1)
            instance = collector_module.Collector(
                ledger=ledger, adapter=adapter, cache=ResponseCache(),
                evidence_ledger=EvidenceLedger(), now=fixed_now(),
            )
            entry = instance.collect_word("read")
            self.assertEqual(entry.status, WordStatus.FAILED)
            self.assertEqual(ledger.budget.request_count, 2)


class InvariantTest(unittest.TestCase):
    def _valid_payload(self) -> dict:
        ledger = make_ledger(heads=100, mib=20.0)
        return ledger.checkpoint.to_json()

    def _assert_invalid(self, payload: dict) -> None:
        with self.assertRaises(CheckpointInvariantError):
            BatchCheckpoint.from_json(payload)

    def test_valid_roundtrip(self) -> None:
        BatchCheckpoint.from_json(self._valid_payload())

    def test_budget_must_equal_authorization(self) -> None:
        payload = self._valid_payload()
        payload["budget"]["max_decompressed_bytes"] += 1
        self._assert_invalid(payload)

    def test_bool_counter_rejected(self) -> None:
        payload = self._valid_payload()
        payload["budget"]["request_count"] = True
        self._assert_invalid(payload)

    def test_negative_counter_rejected(self) -> None:
        payload = self._valid_payload()
        payload["budget"]["decompressed_bytes"] = -1
        self._assert_invalid(payload)

    def test_started_set_mismatch_rejected(self) -> None:
        payload = self._valid_payload()
        payload["budget"]["distinct_heads_started"] = 1
        self._assert_invalid(payload)

    def test_usage_at_limit_without_pause_rejected(self) -> None:
        payload = self._valid_payload()
        payload["budget"]["decompressed_bytes"] = payload["budget"]["max_decompressed_bytes"]
        payload["pauseReason"] = None
        self._assert_invalid(payload)

    def test_category_sum_exceeds_requests_rejected(self) -> None:
        payload = self._valid_payload()
        payload["budget"]["requests_by_kind"] = {"main": 5}
        payload["budget"]["request_count"] = 0
        self._assert_invalid(payload)


if __name__ == "__main__":
    unittest.main()
