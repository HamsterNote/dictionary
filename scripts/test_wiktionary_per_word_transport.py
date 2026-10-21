#!/usr/bin/env python3
"""真实 urllib transport 的离线集成 unittest（tasks 5.4 / 6.1，问题 1/2/6/10）。

本文件 monkeypatch ``urllib.request.OpenerDirector.open``，验证
``_build_urllib_transport``（私有 opener + NoRedirect）→ ``HttpAdapter`` → ``action_api``
的完整链路：统一 read(size) 协议、HTTPError 可读可关闭状态响应、error body
计账、URLError/timeout/OSError 归一、大小写 header、gzip trailer/concat、
未知编码 fail closed、读取中途失败保已知 bytes 且不重试、失败时 dispatch 时间戳
与 interval 重试等待。

全部 offline、zero network、zero deps（只用标准库 + unittest.mock）；所有响应
均为合成数据。
"""

from __future__ import annotations

import gzip
import io
import json
import os
import sys
import unittest
import urllib.error
from email.message import Message

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    REAL_LOOKING_UA,
    text_payload,
    tocdata_payload,
)

import refresh_wiktionary_pronunciations as cli  # noqa: E402
from wiktionary_per_word import action_api  # noqa: E402
from wiktionary_per_word.http_adapter import (  # noqa: E402
    BudgetPaused,
    HttpAdapter,
    KnownZeroTransportError,
    RequestKind,
    RunBudget,
    TransportError,
    FakeClock,
)


class RawResponse:
    """模拟 urllib response / HTTPError 的可读、可关闭状态对象。"""

    def __init__(
        self,
        chunks: list[bytes],
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._chunks = list(chunks)
        self.status = status
        self.headers = headers or {}
        self.closed = False
        self.reads = 0

    def read(self, size: int) -> bytes:
        self.reads += 1
        if not self._chunks:
            return b""
        return self._chunks.pop(0)

    def close(self) -> None:
        self.closed = True


class ExplodingRawResponse(RawResponse):
    """先返回一部分字节，再抛异常：模拟读取中途失败。"""

    def __init__(self, first: bytes, error: BaseException) -> None:
        super().__init__([first])
        self._error = error
        self.served = False

    def read(self, size: int) -> bytes:
        self.reads += 1
        if not self.served:
            self.served = True
            return self._chunks.pop(0)
        raise self._error


def build_adapter(*, budget=None, clock=None, interval=0.0, max_retries=2):
    return HttpAdapter(
        transport=cli._build_urllib_transport(),
        budget=budget or RunBudget(max_decompressed_bytes=1024 * 1024),
        clock=clock or FakeClock(),
        user_agent=REAL_LOOKING_UA,
        allow_synthetic_user_agent=True,
        interval_seconds=interval,
        max_retries=max_retries,
    )


class UrlopenScript:
    """按顺序返回 RawResponse 或抛异常；记录调用。"""

    def __init__(self, script) -> None:
        self.script = list(script)
        self.calls = 0
        self.timeouts: list[float] = []

    def __call__(self, request, timeout=None):
        self.calls += 1
        self.timeouts.append(timeout)
        if not self.script:
            raise AssertionError("urlopen 脚本已耗尽")
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


def patch_urlopen(script: UrlopenScript):
    # transport 使用私有 opener（NoRedirect）；拦截 OpenerDirector.open 而非模块级
    # urlopen。mock 替换类方法后实例访问返回 mock，调用签名与
    # UrlopenScript.__call__(request, timeout=...) 一致（绝不真网）。
    import unittest.mock as mock

    return mock.patch("urllib.request.OpenerDirector.open", script)


class WrapperChainTest(unittest.TestCase):
    def test_wrapper_adapter_actionapi_full_chain(self) -> None:
        sections = [
            {"tocLevel": 1, "hLevel": 2, "line": "German", "number": "1", "index": "1"},
            {"tocLevel": 1, "hLevel": 2, "line": "English", "number": "2", "index": "2"},
        ]
        toc = RawResponse([tocdata_payload(sections)], headers={"Content-Type": "application/json"})
        text = RawResponse(
            [text_payload('<div><h2>English</h2><span class="IPA">/ri\u02d0d/</span></div>')],
            headers={"Content-Type": "application/json"},
        )
        script = UrlopenScript([toc, text])
        adapter = build_adapter()
        with patch_urlopen(script):
            page = action_api.fetch_english_page(adapter, "read")
        # body 非空且 JSON 正确解析：wrapper 的 read(size) protocol 贯通。
        self.assertEqual(page.status, action_api.PageStatus.FOUND)
        self.assertIn("/ri", page.html or "")
        self.assertTrue(toc.closed and text.closed)
        self.assertEqual(adapter.budget.network_bytes, len(tocdata_payload(sections)) + len(text_payload('<div><h2>English</h2><span class="IPA">/ri\u02d0d/</span></div>')))
        # timeout 有限传入。
        self.assertTrue(all(timeout and timeout > 0 for timeout in script.timeouts))

    def test_http_error_429_readable_retried_body_counted(self) -> None:
        message = Message()
        message["Retry-After"] = "7"
        error_body = b'{"error":{"code":"ratelimited"}}'
        http_error = urllib.error.HTTPError(
            "https://en.wiktionary.org/w/api.php",
            429,
            "Too Many Requests",
            message,
            io.BytesIO(error_body),
        )
        ok = RawResponse([b"{}"], status=200, headers={"Content-Type": "application/json"})
        clock = FakeClock()
        script = UrlopenScript([http_error, ok])
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(budget=budget, clock=clock)
        with patch_urlopen(script):
            result = adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.TOC)
        self.assertTrue(result.retried)
        self.assertEqual(result.body, b"{}")
        self.assertEqual(budget.error_count, 1)
        self.assertEqual(budget.retry_count, 1)
        self.assertIn(7.0, clock.sleeps)
        # error body 也计入网络字节。
        self.assertGreaterEqual(budget.network_bytes, len(error_body))
        self.assertEqual(script.calls, 2)

    def test_urlerror_normalized_to_transport_error(self) -> None:
        reason = OSError("connection refused")
        script = UrlopenScript([urllib.error.URLError(reason)])
        adapter = build_adapter(max_retries=0)
        with patch_urlopen(script):
            with self.assertRaises(TransportError):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        self.assertEqual(adapter.budget.error_count, 1)

    def test_timeout_and_oserror_normalized(self) -> None:
        for exc in (TimeoutError("timed out"), OSError("reset")):
            script = UrlopenScript([exc])
            adapter = build_adapter(max_retries=0)
            with patch_urlopen(script):
                with self.assertRaises(TransportError):
                    adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)


class WrapperGzipTest(unittest.TestCase):
    def test_truncated_trailer_incomplete_via_wrapper(self) -> None:
        full = gzip.compress(b"a" * 200)
        raw = RawResponse(
            [full[:-4]],
            headers={"Content-Encoding": "gzip", "Content-Type": "text/html"},
        )
        adapter = build_adapter(budget=RunBudget(max_decompressed_bytes=1024 * 1024))
        with patch_urlopen(UrlopenScript([raw])):
            with self.assertRaises(BudgetPaused):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "incomplete-response")
        self.assertTrue(raw.closed)

    def test_concat_members_via_wrapper(self) -> None:
        body = gzip.compress(b"X" * 11) + gzip.compress(b"Y" * 13)
        raw = RawResponse(
            [body], headers={"Content-Encoding": "gzip", "Content-Type": "text/html"}
        )
        adapter = build_adapter(budget=RunBudget(max_decompressed_bytes=1024 * 1024))
        with patch_urlopen(UrlopenScript([raw])):
            result = adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        self.assertEqual(result.body, b"X" * 11 + b"Y" * 13)
        self.assertEqual(result.decompressed_bytes, 24)

    def test_lowercase_header_via_wrapper(self) -> None:
        payload = b"q" * 3000
        raw = RawResponse(
            [gzip.compress(payload)],
            headers={"content-encoding": "gzip", "content-type": "text/html"},
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(budget=budget)
        with patch_urlopen(UrlopenScript([raw])):
            result = adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        self.assertEqual(result.decompressed_bytes, 3000)

    def test_unsupported_encoding_via_wrapper(self) -> None:
        raw = RawResponse(
            [b"rawbytes"], headers={"Content-Encoding": "br", "Content-Type": "text/html"}
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        adapter = build_adapter(budget=budget)
        with patch_urlopen(UrlopenScript([raw])):
            with self.assertRaises(BudgetPaused):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "unsupported-encoding")
        self.assertEqual(budget.decompressed_bytes, 0)


class WrapperFailureTest(unittest.TestCase):
    def test_read_mid_failure_keeps_bytes_no_retry(self) -> None:
        raw = ExplodingRawResponse(b"knownbytes", OSError("mid-read reset"))
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        script = UrlopenScript([raw])
        adapter = build_adapter(budget=budget)
        with patch_urlopen(script):
            with self.assertRaises(BudgetPaused):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        self.assertEqual(adapter.pause_reason, "consumption-uncertain")
        self.assertTrue(adapter.consumption_uncertain)
        self.assertTrue(raw.closed)
        self.assertEqual(budget.decompressed_bytes, len(b"knownbytes"))
        # 不重试：urlopen 只调用一次。
        self.assertEqual(script.calls, 1)

    def test_urlerror_via_wrapper_is_uncertain_no_retry(self) -> None:
        # CLI transport 的 URLError 消费不确定：绝不 known-zero、绝不重试。
        clock = FakeClock()
        ok = RawResponse([b"{}"], headers={"Content-Type": "application/json"})
        script = UrlopenScript([urllib.error.URLError(OSError("down")), ok])
        adapter = build_adapter(clock=clock, interval=10.0, max_retries=1)
        with patch_urlopen(script):
            with self.assertRaises(TransportError):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        # 只 dispatch 一次；durable pause consumption-uncertain；未用重试等待。
        self.assertEqual(script.calls, 1)
        self.assertEqual(adapter.pause_reason, "consumption-uncertain")
        self.assertTrue(adapter.consumption_uncertain)
        self.assertEqual(adapter.budget.retry_count, 0)

    def test_known_zero_via_wrapper_retries_with_interval(self) -> None:
        # 显式 KnownZeroTransportError 才允许重试；等待 >= interval。
        clock = FakeClock()
        ok = RawResponse([b"{}"], headers={"Content-Type": "application/json"})
        script = UrlopenScript([KnownZeroTransportError("connection refused"), ok])
        adapter = build_adapter(clock=clock, interval=10.0, max_retries=1)
        with patch_urlopen(script):
            result = adapter.fetch(
                "https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN
            )
        self.assertEqual(result.body, b"{}")
        self.assertIn(10.0, clock.sleeps)
        self.assertNotIn(5.0, clock.sleeps)
        self.assertEqual(adapter.budget.request_count, 2)
        self.assertEqual(adapter.budget.retry_count, 1)


class WrapperRedirectTest(unittest.TestCase):
    def test_302_via_wrapper_single_dispatch_body_accounted(self) -> None:
        # 真实标准库 opener（NoRedirect）遇到 302：单次 dispatch、body 计账后失败。
        message = Message()
        message["Location"] = "https://other.example/wiki"
        message["Content-Type"] = "text/html"
        body = b"<html>redirect body</html>"
        http_error = urllib.error.HTTPError(
            "https://en.wiktionary.org/w/api.php", 302, "Found", message, io.BytesIO(body)
        )
        budget = RunBudget(max_decompressed_bytes=1024 * 1024)
        script = UrlopenScript([http_error])
        adapter = build_adapter(budget=budget)
        with patch_urlopen(script):
            with self.assertRaises(TransportError):
                adapter.fetch("https://en.wiktionary.org/w/api.php", kind=RequestKind.MAIN)
        # 绝不自动 follow 第二 host：只一次 dispatch，body 完整计账。
        self.assertEqual(script.calls, 1)
        self.assertGreaterEqual(budget.network_bytes, len(body))
        self.assertEqual(budget.retry_count, 0)


if __name__ == "__main__":
    unittest.main()
