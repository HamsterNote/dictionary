#!/usr/bin/env python3
"""HTTP 适配层离线 unittest：tasks 5.4 与 6.1。

覆盖：合规 UA 校验（缺 UA / synthetic 拒绝且不发请求）、串行无并发、
429/503 Retry-After 与 >=5s 指数退避、有限重试受预算、全部响应分类计账、
gzip 高膨胀限额、恰好触限不补读、截断不解析、网络与解压 bytes 分报。
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    REAL_LOOKING_UA,
    SYNTHETIC_UA,
    ChunkStream,
    ScriptedTransport,
    gzip_bytes,
    plain_response,
    source_clock,
)

from wiktionary_per_word.http_adapter import (  # noqa: E402
    BoundedStreamReader,
    BudgetPaused,
    ConcurrencyError,
    FakeResponse,
    HttpAdapter,
    InvalidUserAgentError,
    KnownZeroTransportError,
    MissingUserAgentError,
    RequestKind,
    RunBudget,
    TransportError,
    _reader_for,
    normalize_headers,
    parse_retry_after,
    validate_user_agent,
)


class MidFailStream:
    """先返回若干字节，随后抛异常：模拟读取中途失败。"""

    def __init__(self, first: bytes, error: BaseException) -> None:
        self.first = first
        self.error = error
        self.calls = 0
        self.closed = False
        self.served = False

    def read(self, size: int) -> bytes:
        self.calls += 1
        if not self.served:
            self.served = True
            return self.first
        raise self.error

    def close(self) -> None:
        self.closed = True


class ReadOnlyResponse:
    """只有 ``read(size)``、没有 ``reader`` 的真实风格响应。"""

    def __init__(self, chunks: list[bytes], *, status: int = 200, headers=None) -> None:
        self._chunks = list(chunks)
        self.status = status
        self.headers = headers or {}
        self.closed = False
        self.calls = 0

    def read(self, size: int) -> bytes:
        self.calls += 1
        if not self._chunks:
            return b""
        return self._chunks.pop(0)

    def close(self) -> None:
        self.closed = True


def build_adapter(transport, *, budget=None, clock=None, **kwargs):
    return HttpAdapter(
        transport=transport,
        budget=budget or RunBudget(max_decompressed_bytes=1024 * 1024, max_distinct_heads=100),
        clock=clock or source_clock(),
        user_agent=kwargs.pop("user_agent", SYNTHETIC_UA),
        allow_synthetic_user_agent=True,
        interval_seconds=kwargs.pop("interval_seconds", 0.0),
        max_retries=kwargs.pop("max_retries", 2),
        **kwargs,
    )


class UserAgentTest(unittest.TestCase):
    def test_missing_user_agent_raises(self) -> None:
        with self.assertRaises(MissingUserAgentError):
            validate_user_agent(None)

    def test_synthetic_user_agent_rejected_by_real_entry(self) -> None:
        with self.assertRaises(InvalidUserAgentError):
            validate_user_agent(SYNTHETIC_UA, allow_synthetic=False)

    def test_contact_user_agent_accepted(self) -> None:
        self.assertEqual(validate_user_agent(REAL_LOOKING_UA), REAL_LOOKING_UA)

    def test_invalid_ua_never_calls_transport(self) -> None:
        calls: list[str] = []

        def transport(url, headers):
            calls.append(url)
            return plain_response(b"{}")

        with self.assertRaises(MissingUserAgentError):
            HttpAdapter(transport=transport, budget=RunBudget(), user_agent=None)
        self.assertEqual(calls, [])


class SerialAndBackoffTest(unittest.TestCase):
    def test_retry_after_is_honored(self) -> None:
        clock = source_clock()
        transport = ScriptedTransport(
            [
                plain_response(b"", status=429, headers={"Retry-After": "7"}),
                plain_response(b"{}", status=200),
            ]
        )
        adapter = build_adapter(transport, clock=clock)
        result = adapter.fetch("https://example/api", kind=RequestKind.TOC)
        self.assertTrue(result.retried)
        self.assertIn(7.0, clock.sleeps)
        self.assertEqual(adapter.budget.error_count, 1)
        self.assertEqual(adapter.budget.retry_count, 1)

    def test_503_without_header_uses_min_5s_exponential(self) -> None:
        clock = source_clock()
        transport = ScriptedTransport(
            [
                plain_response(b"", status=503),
                plain_response(b"", status=503),
                plain_response(b"", status=503),
            ]
        )
        adapter = build_adapter(transport, clock=clock, max_retries=2)
        with self.assertRaises(TransportError):
            adapter.fetch("https://example/api", kind=RequestKind.MAIN)
        self.assertEqual(clock.sleeps, [5.0, 10.0])
        # 三次错误响应都计入预算。
        self.assertEqual(adapter.budget.error_count, 3)
        self.assertEqual(adapter.budget.request_count, 3)

    def test_no_concurrency(self) -> None:
        holder: dict[str, HttpAdapter] = {}

        def nested_transport(url, headers):
            # 传输层重入调用同一 adapter，应被拒绝。
            with self.assertRaises(ConcurrencyError):
                holder["adapter"].fetch("https://example/nested", kind=RequestKind.AUX)
            return plain_response(b"{}")

        adapter = build_adapter(nested_transport)
        holder["adapter"] = adapter
        adapter.fetch("https://example/api", kind=RequestKind.MAIN)

    def test_enforces_interval_between_requests(self) -> None:
        clock = source_clock()
        transport = ScriptedTransport([plain_response(b"{}"), plain_response(b"{}")])
        adapter = build_adapter(transport, clock=clock, interval_seconds=2.0)
        adapter.fetch("https://example/a", kind=RequestKind.TOC)
        adapter.fetch("https://example/b", kind=RequestKind.MAIN)
        # 第二次请求前应等待 2 秒。
        self.assertIn(2.0, clock.sleeps)


class BoundedReadTest(unittest.TestCase):
    def test_plain_read_hits_exact_limit_without_extra_read(self) -> None:
        stream = ChunkStream([b"x" * 10, b"y" * 10])
        reader = BoundedStreamReader()
        result = reader.read(stream.read, remaining=10, gzip_encoded=False)
        self.assertTrue(result.limit_hit)
        self.assertFalse(result.complete)
        self.assertEqual(result.decompressed_bytes, 10)
        self.assertEqual(stream.calls, 1)  # 不补读

    def test_plain_read_completes_normally(self) -> None:
        stream = ChunkStream([b"abc", b"def"])
        reader = BoundedStreamReader()
        result = reader.read(stream.read, remaining=1024, gzip_encoded=False)
        self.assertTrue(result.complete)
        self.assertFalse(result.limit_hit)
        self.assertEqual(result.body, b"abcdef")

    def test_gzip_high_expansion_is_capped(self) -> None:
        payload = b"\x00" * (2 * 1024 * 1024)
        stream = ChunkStream([gzip_bytes(payload)])
        reader = BoundedStreamReader()
        result = reader.read(stream.read, remaining=1024, gzip_encoded=True)
        self.assertTrue(result.limit_hit)
        self.assertLessEqual(result.decompressed_bytes, 1024)
        self.assertEqual(result.decompressed_bytes, 1024)

    def test_corrupt_gzip_is_incomplete(self) -> None:
        reader = BoundedStreamReader()
        result = reader.read(ChunkStream([b"\x1f\x8bnotgzip"]).read, remaining=1024, gzip_encoded=True)
        self.assertTrue(result.truncated)
        self.assertFalse(result.complete)


class AccountingTest(unittest.TestCase):
    def test_all_kinds_and_gzip_counted_separately(self) -> None:
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        payload = b"a" * 100
        transport = ScriptedTransport(
            [
                plain_response(payload, status=200, headers={"Content-Type": "application/json"}),
                FakeResponse(
                    status=200,
                    headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
                    reader=ChunkStream([gzip_bytes(payload)]).read,
                ),
                plain_response(b"", status=500),
            ]
        )
        adapter = build_adapter(transport, budget=budget, max_retries=0)
        adapter.fetch("https://example/toc", kind=RequestKind.TOC)
        adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        with self.assertRaises(TransportError):
            adapter.fetch("https://example/aux", kind=RequestKind.AUX)
        self.assertEqual(budget.request_count, 3)
        self.assertEqual(budget.requests_by_kind, {"toc": 1, "main": 1, "aux": 1})
        # gzip 解压后 100 字节，但网络传输的是压缩后（更小）字节。
        self.assertGreaterEqual(budget.decompressed_bytes, 100)
        self.assertNotEqual(budget.network_bytes, budget.decompressed_bytes)

    def test_limit_pauses_and_closes_response(self) -> None:
        budget = RunBudget(max_decompressed_bytes=8)
        stream = ChunkStream([b"0123456789abcdef"])
        response = FakeResponse(status=200, headers={"Content-Type": "text/html"}, reader=stream.read)
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertTrue(adapter.paused)
        self.assertTrue(response.closed)
        # 已消耗的 bytes 保留，不能被清零。
        self.assertEqual(budget.decompressed_bytes, 8)

    def test_paused_adapter_refuses_further_requests(self) -> None:
        budget = RunBudget(max_decompressed_bytes=4)
        stream = ChunkStream([b"01234567"])
        first = FakeResponse(status=200, reader=stream.read)
        adapter = build_adapter(ScriptedTransport([first, plain_response(b"{}")]), budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        with self.assertRaises(Exception):
            adapter.fetch("https://example/retry", kind=RequestKind.MAIN)


    def test_gzip_high_expansion_via_adapter_pauses(self) -> None:
        payload = b"\x00" * (2 * 1024 * 1024)
        budget = RunBudget(max_decompressed_bytes=4096)
        response = FakeResponse(
            status=200,
            headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
            reader=ChunkStream([gzip_bytes(payload)]).read,
        )
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        # 解压输出被限额截断，实际网络字节远小于膨胀后内容。
        self.assertEqual(budget.decompressed_bytes, 4096)
        self.assertLess(budget.network_bytes, len(payload))


class ExactBudgetTest(unittest.TestCase):
    def test_exact_remaining_then_more_data_pauses(self) -> None:
        # 剩余额度恰好 4，但流里还有更多数据：必须停读暂停，不补读。
        stream = ChunkStream([b"abcd", b"more"])
        adapter = build_adapter(
            ScriptedTransport(
                [FakeResponse(status=200, headers={"Content-Type": "text/html"}, reader=stream.read)]
            ),
            budget=RunBudget(max_decompressed_bytes=4),
        )
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(stream.calls, 1)


class UnifiedReadProtocolTest(unittest.TestCase):
    """统一 read 协议：真实 wrapper 的 read(size) 与假响应 reader 都可读。"""

    def test_fake_response_read_delegates_to_reader(self) -> None:
        response = FakeResponse(reader=ChunkStream([b"abc"]).read)
        self.assertEqual(response.read(10), b"abc")

    def test_reader_for_prefers_reader_then_read(self) -> None:
        fake = FakeResponse(reader=ChunkStream([b"x"]).read)
        self.assertIs(_reader_for(fake), fake.reader)
        read_only = ReadOnlyResponse([b"y"])
        self.assertTrue(callable(_reader_for(read_only)))

    def test_read_only_response_body_not_empty(self) -> None:
        # 真实 wrapper 只暴露 read(size)：绝不能把 body 读成空。
        response = ReadOnlyResponse([b"hello ", b"world"])
        adapter = build_adapter(ScriptedTransport([response]))
        result = adapter.fetch("https://example/api", kind=RequestKind.TOC)
        self.assertEqual(result.body, b"hello world")
        self.assertTrue(response.closed)


class HeaderCaseTest(unittest.TestCase):
    def test_normalize_headers_lowercases_keys(self) -> None:
        self.assertEqual(
            normalize_headers({"Content-Encoding": "GZIP", "Retry-After": "7"}),
            {"content-encoding": "GZIP", "retry-after": "7"},
        )

    def test_lowercase_content_encoding_still_counted_gzip(self) -> None:
        # header 大小写不得绕过 gzip 预算：解压后字节应大于网络字节。
        payload = b"z" * 4096
        response = FakeResponse(
            status=200,
            headers={"content-encoding": "gzip", "content-type": "text/html"},
            reader=ChunkStream([gzip_bytes(payload)]).read,
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        result = adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(result.decompressed_bytes, 4096)
        self.assertLess(budget.network_bytes, budget.decompressed_bytes)


class GzipIntegrityTest(unittest.TestCase):
    def _gzip_adapter(self, body: bytes, *, remaining: int):
        response = FakeResponse(
            status=200,
            headers={"Content-Encoding": "gzip", "Content-Type": "text/html"},
            reader=ChunkStream([body]).read,
        )
        budget = RunBudget(max_decompressed_bytes=remaining)
        return build_adapter(ScriptedTransport([response]), budget=budget), response

    def test_truncated_trailer_is_incomplete_not_budget_exhausted(self) -> None:
        full = gzip_bytes(b"a" * 100)
        truncated = full[:-4]  # 截断 trailer
        adapter, response = self._gzip_adapter(truncated, remaining=1024 * 1024)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "incomplete-response")
        self.assertTrue(response.closed)
        # 已知网络字节仍保留，不清零。
        self.assertGreater(adapter.budget.network_bytes, 0)

    def test_concat_members_all_consumed(self) -> None:
        member_a = gzip_bytes(b"A" * 5)
        member_b = gzip_bytes(b"B" * 7)
        body = member_a + member_b
        response = FakeResponse(
            status=200,
            headers={"Content-Encoding": "gzip", "Content-Type": "text/html"},
            reader=ChunkStream([body]).read,
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        result = adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(result.body, b"AAAAA" + b"BBBBBBB")
        self.assertEqual(result.decompressed_bytes, 12)

    def test_unsupported_encoding_fails_closed_not_identity(self) -> None:
        response = FakeResponse(
            status=200,
            headers={"Content-Encoding": "br", "Content-Type": "text/html"},
            reader=ChunkStream([b"rawrawraw"]).read,
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "unsupported-encoding")
        self.assertTrue(response.closed)
        # 不按 identity 旁路：不读 body、不计解压字节。
        self.assertEqual(budget.decompressed_bytes, 0)
        self.assertEqual(budget.network_bytes, 0)

    def test_exact_limit_does_not_prove_eof_pauses(self) -> None:
        # gzip 恰好产出 = 额度：decompressor.eof 只证明当前 member 结束，不证明
        # HTTP EOF（后续 chunk 可能有下一 member）。必须 close/pause、不补读。
        payload = b"c" * 512
        body = gzip_bytes(payload)
        stream = ChunkStream([body])
        response = FakeResponse(
            status=200,
            headers={"Content-Encoding": "gzip", "Content-Type": "text/html"},
            reader=stream.read,
        )
        budget = RunBudget(max_decompressed_bytes=512)
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "decompressed-budget-exhausted")
        self.assertTrue(response.closed)
        # 不补读。
        self.assertEqual(stream.calls, 1)

    def test_direct_exact_limit_gzip_not_complete(self) -> None:
        # 主编排复现：完全未证明 HTTP EOF，不得判 complete。
        from io import BytesIO

        reader = BoundedStreamReader()
        result = reader.read(
            BytesIO(gzip_bytes(b"abc")).read, remaining=3, gzip_encoded=True
        )
        self.assertFalse(result.complete)
        self.assertTrue(result.truncated)
        self.assertTrue(result.limit_hit)
        self.assertEqual(result.decompressed_bytes, 3)

    def test_single_member_complete_on_eof(self) -> None:
        reader = BoundedStreamReader()
        result = reader.read(
            __import__("io").BytesIO(gzip_bytes(b"abc")).read,
            remaining=1024,
            gzip_encoded=True,
        )
        self.assertTrue(result.complete)
        self.assertFalse(result.truncated)
        self.assertEqual(result.body, b"abc")

    def test_split_chunk_second_member_fully_consumed(self) -> None:
        # 两个 member 分处两个 chunk：必须都消费，不遗漏。
        first = gzip_bytes(b"AAAA")
        second = gzip_bytes(b"BBBBBB")
        stream = ChunkStream([first, second])
        reader = BoundedStreamReader()
        result = reader.read(stream.read, remaining=1024 * 1024, gzip_encoded=True)
        self.assertTrue(result.complete)
        self.assertEqual(result.body, b"AAAABBBBBB")
        self.assertEqual(result.decompressed_bytes, 10)

    def test_concat_exact_limit_pauses_and_closes(self) -> None:
        # 两个 member 总解压量恰好 = 额度：未证 EOF，必须 pause 不判 complete。
        body = gzip_bytes(b"AAA") + gzip_bytes(b"BBB")
        stream = ChunkStream([body])
        response = FakeResponse(
            status=200,
            headers={"Content-Encoding": "gzip", "Content-Type": "text/html"},
            reader=stream.read,
        )
        budget = RunBudget(max_decompressed_bytes=6)
        adapter = build_adapter(ScriptedTransport([response]), budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "decompressed-budget-exhausted")
        self.assertTrue(response.closed)
        self.assertEqual(stream.calls, 1)


class ReaderFailureTest(unittest.TestCase):
    def test_mid_read_failure_keeps_known_bytes_and_pauses_uncertain(self) -> None:
        stream = MidFailStream(b"known", TransportError("boom"))
        response = FakeResponse(
            status=200, headers={"Content-Type": "text/html"}, reader=stream.read
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        transport = ScriptedTransport([response])
        adapter = build_adapter(transport, budget=budget)
        with self.assertRaises(BudgetPaused):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "consumption-uncertain")
        self.assertTrue(adapter.consumption_uncertain)
        self.assertTrue(response.closed)
        # 已消费 bytes 保留，不清零。
        self.assertEqual(budget.decompressed_bytes, 5)
        self.assertEqual(budget.network_bytes, 5)
        # 不可重试：transport 只被调用一次。
        self.assertEqual(len(transport.calls), 1)


class AttemptAccountingTest(unittest.TestCase):
    def test_known_zero_transport_failure_counts_attempt_error_retry(self) -> None:
        calls = {"n": 0}

        def transport(url, headers):
            calls["n"] += 1
            raise KnownZeroTransportError("down")

        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(transport, budget=budget, max_retries=2)
        with self.assertRaises(TransportError):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        # 3 次 attempt 都算 request，失败计 error，前两次重试计 retry。
        self.assertEqual(budget.request_count, 3)
        self.assertEqual(budget.error_count, 3)
        self.assertEqual(budget.retry_count, 2)
        self.assertEqual(calls["n"], 3)

    def test_generic_transport_error_is_uncertain_single_dispatch(self) -> None:
        # 泛化 TransportError 默认 unknown：不重试、durable pause。
        calls = {"n": 0}

        def transport(url, headers):
            calls["n"] += 1
            raise TransportError("unknown")

        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(transport, budget=budget, max_retries=2)
        with self.assertRaises(TransportError):
            adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertEqual(calls["n"], 1)
        self.assertEqual(adapter.pause_reason, "consumption-uncertain")
        self.assertEqual(budget.retry_count, 0)

    def test_interval_applies_before_retry_on_known_zero_failure(self) -> None:
        # interval=10 > fallback 5：known-zero 重试等待必须 >=10。
        clock = source_clock()
        attempts = {"n": 0}

        def transport(url, headers):
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise KnownZeroTransportError("down")
            return plain_response(b"{}")

        adapter = build_adapter(transport, clock=clock, interval_seconds=10.0, max_retries=1)
        adapter.fetch("https://example/main", kind=RequestKind.MAIN)
        self.assertIn(10.0, clock.sleeps)
        self.assertNotIn(5.0, clock.sleeps)


if __name__ == "__main__":
    unittest.main()
