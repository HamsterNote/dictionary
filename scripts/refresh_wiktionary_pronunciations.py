#!/usr/bin/env python3
"""按词 Wiktionary 音标候选工具 CLI（默认离线）。

模块边界：

- ``wiktionary_per_word.http_adapter``  HTTP 适配 / 限额流式 / 计账 / UA / 退避
- ``wiktionary_per_word.html_extract``  HTMLParser 结构栈提取
- ``wiktionary_per_word.offline_reparse``  离线重解析与候选生成
- ``wiktionary_per_word.evidence``  不可变证据与完整响应缓存
- ``wiktionary_per_word.ledger``  持久账本 / checkpoint / 逐词状态机
- ``wiktionary_per_word.action_api``  Action API parse/tocdata 动态选 English
- ``wiktionary_per_word.collector``  按词采集编排

默认**离线**：不提供 ``--apply`` 时只做离线重解析，不联网。
即使给出 ``--apply``，也必须同时显式通过名单文件、真实合规 User-Agent、
预算与明确授权校验，否则**绝不**发起任何请求。

真实联网只允许在第 10 组独立采集授权后发生。synthetic 授权/UA 一律拒绝。

用法：
    python3 scripts/refresh_wiktionary_pronunciations.py --help
    python3 scripts/refresh_wiktionary_pronunciations.py \
        --offline-reparse --cache-dir ./cache --current ./current.json \
        --output ./candidates.json
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
from urllib.parse import parse_qs, urlparse

sys.dont_write_bytecode = True

from wiktionary_per_word.action_api import DEFAULT_API_ENDPOINT
from wiktionary_per_word.authorization import GateRejected, build_binding, preflight
from wiktionary_per_word.evidence import ResponseCache
from wiktionary_per_word.http_adapter import (
    TransportError,
)
from wiktionary_per_word.ledger import (
    BatchAuthorization,
)
from wiktionary_per_word.offline_reparse import (
    Candidate,
    generate_candidates,
    reparse_cached_entry,
)

DEFAULT_INTERVAL_SECONDS = 1.0
DEFAULT_MAX_RETRIES = 2


class CliError(Exception):
    """CLI 参数/授权校验失败。绝不触发联网。"""


@dataclass(frozen=True)
class ApplyConfig:
    """真实采集所需的最小显式配置。"""

    heads_file: Path
    user_agent: str
    budget_heads: int
    budget_decompressed_bytes: int
    authorization: BatchAuthorization
    interval_seconds: float
    max_retries: int
    checkpoint: Path
    cache_dir: Path
    endpoint: str
    budget_requests: int = 600
    binding: dict | None = None


def _load_heads(path: Path) -> list[str]:
    if not path.exists():
        raise CliError(f"名单文件不存在: {path}")
    heads = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not heads:
        raise CliError("名单文件为空")
    return heads


def validate_apply_config(args: argparse.Namespace) -> ApplyConfig:
    """只读严格预检；成功也不构成执行许可（真实入口仍 NO-GO）。"""
    try:
        binding = preflight(args, repo=Path(__file__).resolve().parents[1])
    except GateRejected as error:
        raise CliError(str(error)) from error
    root = Path(binding["workspaceRoot"])
    limits = binding["limits"]
    return ApplyConfig(
        heads_file=root / binding["paths"]["heads"],
        user_agent=args.user_agent,
        budget_heads=limits["distinctHeads"],
        budget_decompressed_bytes=limits["decompressedBytesAll"],
        authorization=BatchAuthorization(
            limits["distinctHeads"], limits["decompressedBytesAll"], True,
            "user-confirmation", requests=limits["requestAttempts"]),
        interval_seconds=args.interval_seconds,
        max_retries=args.max_retries,
        checkpoint=root / binding["paths"]["checkpoint"],
        cache_dir=root / binding["paths"]["cache"],
        endpoint=args.endpoint,
        budget_requests=limits["requestAttempts"], binding=binding,
    )


def _head_from_url(url: str) -> str | None:
    query = parse_qs(urlparse(url).query)
    values = query.get("page")
    return values[0] if values else None


def run_offline_reparse(
    *, cache_dir: Path, current_path: Path | None, output_path: Path | None
) -> list[Candidate]:
    """离线重解析：不联网，从缓存生成候选。"""
    if not cache_dir.exists():
        raise CliError(f"缓存目录不存在: {cache_dir}")
    cache = ResponseCache(directory=cache_dir)
    current: dict[str, str | None] = {}
    if current_path is not None and current_path.exists():
        current = json.loads(current_path.read_text(encoding="utf-8"))

    candidates: list[Candidate] = []
    for entry in cache.entries():  # 稳定顺序，便于审查
        try:
            payload = json.loads(entry.body)
        except (ValueError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict) and not payload.get("error"):
            parse = payload.get("parse")
            # TOC is navigation evidence, whereas parse.text is the main response.
            if isinstance(parse, dict) and "tocdata" in parse and "text" not in parse:
                continue
        head = _head_from_url(entry.source_url)
        if head is None:
            continue
        result = reparse_cached_entry(entry)
        candidates.extend(
            generate_candidates(
                head=head,
                current_value=current.get(head),
                observations=result.observations,
            )
        )

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(
                {
                    "mode": "offline-reparse",
                    "candidates": [candidate.to_json() for candidate in candidates],
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
    return candidates


# 真实 urllib 请求的有限超时（秒）。不得无限阻塞。
DEFAULT_HTTP_TIMEOUT_SECONDS = 30.0


class _UrllibResponse:
    """把 urllib 的 response / HTTPError 统一成适配层可读协议。

    - 暴露 ``read(size)`` / ``status`` / ``headers`` / ``close()``，与测试假响应
      的 ``reader`` 协议在适配层统一（``_reader_for``）。
    - ``HTTPError`` 本身也是可读、可关闭的状态响应：4xx/5xx 不再作为传输异常
      丢失，而是带 status/headers/body 进入 429/503 重试与字节计账。
    """

    def __init__(self, raw: object) -> None:
        self._raw = raw
        status = getattr(raw, "status", None)
        if status is None:
            status = getattr(raw, "code", 200)
        self.status = int(status) if status is not None else 200
        headers = getattr(raw, "headers", None)
        self.headers = dict(headers) if headers is not None else {}

    def read(self, size: int) -> bytes:
        return self._raw.read(size)  # type: ignore[attr-defined]

    def close(self) -> None:
        close = getattr(self._raw, "close", None)
        if callable(close):
            close()


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """拒绝自动跟随 HTTP 重定向（3xx）。

    默认 ``urlopen`` 会自动 follow，隐藏最终 ``fp.read``/错误体、放大成多个请求
    并可能换 host。这里 ``redirect_request`` 返回 ``None`` 让 ``urllib`` 把 3xx 作为
    ``HTTPError`` 交回，由适配层当作**单个**响应完整有界读取、计账后失败；绝不
    自动跟第二 host。

    注意：MediaWiki 的 ``redirects=1`` 参数是**页面标题**重定向（API 语义），与
    HTTP 3xx 无关，两者互不影响。
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None  # 禁自动 follow；3xx 以 HTTPError 交回。


def _build_urllib_transport(timeout: float = DEFAULT_HTTP_TIMEOUT_SECONDS):
    """真实 transport：仅在 apply 校验全部通过后才构造。

    - 使用**私有 opener + NoRedirect**：不自动 follow 3xx，单个响应完整有界读取
      并计账后失败；绝不跟第二 host、绝不隐藏错误体。
    - 有限 ``timeout``，绝不无限等待。
    - ``HTTPError``（含 3xx/4xx/5xx、429/503）视为可读、可关闭状态响应，保留
      status/headers/body，交由适配层计账/重试。
    - ``URLError`` / ``timeout`` / ``OSError`` 一律归一为**泛化** ``TransportError``
      （消费不确定）：**绝不**归类为 known-zero、绝不自动重试。
    """

    import urllib.error
    import urllib.request

    opener = urllib.request.build_opener(_NoRedirectHandler())

    def transport(url: str, headers: dict[str, str]):
        request = urllib.request.Request(url, headers=dict(headers))
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            # 有状态、可读、可关闭：body 也要计入预算（含 3xx 不跟随）。
            return _UrllibResponse(error)
        except urllib.error.URLError as error:
            # 消费不确定：泛化 TransportError，绝不 known-zero。
            raise TransportError(f"URLError（消费不确定）: {error.reason}") from error
        except (TimeoutError, OSError) as error:
            raise TransportError(f"传输失败（消费不确定）: {error}") from error
        return _UrllibResponse(response)

    return transport


def run_apply(config: ApplyConfig, *, now) -> None:
    """No callable real-transport bypass while collection remains unauthorized."""
    raise CliError("NO-GO: 真实采集尚未授权；run_apply 与 CLI 同样禁用")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="refresh_wiktionary_pronunciations.py",
        description=(
            "按词 Wiktionary 音标候选工具。默认离线；真实联网须第 10 组独立授权 "
            "且显式通过名单/真实 UA/预算/授权校验。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--offline-reparse", action="store_true", help="离线重解析缓存（默认）")
    parser.add_argument("--cache-dir", help="完整响应缓存目录")
    parser.add_argument("--current", help="当前正式音标 JSON（head -> phonetic）")
    parser.add_argument("--output", help="候选报告输出路径")

    parser.add_argument("--apply", action="store_true", help="执行真实采集（需全部授权校验）")
    parser.add_argument("--heads-file", help="首轮词头名单文件")
    parser.add_argument("--user-agent", help="真实合规 User-Agent（含联系信息）")
    parser.add_argument("--authorization-file", help="明确授权 JSON")
    parser.add_argument("--workspace-root", help="绑定 workspace 的绝对路径")
    parser.add_argument("--batch-root", help="独立批次目录名（workspace 相对路径）")
    parser.add_argument("--execution-commit", help="最终执行版本的完整 commit SHA")
    parser.add_argument("--budget-requests", type=int, help="跨恢复全批 dispatch attempt 上限（最多600）")
    parser.add_argument("--describe-binding", action="store_true", help="只读输出待确认绑定，不创建授权")
    parser.add_argument("--check-authorization", action="store_true", help="只读预检用户提供的授权，不执行")
    parser.add_argument("--budget-heads", type=int, help="授权 distinct head 上限")
    parser.add_argument(
        "--budget-decompressed-mib", type=float, help="授权解压后字节上限（MiB）"
    )
    parser.add_argument("--checkpoint", help="批次 checkpoint 路径")
    parser.add_argument("--endpoint", default=DEFAULT_API_ENDPOINT, help="Action API 端点")
    parser.add_argument(
        "--interval-seconds", type=float, default=DEFAULT_INTERVAL_SECONDS, help="请求间隔"
    )
    parser.add_argument("--max-retries", type=int, default=DEFAULT_MAX_RETRIES, help="有限重试次数")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.apply:
        # Independent guard: offline implementation/testing never grants collection.
        print(
            "拒绝真实采集（NO-GO）：gate 已实现离线校验，但本轮无真实采集授权；"
            "--apply 保持禁用",
            file=sys.stderr,
        )
        return 2

    if args.describe_binding or args.check_authorization:
        try:
            binding = (preflight if args.check_authorization else build_binding)(
                args, repo=Path(__file__).resolve().parents[1])
        except GateRejected as error:
            print(f"绑定预检拒绝: {error}", file=sys.stderr)
            return 2
        print(json.dumps(binding, ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    if args.cache_dir:
        try:
            candidates = run_offline_reparse(
                cache_dir=Path(args.cache_dir),
                current_path=Path(args.current) if args.current else None,
                output_path=Path(args.output) if args.output else None,
            )
        except CliError as error:
            print(f"离线重解析失败: {error}", file=sys.stderr)
            return 2
        print(f"离线候选数: {len(candidates)}")
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
