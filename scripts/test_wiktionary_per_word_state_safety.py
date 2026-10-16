#!/usr/bin/env python3
"""状态机 / 请求级持久协议 **安全负例** 离线 unittest（oracle 7 问题）。

本文件专门针对 oracle 实测的 7 个问题补负例与正向端到端，证明既有 77 项通过
**不**等价于安全：

- P0-1 预置 QUEUED（started=False）绕预算：统一 started=False 配额检查 + 持久占额；
  ``finish_word`` 拒绝不存在 / 未 started / 非 in-flight（绝不凭空造 started 终态）。
- P0-2 transport 已知零消费与“未知消费”严格区分：未知立即 durable 暂停 + 抛、
  禁止重试；known-zero 才允许有限重试；请求序号 id 匹配，暂停拒 dispatch。
- P1-3 ``http.client.IncompleteRead`` 等普通 read 异常：保留已知 bytes、持久、
  uncertain 暂停、不重试；close 抛 OSError 也不抢 accounted。
- P1-4 恢复 skip 终态：40 heads / 8 MiB 经 run_apply load/resume/run_batch 端到端
  不重抓、41 继续且费用不 reset。
- P1-5 action_api 各层 strict 结构：``[]``/``null``/``str``/sections 非 list
  等 → ActionApiError → FAILED 收尾，不假 MISSING。
- P1-6 ``unsupported-encoding`` / ``incomplete-response`` durable 暂停；新 adapter
  不得在未清 active 时覆盖。
- P2-7 HTTP 200 ``maxlag``：API 重试在 sleep/dispatch 前持久，HTTP+API 共享
  retry 额度、有限受预算。

全部 offline、synthetic、zero network、zero 新依赖。
"""

from __future__ import annotations

import http.client
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    REAL_LOOKING_UA,
    SYNTHETIC_UA,
    ChunkStream,
    ScriptedTransport,
    english_html,
    fixed_now,
    gzip_bytes,
    plain_response,
    text_payload,
    tocdata_payload,
)

import refresh_wiktionary_pronunciations as cli  # noqa: E402
from wiktionary_per_word import action_api, collector as collector_module  # noqa: E402
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache  # noqa: E402
from wiktionary_per_word.http_adapter import (  # noqa: E402
    BudgetPaused,
    FakeClock,
    FakeResponse,
    HttpAdapter,
    KnownZeroTransportError,
    RequestKind,
    RunBudget,
    TransportError,
)
from wiktionary_per_word.ledger import (  # noqa: E402
    BatchAuthorization,
    BatchCheckpoint,
    BatchLedger,
    CheckpointInvariantError,
    ResumeRejected,
    WordEntry,
    WordStatus,
)

NOW = "2026-01-01T00:00:00Z"
MULTI_LANG = [
    {"toclevel": 1, "level": "2", "line": "German", "number": "1"},
    {"toclevel": 1, "level": "2", "line": "English", "number": "2"},
]


def authorization(heads: int = 100, mib: float = 20.0, *, synthetic: bool = True) -> BatchAuthorization:
    return BatchAuthorization(
        distinct_heads=heads,
        decompressed_bytes=int(mib * 1024 * 1024),
        granted=True,
        source="state-safety-test-grant",
        synthetic=synthetic,
    )


def make_ledger(path: Path | None = None, *, heads: int = 100, mib: float = 20.0) -> BatchLedger:
    return BatchLedger.create(
        batch_id="state-safety",
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


def make_collector(ledger: BatchLedger, adapter: HttpAdapter):
    return collector_module.Collector(
        ledger=ledger,
        adapter=adapter,
        cache=ResponseCache(),
        evidence_ledger=EvidenceLedger(),
        now=fixed_now(),
    )


def read_checkpoint(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class PartialThenRaise:
    """先返回确定的部分 bytes，随后抛普通 read 异常（含 IncompleteRead）。"""

    def __init__(self, first: bytes, error: BaseException) -> None:
        self.first = first
        self.error = error
        self.served = False
        self.closed = False

    def read(self, size: int) -> bytes:
        if not self.served:
            self.served = True
            return self.first
        raise self.error

    def close(self) -> None:
        self.closed = True


class CloseBoomResponse:
    """read 返回部分 bytes 后抛异常，且 close 再抛 OSError。"""

    def __init__(self, reader) -> None:
        self.status = 200
        self.headers = {"Content-Type": "text/html"}
        self.reader = reader
        self.closed = False

    def read(self, size: int) -> bytes:
        return self.reader(size)

    def close(self) -> None:
        self.closed = True
        raise OSError("close boom after mid-read")


# ---------------------------------------------------------------------------
# P0-1 预置队列绕预算 / finish_word 严格
# ---------------------------------------------------------------------------
class PresetQueuedBudgetTest(unittest.TestCase):
    def _preset(self, heads: int = 2) -> tuple[BatchLedger, Path, tempfile.TemporaryDirectory]:
        tmp = tempfile.TemporaryDirectory()
        path = Path(tmp.name) / "cp.json"
        ledger = make_ledger(path, heads=heads, mib=1)
        # 预置队列：词已在 words 中但 started=False（未占额）。
        for index in range(heads):
            ledger.checkpoint.words[f"q{index}"] = WordEntry(
                head=f"q{index}", status=WordStatus.QUEUED
            )
        ledger.persist()
        return ledger, path, tmp

    def test_preset_queued_words_preclaim_on_start(self) -> None:
        _, path, tmp = self._preset(2)
        self.addCleanup(tmp.cleanup)
        reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
        reloaded.resume()
        # 修复前：预置 QUEUED 只改 IN_FLIGHT，distinct 计数保持 0（绕预算）。
        reloaded.start_word("q0")
        self.assertEqual(reloaded.budget.distinct_heads_started, 1)
        self.assertTrue(reloaded.checkpoint.words["q0"].started)
        reloaded.start_word("q1")
        self.assertEqual(reloaded.budget.distinct_heads_started, 2)
        # 第 N+1 个预置词：配额已满，拒绝且持久暂停。
        with self.assertRaises(ResumeRejected):
            reloaded.start_word("q2")
        self.assertEqual(reloaded.checkpoint.pause_reason, "distinct-head-budget")
        self.assertEqual(reloaded.budget.distinct_heads_started, 2)
        self.assertNotIn("q2", reloaded.checkpoint.words)

    def test_preset_queued_preclaim_is_persisted_before_request(self) -> None:
        _, path, tmp = self._preset(3)
        self.addCleanup(tmp.cleanup)
        reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
        reloaded.resume()
        reloaded.start_word("q0")
        payload = read_checkpoint(path)
        self.assertEqual(payload["budget"]["distinct_heads_started"], 1)
        self.assertEqual(payload["words"]["q0"]["status"], WordStatus.IN_FLIGHT.value)
        self.assertTrue(payload["words"]["q0"]["started"])

    def test_finish_word_rejects_unknown_and_never_creates_started(self) -> None:
        ledger = make_ledger(heads=5)
        with self.assertRaises(CheckpointInvariantError):
            ledger.finish_word("ghost", WordStatus.EXTRACTED)
        # 绝不凭空创建 started 条目、绝不增加计数。
        self.assertNotIn("ghost", ledger.checkpoint.words)
        self.assertEqual(ledger.budget.distinct_heads_started, 0)

    def test_finish_word_rejects_not_started_queued(self) -> None:
        ledger = make_ledger(heads=5)
        ledger.checkpoint.words["queued"] = WordEntry(
            head="queued", status=WordStatus.QUEUED
        )
        with self.assertRaises(CheckpointInvariantError):
            ledger.finish_word("queued", WordStatus.MISSING)

    def test_finish_word_rejects_non_inflight(self) -> None:
        ledger = make_ledger(heads=5)
        ledger.start_word("a")
        ledger.finish_word("a", WordStatus.EXTRACTED)
        with self.assertRaises(CheckpointInvariantError):
            ledger.finish_word("a", WordStatus.FAILED)

    def test_terminal_without_started_rejected_on_load(self) -> None:
        ledger = make_ledger(heads=5)
        payload = ledger.checkpoint.to_json()
        payload["words"]["bad"] = {
            "head": "bad",
            "status": WordStatus.EXTRACTED.value,
            "attempts": 1,
            "started": False,
            "note": None,
            "evidenceIds": [],
        }
        with self.assertRaises(CheckpointInvariantError):
            BatchCheckpoint.from_json(payload)


# ---------------------------------------------------------------------------
# P0-2 transport 已知零 vs 未知消费
# ---------------------------------------------------------------------------
class TransportConsumptionTest(unittest.TestCase):
    def test_known_zero_transport_error_retries_without_uncertain(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            calls = {"n": 0}

            def transport(url, headers):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise KnownZeroTransportError("connection refused")
                return plain_response(b"{}")

            adapter = make_adapter(transport, ledger, max_retries=1)
            result = adapter.fetch(
                "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
            )
            self.assertTrue(result.retried)
            self.assertEqual(calls["n"], 2)
            # known-zero：绝不标 uncertain，且 in-flight 已结算清理。
            self.assertFalse(adapter.consumption_uncertain)
            self.assertIsNone(read_checkpoint(path)["activeRequest"])
            self.assertEqual(ledger.budget.retry_count, 1)

    def test_unknown_dispatch_exception_pauses_and_never_retries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            calls = {"n": 0}

            def transport(url, headers):
                calls["n"] += 1
                raise RuntimeError("unknown transport failure")

            adapter = make_adapter(transport, ledger, max_retries=3)
            with self.assertRaises(TransportError):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            # 未知消费：立即 durable 暂停 + 抛，禁止重试（只 dispatch 一次）。
            self.assertEqual(calls["n"], 1)
            self.assertEqual(adapter.pause_reason, "consumption-uncertain")
            self.assertTrue(adapter.consumption_uncertain)
            payload = read_checkpoint(path)
            self.assertEqual(payload["pauseReason"], "consumption-uncertain")
            self.assertTrue(payload["activeRequest"]["uncertain"])

    def test_request_started_rejects_unsettled_active(self) -> None:
        ledger = make_ledger()
        ledger.checkpoint.active_request = {
            "id": 1,
            "head": "old",
            "kind": "main",
            "settled": False,
            "uncertain": False,
        }
        with self.assertRaises(ResumeRejected):
            ledger.request_started(head="new", kind=RequestKind.TOC)

    def test_request_started_allows_settled_active(self) -> None:
        ledger = make_ledger()
        ledger.checkpoint.active_request = {
            "id": 1,
            "head": "old",
            "kind": "main",
            "settled": True,
            "uncertain": False,
        }
        new_id = ledger.request_started(head="new", kind=RequestKind.TOC)
        self.assertEqual(new_id, ledger.checkpoint.request_seq)
        self.assertEqual(ledger.checkpoint.active_request["head"], "new")

    def test_accounted_id_mismatch_rejected(self) -> None:
        ledger = make_ledger()
        request_id = ledger.request_started(head="h", kind=RequestKind.MAIN)
        with self.assertRaises(CheckpointInvariantError):
            ledger.request_accounted(
                head="h",
                kind=RequestKind.MAIN,
                network_bytes=0,
                decompressed_bytes=0,
                complete=True,
                uncertain=False,
                request_id=request_id + 99,
            )

    def test_request_started_rejected_when_paused(self) -> None:
        ledger = make_ledger()
        ledger.mark_paused("unsupported-encoding", "test")
        with self.assertRaises(ResumeRejected):
            ledger.request_started(head="h", kind=RequestKind.MAIN)


# ---------------------------------------------------------------------------
# P1-3 普通 read 异常 / close 失败
# ---------------------------------------------------------------------------
class ReadExceptionTest(unittest.TestCase):
    def test_incomplete_read_keeps_partial_bytes_and_pauses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            stream = PartialThenRaise(b"partial", http.client.IncompleteRead(b""))
            response = FakeResponse(
                status=200, headers={"Content-Type": "text/html"}, reader=stream.read
            )
            adapter = make_adapter(ScriptedTransport([response]), ledger)
            with self.assertRaises(BudgetPaused) as caught:
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            self.assertEqual(caught.exception.reason, "consumption-uncertain")
            self.assertTrue(response.closed)
            # 确定的部分 bytes 已计账、已持久，不重试。
            self.assertEqual(ledger.budget.decompressed_bytes, len(b"partial"))
            payload = read_checkpoint(path)
            self.assertEqual(payload["budget"]["decompressed_bytes"], len(b"partial"))
            self.assertEqual(payload["pauseReason"], "consumption-uncertain")
            self.assertTrue(payload["activeRequest"]["uncertain"])
            self.assertEqual(len(adapter._transport.calls), 1)

    def test_close_oserror_does_not_steal_accounting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            reader = PartialThenRaise(b"knownbytes", http.client.IncompleteRead(b"")).read
            response = CloseBoomResponse(reader)
            adapter = make_adapter(ScriptedTransport([response]), ledger)
            with self.assertRaises(BudgetPaused):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            # close 抛 OSError 不得抢 accounted：已知 bytes 仍持久，暂停为 uncertain。
            self.assertEqual(ledger.budget.decompressed_bytes, len(b"knownbytes"))
            payload = read_checkpoint(path)
            self.assertEqual(payload["pauseReason"], "consumption-uncertain")
            self.assertEqual(payload["budget"]["decompressed_bytes"], len(b"knownbytes"))
            self.assertTrue(adapter.last_close_error and "OSError" in adapter.last_close_error)

    def test_gzip_partial_incomplete_read_pauses_uncertain(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            # 先给一个完整 gzip member（已知解压 bytes），随后 read 抛
            # IncompleteRead：必须保留已知 bytes 并 uncertain 暂停。
            stream = PartialThenRaise(gzip_bytes(b"abc"), http.client.IncompleteRead(b""))
            response = FakeResponse(
                status=200,
                headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
                reader=stream.read,
            )
            adapter = make_adapter(ScriptedTransport([response]), ledger)
            with self.assertRaises(BudgetPaused):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            payload = read_checkpoint(path)
            self.assertEqual(payload["pauseReason"], "consumption-uncertain")
            self.assertEqual(ledger.budget.decompressed_bytes, len(b"abc"))
            self.assertEqual(
                payload["budget"]["decompressed_bytes"], len(b"abc")
            )
            self.assertGreater(ledger.budget.network_bytes, 0)


# ---------------------------------------------------------------------------
# P1-5 action_api strict 结构
# ---------------------------------------------------------------------------
class StrictJsonStructureTest(unittest.TestCase):
    def _collect(self, responses):
        ledger = make_ledger()
        adapter = make_adapter(ScriptedTransport(responses), ledger)
        return make_collector(ledger, adapter).collect_word("read"), ledger

    def test_non_mapping_root_fails_not_missing(self) -> None:
        for body in (b"[]", b"null", b'"str"', b"123"):
            entry, _ = self._collect([plain_response(body)])
            self.assertEqual(entry.status, WordStatus.FAILED, body)

    def test_tocdata_sections_not_list_fails(self) -> None:
        body = json.dumps({"parse": {"tocdata": {"sections": "nope"}}}).encode("utf-8")
        entry, _ = self._collect([plain_response(body)])
        self.assertEqual(entry.status, WordStatus.FAILED)

    def test_tocdata_missing_fails(self) -> None:
        body = json.dumps({"parse": {}}).encode("utf-8")
        entry, _ = self._collect([plain_response(body)])
        self.assertEqual(entry.status, WordStatus.FAILED)

    def test_text_parse_not_mapping_fails_not_missing(self) -> None:
        responses = [
            plain_response(tocdata_payload(MULTI_LANG)),
            plain_response(b"[]"),
        ]
        entry, ledger = self._collect(responses)
        self.assertEqual(entry.status, WordStatus.FAILED)
        self.assertIsNone(read_checkpoint_for(ledger))

    def test_direct_decode_rejects_non_mapping(self) -> None:
        from wiktionary_per_word.http_adapter import FetchedResponse

        response = FetchedResponse(
            url="u", kind=RequestKind.TOC, status=200, headers={}, body=b"[]",
            network_bytes=2, decompressed_bytes=2, attempts=1, retried=False,
        )
        with self.assertRaises(action_api.ActionApiError):
            action_api._decode_json(response)


def read_checkpoint_for(ledger: BatchLedger) -> dict | None:
    if ledger.path is None:
        return None
    return read_checkpoint(ledger.path)


# ---------------------------------------------------------------------------
# P1-6 durable pause / 不得覆盖未清 active
# ---------------------------------------------------------------------------
class DurablePauseTest(unittest.TestCase):
    def test_unsupported_encoding_pauses_durably_and_blocks_resume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            stream_response = FakeResponse(
                status=200,
                headers={"Content-Encoding": "br", "Content-Type": "text/html"},
                reader=PartialThenRaise(b"raw", OSError("x")).read,
            )
            adapter = make_adapter(ScriptedTransport([stream_response]), ledger)
            with self.assertRaises(BudgetPaused):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            payload = read_checkpoint(path)
            self.assertEqual(payload["pauseReason"], "unsupported-encoding")
            self.assertIsNotNone(payload["activeRequest"])
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()
            self.assertIn(
                reloaded.checkpoint.pause_reason,
                {"unsupported-encoding", "consumption-uncertain"},
            )

    def test_incomplete_response_pauses_durably_and_blocks_resume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            truncated = gzip_bytes(b"a" * 100)[:-4]  # 截断 trailer
            response = FakeResponse(
                status=200,
                headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
                reader=ChunkStream([truncated]).read,
            )
            adapter = make_adapter(ScriptedTransport([response]), ledger)
            with self.assertRaises(BudgetPaused):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            payload = read_checkpoint(path)
            self.assertEqual(payload["pauseReason"], "incomplete-response")
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()

    def test_new_adapter_cannot_dispatch_while_unsettled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            ledger.checkpoint.active_request = {
                "id": 7,
                "head": "old",
                "kind": "main",
                "settled": False,
                "uncertain": False,
            }
            adapter = make_adapter(ScriptedTransport([plain_response(b"{}")]), ledger)
            with self.assertRaises(Exception):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="new"
                )
            # 不得覆盖旧 active，仍指向旧 request。
            self.assertEqual(ledger.checkpoint.active_request["head"], "old")


# ---------------------------------------------------------------------------
# P1-4 恢复 skip 终态 + 端到端 run_apply
# ---------------------------------------------------------------------------
class ResumeSkipTerminalTest(unittest.TestCase):
    def test_run_batch_skips_terminal_heads(self) -> None:
        ledger = make_ledger(heads=100)
        adapter = make_adapter(
            ScriptedTransport([plain_response(b'{"error":{"code":"missingtitle"}}')]), ledger
        )
        instance = make_collector(ledger, adapter)
        # 预置终态词。
        ledger.start_word("done")
        ledger.finish_word("done", WordStatus.EXTRACTED)
        instance.run_batch(["done", "new"])
        # done 不重抓：transport 只对新词调用一次。
        self.assertEqual(len(adapter._transport.calls), 1)
        self.assertEqual(ledger.checkpoint.words["new"].status, WordStatus.MISSING)

    def test_run_apply_resume_e2e_no_refetch_and_41_continues(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "cp.json"
            cache_dir = root / "cache"
            auth = authorization(100, 20.0, synthetic=False)
            ledger = BatchLedger.create(
                batch_id="e2e",
                authorization=auth,
                path=path,
                created_at=NOW,
            )
            for index in range(40):
                ledger.start_word(f"w{index:03d}")
                ledger.finish_word(f"w{index:03d}", WordStatus.EXTRACTED)
            ledger.budget.decompressed_bytes = 8 * 1024 * 1024
            ledger.persist()

            heads_file = root / "heads.txt"
            heads_file.write_text(
                "\n".join(f"w{index:03d}" for index in range(41)) + "\n",
                encoding="utf-8",
            )
            transport = ScriptedTransport(
                [plain_response(b'{"error":{"code":"missingtitle"}}')]
            )
            config = cli.ApplyConfig(
                heads_file=heads_file,
                user_agent=REAL_LOOKING_UA,
                budget_heads=100,
                budget_decompressed_bytes=20 * 1024 * 1024,
                authorization=auth,
                interval_seconds=0.0,
                max_retries=2,
                checkpoint=path,
                cache_dir=cache_dir,
                endpoint=cli.DEFAULT_API_ENDPOINT,
            )
            with mock.patch.object(cli, "_build_urllib_transport", lambda: transport):
                cli.run_apply(config, now=fixed_now())

            # 40 个终态词不重抓：仅第 41 个（w040）抓取一次。
            self.assertEqual(len(transport.calls), 1)
            reloaded = BatchLedger.load(path)
            self.assertEqual(reloaded.budget.distinct_heads_started, 41)
            # 费用不 reset：8 MiB 累计保留并叠加新请求。
            self.assertGreaterEqual(reloaded.budget.decompressed_bytes, 8 * 1024 * 1024)

    def test_100th_completes_then_101st_stable_pause(self) -> None:
        ledger = make_ledger(heads=100)
        responses = [
            plain_response(b'{"error":{"code":"missingtitle"}}') for _ in range(99)
        ] + [
            plain_response(tocdata_payload(MULTI_LANG)),
            plain_response(text_payload(english_html())),
        ]
        adapter = make_adapter(ScriptedTransport(responses), ledger)
        instance = make_collector(ledger, adapter)
        heads = [f"word{index:03d}" for index in range(101)]
        report = instance.run_batch(heads)
        self.assertEqual(len(report.processed), 100)
        self.assertEqual(report.stopped_before, "word100")
        self.assertEqual(report.paused_reason, "distinct-head-budget")
        self.assertEqual(ledger.checkpoint.words["word099"].status, WordStatus.EXTRACTED)
        self.assertNotIn("word100", ledger.checkpoint.words)
        self.assertEqual(ledger.budget.distinct_heads_started, 100)


# ---------------------------------------------------------------------------
# P2-7 HTTP 200 maxlag 计账
# ---------------------------------------------------------------------------
class ApiRetryAccountingTest(unittest.TestCase):
    def test_maxlag_counts_retry_error_and_kind(self) -> None:
        ledger = make_ledger()
        responses = [
            plain_response(b'{"error":{"code":"maxlag"}}'),
            plain_response(b'{"error":{"code":"maxlag"}}'),
        ]
        adapter = make_adapter(ScriptedTransport(responses), ledger, max_retries=1)
        entry = make_collector(ledger, adapter).collect_word("read")
        self.assertEqual(entry.status, WordStatus.FAILED)
        self.assertEqual(ledger.budget.request_count, 2)
        # 修复前：HTTP 200 的 API 重试完全不计 retry/error。
        self.assertEqual(ledger.budget.retry_count, 1)
        self.assertEqual(ledger.budget.error_count, 2)
        # kind 保持 toc（每次重试仍走 tocdata）。
        self.assertEqual(ledger.budget.requests_by_kind.get("toc"), 2)

    def test_shared_retry_quota_between_http_and_api(self) -> None:
        # HTTP 传输已用掉一次 retry 后，API 重试额度应相应减少（防混合放大）。
        ledger = make_ledger()
        calls = {"n": 0}

        def transport(url, headers):
            calls["n"] += 1
            if calls["n"] == 1:
                raise KnownZeroTransportError("first down")
            return plain_response(b'{"error":{"code":"maxlag"}}')

        adapter = make_adapter(transport, ledger, max_retries=1)
        entry = make_collector(ledger, adapter).collect_word("read")
        self.assertEqual(entry.status, WordStatus.FAILED)
        # HTTP 1 次 retry 已用满共享额度：API 层不再额外重试。
        self.assertEqual(ledger.budget.retry_count, 1)
        self.assertEqual(calls["n"], 2)


if __name__ == "__main__":
    unittest.main()
