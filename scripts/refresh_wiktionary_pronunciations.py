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

from wiktionary_per_word.action_api import DEFAULT_API_ENDPOINT
from wiktionary_per_word.evidence import ResponseCache
from wiktionary_per_word.http_adapter import (
    HttpAdapter,
    InvalidUserAgentError,
    MissingUserAgentError,
    TransportError,
    validate_user_agent,
)
from wiktionary_per_word.ledger import (
    AuthorizationError,
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


def load_authorization(path: Path) -> BatchAuthorization:
    if not path.exists():
        raise CliError(f"授权文件不存在: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    authorization = BatchAuthorization(
        distinct_heads=int(payload.get("distinctHeads", 0)),
        decompressed_bytes=int(payload.get("decompressedBytes", 0)),
        granted=bool(payload.get("granted", False)),
        source=str(payload.get("source", "")),
        synthetic=bool(payload.get("synthetic", False)),
    )
    # 真实入口：拒绝 synthetic 授权。
    authorization.validate(allow_synthetic=False)
    return authorization


def validate_apply_config(args: argparse.Namespace) -> ApplyConfig:
    """校验 --apply 所需的一切。任何缺失/无效都抛 CliError，绝不联网。"""
    if not args.heads_file:
        raise CliError("--apply 必须提供 --heads-file 名单")
    heads_file = Path(args.heads_file)
    _load_heads(heads_file)  # 校验存在且非空

    if not args.user_agent:
        raise CliError("--apply 必须提供带联系信息的真实 --user-agent")
    try:
        # 缺联系信息或含 synthetic/测试标记时抛错。
        validate_user_agent(args.user_agent, allow_synthetic=False)
    except (MissingUserAgentError, InvalidUserAgentError) as error:
        raise CliError(f"User-Agent 校验失败: {error}") from error

    if not args.authorization_file:
        raise CliError("--apply 必须提供 --authorization-file 明确授权")
    try:
        authorization = load_authorization(Path(args.authorization_file))
    except AuthorizationError as error:
        raise CliError(f"授权校验失败: {error}") from error

    if not args.budget_heads or args.budget_heads <= 0:
        raise CliError("--apply 必须提供正的 --budget-heads")
    if not args.budget_decompressed_mib or args.budget_decompressed_mib <= 0:
        raise CliError("--apply 必须提供正的 --budget-decompressed-mib")

    budget_bytes = int(args.budget_decompressed_mib * 1024 * 1024)
    if authorization.decompressed_bytes != budget_bytes:
        raise CliError("授权额度与显式预算不一致，拒绝执行")
    if authorization.distinct_heads != args.budget_heads:
        raise CliError("授权词头额度与显式预算不一致，拒绝执行")

    if not args.checkpoint:
        raise CliError("--apply 必须提供 --checkpoint 以持久记账")
    if not args.cache_dir:
        raise CliError("--apply 必须提供 --cache-dir")

    return ApplyConfig(
        heads_file=heads_file,
        user_agent=args.user_agent,
        budget_heads=args.budget_heads,
        budget_decompressed_bytes=budget_bytes,
        authorization=authorization,
        interval_seconds=args.interval_seconds,
        max_retries=args.max_retries,
        checkpoint=Path(args.checkpoint),
        cache_dir=Path(args.cache_dir),
        endpoint=args.endpoint,
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
        if "json" in entry.content_type.lower():
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
    """真实采集（须第 10 组授权）。校验已通过才会到这里。

    已有 checkpoint：**绝不 create 覆盖**，加载并显式 resume 续作；否则新建。
    完整授权绑定与 CLI 参数严格校验属下一阶段。
    """
    heads = _load_heads(config.heads_file)
    if config.checkpoint.exists():
        ledger = BatchLedger.load(config.checkpoint)
        ledger.resume()
    else:
        ledger = BatchLedger.create(
            batch_id="first-round",
            authorization=config.authorization,
            path=config.checkpoint,
            created_at=now(),
        )
    # 适配层与账本共享同一预算对象，请求计账进入持久账本。
    adapter = HttpAdapter(
        transport=_build_urllib_transport(),
        budget=ledger.budget,
        user_agent=config.user_agent,
        interval_seconds=config.interval_seconds,
        max_retries=config.max_retries,
    )
    cache = ResponseCache(directory=config.cache_dir)
    from wiktionary_per_word.collector import Collector
    from wiktionary_per_word.evidence import EvidenceLedger

    collector = Collector(
        ledger=ledger,
        adapter=adapter,
        cache=cache,
        evidence_ledger=EvidenceLedger(),
        now=now,
        endpoint=config.endpoint,
    )
    collector.run_batch(heads)


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
        # NO-GO 守卫：strict authorization（caps / config binding / registry / flock /
        # CAS）尚未实现，真实 `--apply` 必须**显式拒绝**，而不是靠流程约定。
        # Phase B（严格授权）独立实施前，这里硬性禁止真实采集。
        print(
            "拒绝真实采集: strict authorization 尚未实现（NO-GO）；"
            "本轮 --apply 明确禁用，请等待 Phase B 严格授权实现",
            file=sys.stderr,
        )
        return 2

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
