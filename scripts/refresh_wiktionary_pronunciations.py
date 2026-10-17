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
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence
from urllib.parse import parse_qs, urlparse

sys.dont_write_bytecode = True

from wiktionary_per_word.action_api import DEFAULT_API_ENDPOINT
from wiktionary_per_word.authorization import GateRejected, authorized_session, build_binding, preflight
from wiktionary_per_word.collector import Collector
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache
from wiktionary_per_word.http_adapter import (
    HttpAdapter,
    TransportError,
)
from wiktionary_per_word.ledger import (
    BatchAuthorization,
    BatchLedger,
)
from wiktionary_per_word.offline_reparse import (
    Candidate,
    generate_candidates,
    reparse_cached_entry,
)

DEFAULT_INTERVAL_SECONDS = 1.0
DEFAULT_MAX_RETRIES = 2


class CliError(Exception):
    """CLI 参数/授权拒绝，以及执行期间的 fail-closed 错误。"""


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[1]


def validate_apply_config(args: argparse.Namespace) -> dict:
    """只读严格预检，不缓存许可；执行入口会在锁内重新检查。"""
    try:
        return preflight(args, repo=_repository_root())
    except GateRejected as error:
        raise CliError(str(error)) from error


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


def run_apply(args: argparse.Namespace, *, now) -> dict:
    """Only a freshly verified user confirmation can enter the locked collector.

    There is no prevalidated-config/permit argument, injectable transport option,
    or synthetic-authorization flag on this entry. Tests patch the transport
    factory in memory while sockets are disabled.
    """
    if not isinstance(args, argparse.Namespace):
        raise CliError("NO-GO: 执行需要原始调用参数，不能传入授权对象或预校验配置")
    args = argparse.Namespace(**vars(args))
    try:
        with authorized_session(args, repo=_repository_root()) as session:
            binding = session.binding
            root, paths, limits, calls = (Path(binding["workspaceRoot"]), binding["paths"],
                                         binding["limits"], binding["calls"])
            checkpoint = root / paths["checkpoint"]
            if checkpoint.exists():
                ledger = BatchLedger.load(checkpoint)
                ledger.resume()
            else:
                ledger = BatchLedger.create(
                    batch_id=binding["batchId"], path=checkpoint, created_at=now(),
                    authorization=BatchAuthorization(
                        limits["distinctHeads"], limits["decompressedBytesAll"], True,
                        "user-confirmation", requests=limits["requestAttempts"]),
                    retry_limit=calls["maxRetriesPerOperation"],
                )
            cache = ResponseCache(root / paths["cache"])
            adapter = HttpAdapter(
                transport=_build_urllib_transport(timeout=calls["timeoutSeconds"]),
                budget=ledger.budget, journal=ledger, user_agent=binding["userAgent"],
                interval_seconds=calls["intervalSeconds"], max_retries=calls["maxRetriesPerOperation"],
            )
            report = Collector(
                ledger=ledger, adapter=adapter, cache=cache, evidence_ledger=EvidenceLedger(),
                now=now, endpoint=calls["endpoint"],
            ).run_batch(session.heads)
            candidates = None if ledger.checkpoint.pending_cache is not None else run_offline_reparse(
                cache_dir=root / paths["cache"], current_path=None,
                output_path=root / paths["reports"][0],
            )
            result = {"batchId": binding["batchId"], "processed": report.processed,
                      "pausedReason": report.paused_reason,
                      "candidateCount": None if candidates is None else len(candidates),
                      "budget": ledger.budget.to_json()}
            with (root / paths["log"]).open("a", encoding="utf-8") as log:
                log.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
        return result
    except GateRejected as error:
        raise CliError(f"NO-GO: {error}") from error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="refresh_wiktionary_pronunciations.py",
        description=(
            "按词 Wiktionary 音标候选工具。默认离线；真实联网须第 10 组独立授权 "
            "且显式通过名单/真实 UA/预算/授权校验。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline-reparse", action="store_true", help="离线重解析缓存（默认）")
    parser.add_argument("--cache-dir", help="完整响应缓存目录")
    parser.add_argument("--current", help="当前正式音标 JSON（head -> phonetic）")
    parser.add_argument("--output", help="候选报告输出路径")

    mode.add_argument("--apply", action="store_true", help="执行真实采集（需全部授权校验）")
    parser.add_argument("--heads-file", help="首轮词头名单文件")
    parser.add_argument("--user-agent", help="真实合规 User-Agent（含联系信息）")
    parser.add_argument("--authorization-file", help="明确授权 JSON")
    parser.add_argument("--workspace-root", help="绑定 workspace 的绝对路径")
    parser.add_argument("--batch-root", help="独立批次目录名（workspace 相对路径）")
    parser.add_argument("--execution-commit", help="最终执行版本的完整 commit SHA")
    parser.add_argument("--budget-requests", type=int, help="跨恢复全批 dispatch attempt 上限（最多600）")
    mode.add_argument("--describe-binding", action="store_true", help="只读输出待确认绑定，不创建授权")
    mode.add_argument("--check-authorization", action="store_true", help="只读预检用户提供的授权，不执行")
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
        try:
            result = run_apply(args, now=lambda: datetime.now(timezone.utc).isoformat())
        except (CliError, OSError, RuntimeError, ValueError) as error:
            print(f"拒绝/停止采集: {error}", file=sys.stderr)
            return 2
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 2 if result["pausedReason"] else 0

    if args.describe_binding or args.check_authorization:
        try:
            binding = (preflight if args.check_authorization else build_binding)(
                args, repo=_repository_root())
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
