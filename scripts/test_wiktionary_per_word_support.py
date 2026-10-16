"""`test_wiktionary_per_word_*` 共享测试夹具（含 synthetic 标记）。

本模块只提供假 HTTP transport / 假时钟 / 假 streaming reader 与合成
HTML/tocdata，供离线 unittest 使用；不联网。所有合成数据都带 synthetic 语义，
真实入口会拒绝把它们当真实许可。
"""

from __future__ import annotations

import gzip
from typing import Callable, Mapping

from wiktionary_per_word.http_adapter import FakeClock, FakeResponse

SYNTHETIC_UA = "wiktionary-per-word-tests/1.0 (synthetic; contact@example.invalid)"
REAL_LOOKING_UA = "pronunciation-refresh/1.0 (contact: maintainer@example.org)"


class ChunkStream:
    """把预置分块喂给 reader(size) 的假流，记录调用次数。"""

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = list(chunks)
        self.position = 0
        self.calls = 0
        self.closed = False

    def read(self, size: int) -> bytes:
        self.calls += 1
        if self.position >= len(self.chunks):
            return b""
        chunk = self.chunks[self.position]
        self.position += 1
        return chunk

    def close(self) -> None:
        self.closed = True


def gzip_bytes(payload: bytes) -> bytes:
    return gzip.compress(payload)


def plain_response(body: bytes, *, status: int = 200, headers: Mapping[str, str] | None = None) -> FakeResponse:
    merged = {"Content-Type": "application/json"}
    if headers:
        merged.update(headers)
    return FakeResponse(status=status, headers=merged, reader=ChunkStream([body]).read)


def gzip_response(payload: bytes, *, status: int = 200) -> FakeResponse:
    return FakeResponse(
        status=status,
        headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
        reader=ChunkStream([gzip_bytes(payload)]).read,
    )


class ScriptedTransport:
    """按脚本返回一系列 FakeResponse；记录调用参数。"""

    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, dict[str, str]]] = []

    def __call__(self, url: str, headers: Mapping[str, str]):
        self.calls.append((url, dict(headers)))
        if not self.responses:
            raise AssertionError("transport 脚本已耗尽")
        return self.responses.pop(0)


def tocdata_payload(sections: list[dict[str, object]]) -> bytes:
    import json

    return json.dumps({"parse": {"tocdata": {"sections": sections}}}).encode("utf-8")


def text_payload(html: str, *, revid: int = 12345) -> bytes:
    import json

    return json.dumps(
        {
            "parse": {
                "title": "read",
                "pageid": 1,
                "revid": revid,
                "text": {"*": html},
            }
        }
    ).encode("utf-8")


def english_html() -> str:
    """合成 English 段：多 Etymology、多 Pronunciation、audio 干扰、片段。"""
    return (
        '<div class="mw-heading mw-heading2"><h2 id="English">English</h2></div>'
        '<div class="mw-heading mw-heading3"><h3 id="Etymology_1">Etymology 1</h3></div>'
        '<div class="mw-heading mw-heading4"><h4 id="Pronunciation">Pronunciation</h4></div>'
        "<ul>"
        '<li><span class="IPA">/ri&#720;d/</span>'
        '<span class="H-audio"><a href="//x/read.ogg">audio</a></span></li>'
        '<li><span class="qualifier-content">(General American)</span> '
        '<span class="IPA">/ri&#720;d/</span></li>'
        "</ul>"
        '<div class="mw-heading mw-heading3"><h3 id="Etymology_2">Etymology 2</h3></div>'
        '<div class="mw-heading mw-heading4"><h4 id="Pronunciation_2">Pronunciation</h4></div>'
        "<ul>"
        '<li><span class="IPA">/r&#603;d/</span></li>'
        '<li><span class="IPA">/fr&#230;g</li>'
        "</ul>"
    )


def source_clock(start: float = 0.0) -> FakeClock:
    return FakeClock(start=start)


def fixed_now(value: str = "2026-01-01T00:00:00Z") -> Callable[[], str]:
    return lambda: value
