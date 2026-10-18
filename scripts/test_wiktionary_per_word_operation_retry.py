#!/usr/bin/env python3
"""logical operation 重试额度 / known-zero / NoRedirect 决定性离线 unittest。

对应 oracle 本轮两项终态拒绝 + retry limiter 修正：

1. 泛化 ``TransportError`` = 消费不确定：**只 dispatch 一次** + durable pause，
   不重试；只有显式 ``KnownZeroTransportError`` 才允许有限重试。
2. CLI transport 用私有 opener + NoRedirect：3xx 不自动 follow，作为**单个**响应
   完整有界读取/计账后失败。
3. logical operation 重试额度 {batchId,head,wordAttempt,kind}：HTTP 与 API 共享
   同一 operation 上限；两词各自独立、全批累计只作审计；TOC/MAIN 各自循环，
   MAIN 错误绝不重跑 TOC；claim 在 sleep/dispatch 前持久，崩溃/持久失败无免费重试。

全部 offline、synthetic、zero network、zero 新依赖。
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    ChunkStream,
    ScriptedTransport,
    SYNTHETIC_UA,
    english_html,
    fixed_now,
    plain_response,
    text_payload,
    tocdata_payload,
)

import refresh_wiktionary_pronunciations as cli  # noqa: E402
from wiktionary_per_word import collector as collector_module  # noqa: E402
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
    BatchLedger,
    RetryBudgetExhausted,
    WordStatus,
)

NOW = "2026-01-01T00:00:00Z"
MULTI_LANG = [
    {"toclevel": 1, "level": "2", "line": "German", "number": "1"},
    {"toclevel": 1, "level": "2", "line": "English", "number": "2"},
]


def authorization(heads: int = 100, mib: float = 20.0) -> BatchAuthorization:
    return BatchAuthorization(
        distinct_heads=heads,
        decompressed_bytes=int(mib * 1024 * 1024),
        granted=True,
        source="operation-retry-test-grant",
        synthetic=True,
    )


def make_ledger(path: Path | None = None, *, heads: int = 100, retry_limit: int = 2) -> BatchLedger:
    return BatchLedger.create(
        batch_id="op-retry",
        authorization=authorization(heads),
        path=path,
        created_at=NOW,
        allow_synthetic_authorization=True,
        retry_limit=retry_limit,
    )


def make_adapter(transport, ledger: BatchLedger, *, max_retries: int = 2, clock=None) -> HttpAdapter:
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


class KnownZeroVsUnknownTest(unittest.TestCase):
    def test_generic_transport_error_single_dispatch_and_durable_pause(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            calls = {"n": 0}

            def transport(url, headers):
                calls["n"] += 1
                raise TransportError("unknown transport failure")

            adapter = make_adapter(transport, ledger, max_retries=3)
            with self.assertRaises(TransportError):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.TOC, head="read"
                )
            # 泛化异常 = 消费不确定：只 dispatch 一次、durable pause、绝不重试。
            self.assertEqual(calls["n"], 1)
            self.assertEqual(adapter.pause_reason, "consumption-uncertain")
            self.assertEqual(ledger.budget.retry_count, 0)
            self.assertEqual(ledger.checkpoint.operations, {})
            active = ledger.checkpoint.active_request
            self.assertIsNotNone(active)
            self.assertTrue(active["uncertain"])

    def test_explicit_known_zero_can_retry_once_and_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path, retry_limit=1)
            calls = {"n": 0}

            def transport(url, headers):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise KnownZeroTransportError("connection refused")
                return plain_response(b"{}")

            adapter = make_adapter(transport, ledger, max_retries=1)
            result = adapter.fetch(
                "https://en.wiktionary.org/w/api.php", kind=RequestKind.TOC, head="read"
            )
            self.assertEqual(result.body, b"{}")
            self.assertEqual(calls["n"], 2)
            self.assertEqual(ledger.budget.retry_count, 1)
            self.assertEqual(len(ledger.checkpoint.operations), 1)
            operation = next(iter(ledger.checkpoint.operations.values()))
            self.assertEqual(operation["retries"], 1)
            self.assertEqual(operation["kind"], "toc")
            self.assertIsNone(ledger.checkpoint.active_request)

    def test_no_redirect_handler_refuses_follow(self) -> None:
        handler = cli._NoRedirectHandler()
        self.assertIsNone(
            handler.redirect_request(None, None, 302, "Found", {}, "https://evil.example/")
        )


class Redirect302Test(unittest.TestCase):
    def test_302_single_dispatch_body_accounted_then_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path)
            body = b"redirect-body-bytes"
            response = FakeResponse(
                status=302,
                headers={"Content-Type": "text/html", "Location": "https://other.example/"},
                reader=ChunkStream([body]).read,
            )
            adapter = make_adapter(ScriptedTransport([response]), ledger)
            with self.assertRaises(TransportError):
                adapter.fetch(
                    "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN, head="read"
                )
            # 单次 dispatch、body 完整有界读取并计账、响应关闭、active 已清。
            self.assertEqual(len(adapter._transport.calls), 1)
            self.assertEqual(ledger.budget.network_bytes, len(body))
            self.assertTrue(response.closed)
            self.assertEqual(ledger.budget.retry_count, 0)
            self.assertIsNone(ledger.checkpoint.active_request)


class OperationQuotaTest(unittest.TestCase):
    def test_maxlag_then_503_max_one_shares_operation_quota(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path, retry_limit=1)
            responses = [
                plain_response(b'{"error":{"code":"maxlag"}}'),
                plain_response(b"", status=503),
                plain_response(b'{"error":{"code":"missingtitle"}}'),
            ]
            adapter = make_adapter(ScriptedTransport(responses), ledger, max_retries=1)
            entry = make_collector(ledger, adapter).collect_word("read")
            self.assertEqual(entry.status, WordStatus.PAUSED)
            self.assertEqual(ledger.checkpoint.pause_reason, "http-503-retries-exhausted")
            # 最多 1 次重试：首次 maxlag claim 用掉额度，503 时 HTTP 层 claim 被拒。
            self.assertEqual(len(adapter._transport.calls), 2)
            self.assertEqual(ledger.budget.retry_count, 1)
            self.assertEqual(ledger.budget.error_count, 2)

    def test_two_operations_have_independent_quota_batch_cumulative(self) -> None:
        ledger = make_ledger(retry_limit=1)
        # operation A 用满后拒绝；operation B 仍有独立额度。
        self.assertEqual(
            ledger.claim_retry(head="a", kind=RequestKind.TOC, reason="x"), 1
        )
        with self.assertRaises(RetryBudgetExhausted):
            ledger.claim_retry(head="a", kind=RequestKind.TOC, reason="x")
        self.assertEqual(
            ledger.claim_retry(head="b", kind=RequestKind.TOC, reason="x"), 1
        )
        # 两个独立 operation，全批累计相加。
        self.assertEqual(len(ledger.checkpoint.operations), 2)
        self.assertEqual(ledger.budget.retry_count, 2)

    def test_main_api_error_retries_main_only_not_toc(self) -> None:
        ledger = make_ledger(retry_limit=1)
        responses = [
            plain_response(tocdata_payload(MULTI_LANG)),
            plain_response(b'{"error":{"code":"maxlag"}}'),
            plain_response(text_payload(english_html())),
        ]
        adapter = make_adapter(ScriptedTransport(responses), ledger, max_retries=1)
        page = collector_module.fetch_english_page(adapter, "read")
        self.assertEqual(page.status, collector_module.PageStatus.FOUND)
        urls = [url for url, _ in adapter._transport.calls]
        self.assertEqual(len(urls), 3)
        # TOC 只抓 1 次；MAIN 抓 2 次（错误只重抓 MAIN，绝不回退重跑 TOC）。
        self.assertEqual(sum("prop=tocdata" in url for url in urls), 1)
        self.assertEqual(sum("prop=text" in url for url in urls), 2)

    def test_claim_persist_failure_no_free_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path, retry_limit=1)

            def boom() -> None:
                raise RuntimeError("disk full")

            original = ledger.persist
            ledger.persist = boom  # type: ignore[method-assign]
            with self.assertRaises(RuntimeError):
                ledger.claim_retry(head="a", kind=RequestKind.TOC, reason="x")
            ledger.persist = original  # type: ignore[method-assign]
            # 持久失败回滚：无免费重试、无残留 operation。
            self.assertEqual(ledger.budget.retry_count, 0)
            self.assertEqual(ledger.checkpoint.operations, {})

    def test_claim_persisted_crash_no_free_retry_after_resume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp.json"
            ledger = make_ledger(path, retry_limit=1)
            # 真实顺序：先有一次 dispatch attempt，才 claim retry（保持不变量）。
            ledger.budget.begin_attempt(RequestKind.TOC)
            self.assertEqual(
                ledger.claim_retry(head="a", kind=RequestKind.TOC, reason="x"), 1
            )
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            reloaded.resume()
            # resume 不得获得免费重试：持久 operation 计数仍生效。
            with self.assertRaises(RetryBudgetExhausted):
                reloaded.claim_retry(head="a", kind=RequestKind.TOC, reason="x")
            self.assertEqual(reloaded.checkpoint.retry_limit, 1)


if __name__ == "__main__":
    unittest.main()
