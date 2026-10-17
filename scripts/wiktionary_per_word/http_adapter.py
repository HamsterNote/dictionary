"""HTTP 适配层：流式限额、gzip 解压、请求计账、合规 UA 与串行退避。

对应 tasks 5.4 与 6.1。全部行为可离线测试：注入假 transport、假时钟、
假 streaming response，默认不发起真实网络请求。

硬性边界：

- 真实请求前必须校验**合规且带联系信息**的 User-Agent；带 ``synthetic`` 标记
  的 UA 被真实入口拒绝（本模块默认也拒绝，测试可用 ``allow_synthetic``）。
- 统一 read 协议：真实 ``urllib`` 包装暴露 ``read(size)``，测试假响应暴露
  ``reader``。适配层两者兼容，绝不因协议差异把 body 读成空。
- 所有响应（主 / TOC / 辅助 / 错误 / 重试）在同一解压后口径计账，分别记录
  网络 bytes 与解压 bytes；请求 attempt 与成功 response 分开计数。
- header 一律小写化，避免大小写绕过 ``Content-Encoding`` 预算。
- 触限立刻停止读取并关闭响应；截断内容不作为有效数据、也不进缓存。
- gzip 完整消费所有 member（含 concat / unused_data / trailer），校验
  ``decompressor.eof``；不完整/损坏归 ``incomplete-response``，不伪装成
  预算耗尽。未知 ``Content-Encoding`` 直接 fail closed，不按 identity 旁路。
- 串行、显式间隔、有限重试；429/503 尊重 ``Retry-After``，不可用时至少 5 秒
  指数退避；全部响应计入预算。dispatch 前更新时间戳，失败重试等待
  ``max(串行间隔, Retry-After/退避)``。
- 读取中途异常：保留已消费 bytes、关闭响应、标 ``consumption-uncertain``，
  **不重试**、不退预扣、不写缓存，等待下一阶段的持久账本协议接入。
"""

from __future__ import annotations

import email.utils
import re
import threading
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Final, Mapping, Protocol

DEFAULT_CHUNK_SIZE: Final = 64 * 1024
MIN_BACKOFF_SECONDS: Final = 5.0
MAX_BACKOFF_SECONDS: Final = 300.0

# 合规 UA 必须能标识采集者并提供联系信息（邮箱或 URL）。
_CONTACT_PATTERN: Final = re.compile(
    r"[^@\s]+@[^@\s]+\.[^@\s]+|https?://[^\s]+"
)
# synthetic / 本地测试标记：真实入口拒绝。
# 更完整的 reserved/本地 contact 拒绝属“授权记录”阶段（下一阶段），本轮不改，
# 以免破坏既有 REAL_LOOKING_UA 夹具与兼容性。
_SYNTHETIC_MARKERS: Final = ("synthetic", "example.invalid", "localhost")

# 支持的 Content-Encoding。除 identity 外只支持单层 gzip。
_ALLOWED_ENCODINGS: Final = ("identity", "gzip", "x-gzip")


class _Failure(Exception):
    """本模块内部错误基类。"""


class MissingUserAgentError(_Failure):
    """缺少 User-Agent，禁止真实请求。"""


class InvalidUserAgentError(_Failure):
    """User-Agent 不合规（缺联系信息或含 synthetic/保留标记）。"""


class ConcurrencyError(_Failure):
    """检测到并发请求；本适配层强制串行。"""


class PausedError(_Failure):
    """批次已因预算/不确定性暂停，禁止继续请求。"""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class TransportError(_Failure):
    """底层传输失败。**默认视为消费不确定**：不重试、不 pretend known-zero。

    只有显式的 :class:`KnownZeroTransportError`（或等价的明确 ``consumption=
    'known-zero'`` 证据）才允许有限重试；泛化 ``TransportError`` / ``TimeoutError``
    / ``OSError`` 一律 uncertain + durable pause。CLI 的 ``URLError``/timeout/
    ``OSError`` 绝不能归类为 known-zero。
    """


class KnownZeroTransportError(TransportError):
    """**显式证明零消费**的传输失败（连接在发送/接收任何字节前被拒）。

    仅当调用方能够证明“一个字节都没有发出/收到”时使用；此时可安全重试。
    不提供此显式类型时，任何传输异常都按 unknown（uncertain）处理。
    """


class BudgetPaused(_Failure):
    """本轮读取触及预算，立即停止且不再补读。"""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class RetryBudgetExhausted(_Failure):
    """logical operation 重试额度耗尽 / 批次暂停 / 字节不足：禁止重试。

    这是**控制流信号**（不是持久化失败）：调用方收到后必须停止重试并收尾，
    绝不能触发 ``journal-persist-failed`` 式 fail closed。
    """


class JournalError(_Failure):
    """持久账本写入失败：fail closed，不清 in-flight、不继续请求。"""


class RequestJournal(Protocol):
    """请求级持久账本协议（由 BatchLedger 实现）。

    - ``request_started``：dispatch **前**持久 attempt/category/in-flight。
    - ``request_accounted``：完整持久 network/decoded bytes 后才允许解析/cache；
      ``uncertain`` 表示额外消费无法确定，必须 fail closed；``complete`` 为真时
      清理 in-flight 标记。
    """

    def request_started(self, *, head: str, kind: RequestKind) -> int | None: ...

    def request_accounted(
        self,
        *,
        head: str,
        kind: RequestKind,
        network_bytes: int,
        decompressed_bytes: int,
        complete: bool,
        uncertain: bool,
        reason: str | None = None,
        request_id: int | None = None,
    ) -> None: ...


class RequestKind(str, Enum):
    """请求分类计账维度。错误/重试通过 outcome 字段区分。"""

    MAIN = "main"
    TOC = "toc"
    AUX = "aux"


class Clock(Protocol):
    """可注入时钟：真实或假时钟。"""

    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class SystemClock:
    """真实时钟。"""

    def monotonic(self) -> float:
        import time

        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        import time

        time.sleep(seconds)


class FakeClock:
    """测试用假时钟，记录全部 sleep 事件。"""

    def __init__(self, start: float = 0.0) -> None:
        self._now = start
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self._now

    def sleep(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("sleep 不允许负数")
        self.sleeps.append(seconds)
        self._now += seconds

    def advance(self, seconds: float) -> None:
        self._now += seconds


@dataclass
class RunBudget:
    """本轮累计账本（可持久化到 checkpoint）。

    网络 bytes 与实际解压 bytes 分开记录；请求 attempt 与成功 response 分开：
    ``request_count`` 统计**每一次 dispatch attempt**（含传输失败与错误响应），
    失败的 attempt 同时计入 ``error_count``，被编排重试的计入 ``retry_count``。
    """

    max_decompressed_bytes: int = 20 * 1024 * 1024
    max_distinct_heads: int = 100
    max_requests: int = 600
    decompressed_bytes: int = 0
    network_bytes: int = 0
    request_count: int = 0
    retry_count: int = 0
    error_count: int = 0
    distinct_heads_started: int = 0
    requests_by_kind: dict[str, int] = field(default_factory=dict)

    def remaining_decompressed(self) -> int:
        return max(0, self.max_decompressed_bytes - self.decompressed_bytes)

    # -- 计账原语（供下阶段持久账本协议复用）--------------------------------
    def begin_attempt(self, kind: RequestKind) -> None:
        """dispatch 前登记一次请求 attempt（与成功 response 数区分）。"""
        if self.request_count >= self.max_requests:
            raise BudgetPaused("request-budget-exhausted")
        self.request_count += 1
        self.requests_by_kind[kind.value] = self.requests_by_kind.get(kind.value, 0) + 1

    def record_response_bytes(self, *, network_bytes: int, decompressed_bytes: int) -> None:
        """记录一次已读取响应的网络/解压 bytes（不增加 attempt 数）。"""
        self.network_bytes += network_bytes
        self.decompressed_bytes += decompressed_bytes

    def note_retry(self) -> None:
        self.retry_count += 1

    def note_error(self) -> None:
        self.error_count += 1

    def to_json(self) -> dict[str, Any]:
        return {
            "max_decompressed_bytes": self.max_decompressed_bytes,
            "max_distinct_heads": self.max_distinct_heads,
            "max_requests": self.max_requests,
            "decompressed_bytes": self.decompressed_bytes,
            "network_bytes": self.network_bytes,
            "request_count": self.request_count,
            "retry_count": self.retry_count,
            "error_count": self.error_count,
            "distinct_heads_started": self.distinct_heads_started,
            "requests_by_kind": dict(self.requests_by_kind),
        }

    @classmethod
    def from_json(cls, payload: Mapping[str, Any]) -> "RunBudget":
        return cls(
            max_decompressed_bytes=int(payload["max_decompressed_bytes"]),
            max_distinct_heads=int(payload["max_distinct_heads"]),
            max_requests=int(payload.get("max_requests", 600)),
            decompressed_bytes=int(payload.get("decompressed_bytes", 0)),
            network_bytes=int(payload.get("network_bytes", 0)),
            request_count=int(payload.get("request_count", 0)),
            retry_count=int(payload.get("retry_count", 0)),
            error_count=int(payload.get("error_count", 0)),
            distinct_heads_started=int(payload.get("distinct_heads_started", 0)),
            requests_by_kind=dict(payload.get("requests_by_kind", {})),
        )


@dataclass(frozen=True, slots=True)
class ReadResult:
    """一次有界流式读取的结果。"""

    body: bytes
    network_bytes: int
    decompressed_bytes: int
    truncated: bool
    complete: bool
    limit_hit: bool
    # ``error`` 取值：None / "reader-error" / "incomplete-gzip" / "corrupt-gzip"
    error: str | None = None
    reader_error: BaseException | None = None

    @property
    def consumption_uncertain(self) -> bool:
        """读取中途异常：消费量已知但来源语义不可确认。"""
        return self.error == "reader-error"


@dataclass(slots=True)
class FakeResponse:
    """测试用假 streaming response。

    ``reader`` 是 ``(size) -> bytes`` 的读取函数；测试可用它模拟分块、
    高膨胀 gzip、恰好触限等。``status``/``headers`` 模拟 HTTP 元数据。

    为对齐统一 read 协议，本类同时提供 ``read(size)``（委托给 ``reader``），
    与真实 ``urllib`` 包装具有相同的可读接口。
    """

    status: int = 200
    headers: Mapping[str, str] = field(default_factory=dict)
    reader: Callable[[int], bytes] = lambda size: b""
    reason: str = "OK"
    closed: bool = False

    def read(self, size: int) -> bytes:
        """统一协议：与真实 wrapper 的 ``read(size)`` 一致。"""
        return self.reader(size)

    def close(self) -> None:
        self.closed = True


@dataclass(frozen=True, slots=True)
class FetchedResponse:
    """一次成功读取（未触发暂停）的响应。"""

    url: str
    kind: RequestKind
    status: int
    headers: Mapping[str, str]
    body: bytes
    network_bytes: int
    decompressed_bytes: int
    attempts: int
    retried: bool


def validate_user_agent(user_agent: str | None, *, allow_synthetic: bool = False) -> str:
    """校验合规 UA。真实入口必须 ``allow_synthetic=False``。"""
    if not user_agent or not user_agent.strip():
        raise MissingUserAgentError("必须提供带联系信息的 User-Agent")
    normalized = user_agent.strip()
    lowered = normalized.lower()
    if not allow_synthetic:
        for marker in _SYNTHETIC_MARKERS:
            if marker in lowered:
                raise InvalidUserAgentError(
                    f"User-Agent 含 synthetic/测试标记 {marker!r}，真实入口拒绝"
                )
    if not _CONTACT_PATTERN.search(normalized):
        raise InvalidUserAgentError("User-Agent 必须包含邮箱或 URL 作为联系信息")
    return normalized


def parse_retry_after(value: str | None, *, now: datetime | None = None) -> float | None:
    """解析 ``Retry-After``：整数秒或 HTTP-date。无法解析返回 None。"""
    if not value:
        return None
    raw = value.strip()
    if raw.isdigit():
        return float(raw)
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    delta = (parsed - reference).total_seconds()
    return max(0.0, delta)


def _fallback_backoff(attempt_index: int) -> float:
    """不可用时的指数退避，至少 5 秒。"""
    return min(MAX_BACKOFF_SECONDS, MIN_BACKOFF_SECONDS * (2 ** attempt_index))


def normalize_headers(headers: Mapping[str, str] | None) -> dict[str, str]:
    """把 header 名一律小写，避免大小写绕过 Content-Encoding/Retry-After。"""
    if not headers:
        return {}
    return {str(key).lower(): str(value) for key, value in headers.items()}


def _reader_for(response: Any) -> Callable[[int], bytes]:
    """统一 read 协议：优先 ``reader``（假响应），否则 ``read(size)``（真实）。"""
    reader = getattr(response, "reader", None)
    if callable(reader):
        return reader
    read = getattr(response, "read", None)
    if callable(read):
        return read
    raise TransportError("响应对象既无 reader 也无 read，无法读取 body")


def _encoding_tokens(headers: Mapping[str, str]) -> list[str]:
    raw = headers.get("content-encoding", "")
    return [token.strip().lower() for token in str(raw).split(",") if token.strip()]


class BoundedStreamReader:
    """限额流式读取，同一口径处理压缩/未压缩。

    - 读取阶段即计数网络 bytes；解压输出单独计数。
    - gzip 用 ``zlib.decompressobj`` 并设 ``max_length``，防止小输入膨胀出
      未计数的大输出；完整消费所有 member（含 concat 与 ``unused_data``），
      并以 ``decompressor.eof`` 校验 trailer 是否完整。
    - 达到限额立即停止，不额外读取补全；截断标记为不完整。
    - 读取中途异常保留已知 bytes，返回 ``reader-error``，交调用方 fail closed。
    """

    def __init__(self, chunk_size: int = DEFAULT_CHUNK_SIZE) -> None:
        self.chunk_size = chunk_size

    def read(
        self,
        reader: Callable[[int], bytes],
        *,
        remaining: int,
        gzip_encoded: bool,
    ) -> ReadResult:
        out = bytearray()
        network = 0
        produced = 0
        limit_hit = False
        complete = False
        error: str | None = None
        reader_error: BaseException | None = None
        decompressor = (
            zlib.decompressobj(16 + zlib.MAX_WBITS) if gzip_encoded else None
        )

        while True:
            budget_left = remaining - produced
            if budget_left <= 0:
                # 无法继续计账；不补读，完整性交给 eof 判定。
                limit_hit = True
                break
            if decompressor is None:
                to_read = min(self.chunk_size, budget_left)
            else:
                to_read = self.chunk_size
            try:
                chunk = reader(to_read)
            except Exception as exc:  # noqa: BLE001
                # 真实 read 异常：含 http.client.IncompleteRead / HTTPException 等
                # （非 OSError 子类）与 NetworkError。捕获普通 Exception（**不**捕获
                # BaseException，绝不吞 KeyboardInterrupt/SystemExit）；保留已消费的
                # 确定 bytes，标 reader-error，交调用方不确定暂停。
                reader_error = exc
                error = "reader-error"
                break
            if not chunk:
                # EOF：未压缩即完整；压缩必须确认 member 完整（trailer 齐全）。
                if decompressor is None:
                    complete = True
                    break
                try:
                    tail = decompressor.flush()
                    if not decompressor.eof:
                        error = "incomplete-gzip"
                        break
                except zlib.error:
                    error = "incomplete-gzip"
                    break
                room = remaining - produced
                if tail and room > 0:
                    if len(tail) > room:
                        tail = tail[:room]
                        limit_hit = True
                    out.extend(tail)
                    produced += len(tail)
                elif tail:
                    limit_hit = True
                # eof 已确认：完整 member。是否还有后续 member 未知，但流已
                # 读完（reader 返回空），故此处可判完整。
                complete = not limit_hit
                break

            network += len(chunk)
            if decompressor is None:
                room = remaining - produced
                piece = chunk[:room]
                out.extend(piece)
                produced += len(piece)
                if len(chunk) > room:
                    # 块超出额度：不补读，完整性未明。
                    limit_hit = True
                    break
                continue

            # gzip：一个 chunk 内可能含多 member 与 unused_data。
            data = chunk
            while data:
                if decompressor.eof:
                    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
                room = remaining - produced
                if room <= 0:
                    limit_hit = True
                    break
                try:
                    piece = decompressor.decompress(data, room)
                except zlib.error:
                    error = "corrupt-gzip"
                    break
                if piece:
                    out.extend(piece)
                    produced += len(piece)
                if decompressor.eof:
                    if decompressor.unused_data:
                        # concat member：继续处理剩余字节。
                        data = decompressor.unused_data
                        continue
                    data = b""
                    break
                if decompressor.unconsumed_tail:
                    data = decompressor.unconsumed_tail
                    continue
                data = b""
                break
            if error or limit_hit:
                break

        # 注意：触限时**绝不**因为 decompressor.eof 而判 complete。decompressor.eof
        # 只说明当前 gzip member 结束，并不证明 HTTP body 已 EOF——后续 chunk 仍可能
        # 有下一个 member（concat）。未读到 reader 返回 b""（真 EOF）之前，
        # complete 必须为 False：立即 close/pause、不补读、不 parse/cache。
        return ReadResult(
            body=bytes(out),
            network_bytes=network,
            decompressed_bytes=produced,
            truncated=not complete or error is not None,
            complete=complete and error is None,
            limit_hit=limit_hit,
            error=error,
            reader_error=reader_error,
        )


class HttpAdapter:
    """串行 HTTP 适配层。

    ``transport`` 是 ``(url, headers) -> FakeResponse-like`` 的可注入函数。
    真实实现可在第 10 组授权后由 ``urllib`` 提供；本阶段默认只接受注入。
    """

    def __init__(
        self,
        *,
        transport: Callable[[str, Mapping[str, str]], Any],
        budget: RunBudget,
        clock: Clock | None = None,
        user_agent: str | None = None,
        interval_seconds: float = 0.0,
        max_retries: int = 2,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        retry_statuses: tuple[int, ...] = (429, 503),
        allow_synthetic_user_agent: bool = False,
        journal: RequestJournal | None = None,
    ) -> None:
        self._transport = transport
        self.budget = budget
        self.clock = clock or SystemClock()
        self.journal = journal
        self.user_agent = validate_user_agent(
            user_agent, allow_synthetic=allow_synthetic_user_agent
        )
        if interval_seconds < 0:
            raise ValueError("interval_seconds 不能为负")
        if max_retries < 0:
            raise ValueError("max_retries 不能为负")
        self.interval_seconds = interval_seconds
        self.max_retries = max_retries
        self.retry_statuses = retry_statuses
        self._reader = BoundedStreamReader(chunk_size=chunk_size)
        self._lock = threading.Lock()
        self._in_flight = False
        # A new adapter over consumed state conservatively waits one full interval;
        # a process restart must not erase the previous dispatch's rate limit.
        self._last_request_at: float | None = (
            self.clock.monotonic() if budget.request_count else None
        )
        self.pause_reason: str | None = None
        # 下阶段持久账本协议接入用的公开状态（本轮只暴露，不落盘）。
        self.consumption_uncertain = False
        self.last_known_network_bytes = 0
        self.last_known_decompressed_bytes = 0
        self.last_response_complete: bool | None = None
        # best-effort close 失败原因（不得覆盖计账结论）。
        self.last_close_error: str | None = None
        # 无持久账本时的本地 operation 重试计数（journal 存在时由账本负责）。
        self._local_operation_retries: dict[tuple[str, str], int] = {}

    # ------------------------------------------------------------------
    @property
    def paused(self) -> bool:
        return self.pause_reason is not None

    def _pause(self, reason: str) -> None:
        self.pause_reason = reason

    def _respect_interval(self) -> None:
        if self.interval_seconds <= 0 or self._last_request_at is None:
            return
        elapsed = self.clock.monotonic() - self._last_request_at
        wait = self.interval_seconds - elapsed
        if wait > 0:
            self.clock.sleep(wait)

    def _sleep_retry(self, base: float) -> None:
        """重试等待：不小于串行间隔，且不小于 Retry-After/退避。"""
        wait = max(self.interval_seconds, base)
        self.clock.sleep(wait)
        # loop 顶部的 _respect_interval 会用 _last_request_at 复核；因为等待
        # 已 >= interval，届时不会重复 sleep。

    def _journal(self, method: str, /, **kwargs: Any) -> Any:
        """调用持久账本 hook；写入失败即 fail closed，不清 in-flight。"""
        journal = self.journal
        if journal is None:
            return None
        try:
            return getattr(journal, method)(**kwargs)
        except Exception as error:  # noqa: BLE001 - 任何持久化失败都 fail closed
            self._pause("journal-persist-failed")
            raise JournalError(f"持久账本写入失败({method}): {error}") from error

    # ------------------------------------------------------------------
    # logical operation 重试额度（HTTP + API 共享同一 operation 上限）
    # ------------------------------------------------------------------
    def claim_operation_retry(self, *, head: str, kind: RequestKind, reason: str) -> int | None:
        """为当前 logical operation 声明一次重试。

        返回重试序号（>=1，可用于退避）或 ``None`` 表示额度耗尽/批次暂停，**必须
        停止重试**。journal 存在时由持久账本 ``claim_retry`` 在 sleep/dispatch 前
        持久；持久失败抛 :class:`JournalError`（此时不得 dispatch）。
        """
        journal = self.journal
        if journal is not None and hasattr(journal, "claim_retry"):
            try:
                return journal.claim_retry(head=head, kind=kind, reason=reason)
            except RetryBudgetExhausted:
                return None
            except Exception as error:  # noqa: BLE001 - 持久失败 fail closed
                self._pause("journal-persist-failed")
                raise JournalError(f"claim_retry 持久失败: {error}") from error
        key = (head, getattr(kind, "value", str(kind)))
        count = self._local_operation_retries.get(key, 0) + 1
        if count > self.max_retries:
            return None
        self._local_operation_retries[key] = count
        self.budget.note_retry()
        return count

    def operation_retry_wait(self, retry_index: int, *, retry_after: float | None = None) -> None:
        """logical operation 重试等待：不小于串行间隔，也不小于退避/Retry-After。"""
        base = _fallback_backoff(max(0, retry_index - 1))
        wait = max(self.interval_seconds, base, retry_after or 0.0)
        self.clock.sleep(wait)

    def fetch(
        self,
        url: str,
        *,
        kind: RequestKind,
        accept_gzip: bool = True,
        head: str = "",
    ) -> FetchedResponse:
        """串行抓取一个 URL，返回有界读取结果。

        触限时抛出 :class:`BudgetPaused`，并把已消耗 bytes 记入预算。
        """
        if self.paused:
            raise PausedError(self.pause_reason or "paused")

        # 串行保证：禁止并发与同线程重入。
        if not self._lock.acquire(blocking=False):
            raise ConcurrencyError("检测到并发请求，本适配层强制串行")
        self._in_flight = True
        try:
            return self._fetch_locked(url, kind=kind, accept_gzip=accept_gzip, head=head)
        finally:
            self._in_flight = False
            self._lock.release()

    # ------------------------------------------------------------------
    def _fetch_locked(
        self, url: str, *, kind: RequestKind, accept_gzip: bool, head: str = ""
    ) -> FetchedResponse:
        attempts = 0
        headers: Mapping[str, str] = {"User-Agent": self.user_agent, "Accept-Encoding": "gzip"}
        if not accept_gzip:
            headers = {"User-Agent": self.user_agent, "Accept-Encoding": "identity"}

        while True:
            # 预算前置检查：额度耗尽就不再发请求（不补辅助/重试）。
            if self.budget.request_count >= self.budget.max_requests:
                self._pause("request-budget-exhausted")
                raise BudgetPaused("request-budget-exhausted")
            if self.budget.remaining_decompressed() <= 0:
                self._pause("decompressed-budget-exhausted")
                raise BudgetPaused("decompressed-budget-exhausted")

            self._respect_interval()
            attempt_headers = dict(headers)
            attempts += 1
            self.budget.begin_attempt(kind)
            # dispatch 前更新时间戳：即使本次传输失败，间隔也从这里计算。
            self._last_request_at = self.clock.monotonic()
            # dispatch **前**持久 attempt/category/in-flight；写入失败 fail closed。
            request_id = self._journal("request_started", head=head, kind=kind)
            try:
                response = self._transport(url, attempt_headers)
            except KnownZeroTransportError as error:
                # **显式证明零消费**：可安全重试。
                self.budget.note_error()
                self._journal(
                    "request_accounted",
                    head=head,
                    kind=kind,
                    network_bytes=0,
                    decompressed_bytes=0,
                    complete=False,
                    uncertain=False,
                    reason="transport-known-zero",
                    request_id=request_id,
                )
                if attempts > self.max_retries:
                    raise TransportError(f"known-zero 传输失败: {error}") from error
                retry_index = self.claim_operation_retry(
                    head=head, kind=kind, reason="transport-known-zero"
                )
                if retry_index is None:
                    raise TransportError(f"known-zero 重试额度耗尽: {error}") from error
                self.operation_retry_wait(retry_index)
                continue
            except (TransportError, TimeoutError, OSError) as error:
                # 泛化传输异常 = **消费不确定**（无法证明零消费）：保留可证的已知
                # 消费、标 uncertain、durable 暂停并抛出，**禁止重试**。
                # CLI 的 URLError/timeout/OSError 走此分支，绝不当 known-zero。
                self.budget.note_error()
                self.consumption_uncertain = True
                self._journal(
                    "request_accounted",
                    head=head,
                    kind=kind,
                    network_bytes=0,
                    decompressed_bytes=0,
                    complete=False,
                    uncertain=True,
                    reason="transport-unknown",
                    request_id=request_id,
                )
                self._pause("consumption-uncertain")
                raise TransportError(
                    f"传输异常（消费不确定，禁止重试）: {error}"
                ) from error
            except Exception as error:  # noqa: BLE001
                # 未预期的 dispatch 异常：同样无法证明零消费，立即 durable 暂停并
                # 抛出，**禁止重试**（不能一边 uncertain 一边重试）。
                self.budget.note_error()
                self.consumption_uncertain = True
                self._journal(
                    "request_accounted",
                    head=head,
                    kind=kind,
                    network_bytes=0,
                    decompressed_bytes=0,
                    complete=False,
                    uncertain=True,
                    reason="transport-unknown",
                    request_id=request_id,
                )
                self._pause("consumption-uncertain")
                raise TransportError(f"未知传输异常: {error}") from error

            status = getattr(response, "status", 200)
            response_headers = normalize_headers(getattr(response, "headers", {}) or {})

            if 300 <= status < 400:
                # 重定向不自动跟随（NoRedirect）：仍作为**单个**响应完整有界读取并
                # 计账，然后失败——绝不跟第二 host、绝不静默当成功。
                self.budget.note_error()
                self._consume_and_account(
                    response,
                    head=head,
                    kind=kind,
                    headers=response_headers,
                    accept_gzip=accept_gzip,
                    request_id=request_id,
                )
                raise TransportError(f"HTTP {status} 重定向未跟随（拒绝自动 follow）")

            if status in self.retry_statuses:
                self.budget.note_error()
                # 错误/限流响应体同样计入预算，即使随后不再重试。
                self._consume_and_account(
                    response,
                    head=head,
                    kind=kind,
                    headers=response_headers,
                    accept_gzip=accept_gzip,
                    request_id=request_id,
                )
                if attempts > self.max_retries:
                    raise TransportError(f"上游持续不可用: HTTP {status}")
                retry_index = self.claim_operation_retry(
                    head=head, kind=kind, reason=f"http-{status}"
                )
                if retry_index is None:
                    raise TransportError(f"重试额度耗尽: HTTP {status}")
                wait = parse_retry_after(response_headers.get("retry-after"))
                if wait is None:
                    wait = _fallback_backoff(attempts - 1)
                else:
                    wait = max(MIN_BACKOFF_SECONDS, wait)
                self.operation_retry_wait(retry_index, retry_after=wait)
                continue

            if status >= 400:
                self.budget.note_error()
                self._consume_and_account(
                    response,
                    head=head,
                    kind=kind,
                    headers=response_headers,
                    accept_gzip=accept_gzip,
                    request_id=request_id,
                )
                raise TransportError(f"HTTP {status}")

            result = self._consume_and_account(
                response,
                head=head,
                kind=kind,
                headers=response_headers,
                accept_gzip=accept_gzip,
                request_id=request_id,
            )
            return FetchedResponse(
                url=url,
                kind=kind,
                status=status,
                headers=response_headers,
                body=result.body,
                network_bytes=result.network_bytes,
                decompressed_bytes=result.decompressed_bytes,
                attempts=attempts,
                retried=attempts > 1,
            )

    # ------------------------------------------------------------------
    def _supported_encoding(self, headers: Mapping[str, str]) -> tuple[bool, bool, str | None]:
        """返回 ``(是否支持, 是否 gzip, 拒绝原因)``。

        未知/多层/不支持的 ``Content-Encoding`` 直接 fail closed，绝不当作
        identity 旁路（否则会漏计真实解压量）。
        """
        tokens = _encoding_tokens(headers)
        if not tokens:
            return True, False, None
        non_identity = [token for token in tokens if token != "identity"]
        if any(token not in _ALLOWED_ENCODINGS for token in tokens):
            return False, False, "unsupported-encoding"
        if len(non_identity) > 1:
            # 多层编码（如 gzip,gzip）本轮不支持，fail closed 不静默。
            return False, False, "unsupported-encoding"
        return True, bool(non_identity), None

    def _consume_and_account(
        self,
        response: Any,
        *,
        head: str,
        kind: RequestKind,
        headers: Mapping[str, str],
        accept_gzip: bool,
        request_id: int | None = None,
    ) -> ReadResult:
        try:
            supported, gzip_encoded, reject_reason = self._supported_encoding(headers)
        except Exception:
            supported, gzip_encoded, reject_reason = False, False, "unsupported-encoding"
        if not supported:
            # 未知编码：关闭响应并暂停，不读 body、不缓存、不按 identity 计账。
            self.consumption_uncertain = False
            self._close(response)
            self._journal(
                "request_accounted",
                head=head,
                kind=kind,
                network_bytes=0,
                decompressed_bytes=0,
                complete=False,
                uncertain=False,
                reason=reject_reason or "unsupported-encoding",
                request_id=request_id,
            )
            self._pause(reject_reason or "unsupported-encoding")
            raise BudgetPaused(reject_reason or "unsupported-encoding")

        remaining = self.budget.remaining_decompressed()
        try:
            reader = _reader_for(response)
        except BaseException:
            # 响应协议缺失：先关闭再抛出，绝不留未关闭响应。
            self._close(response)
            raise
        try:
            result = self._reader.read(reader, remaining=remaining, gzip_encoded=gzip_encoded)
        except BaseException:
            # 任何未预期异常也必须关闭响应。
            self._close(response)
            raise
        # 无论是否触限，已消耗的 bytes 都保留计账。
        try:
            self.budget.record_response_bytes(
                network_bytes=result.network_bytes,
                decompressed_bytes=result.decompressed_bytes,
            )
        except BaseException:
            self._close(response)
            raise
        self.last_known_network_bytes = result.network_bytes
        self.last_known_decompressed_bytes = result.decompressed_bytes
        self._last_request_at = self.clock.monotonic()

        if result.consumption_uncertain:
            # 读取中途异常：已知 bytes 保留，标 uncertain，不重试、不退预扣。
            self.consumption_uncertain = True
            self.last_response_complete = False
            self._close(response)
            # 先持久已知消费与 uncertain，再暂停；持久失败由 _journal fail closed。
            self._journal(
                "request_accounted",
                head=head,
                kind=kind,
                network_bytes=result.network_bytes,
                decompressed_bytes=result.decompressed_bytes,
                complete=False,
                uncertain=True,
                reason="consumption-uncertain",
                request_id=request_id,
            )
            self._pause("consumption-uncertain")
            raise BudgetPaused("consumption-uncertain")

        if result.error in ("corrupt-gzip", "incomplete-gzip"):
            # 损坏/trailer 截断：不属于预算耗尽，归不完整响应。
            self.last_response_complete = False
            self._close(response)
            self._journal(
                "request_accounted",
                head=head,
                kind=kind,
                network_bytes=result.network_bytes,
                decompressed_bytes=result.decompressed_bytes,
                complete=False,
                uncertain=False,
                reason="incomplete-response",
                request_id=request_id,
            )
            self._pause("incomplete-response")
            raise BudgetPaused("incomplete-response")

        if result.limit_hit:
            # 触限：立即 close/pause，不补读；未证 EOF，complete 恒为 False。
            self.last_response_complete = False
            self._close(response)
            self._journal(
                "request_accounted",
                head=head,
                kind=kind,
                network_bytes=result.network_bytes,
                decompressed_bytes=result.decompressed_bytes,
                complete=False,
                uncertain=False,
                reason="decompressed-budget-exhausted",
                request_id=request_id,
            )
            self._pause("decompressed-budget-exhausted")
            raise BudgetPaused("decompressed-budget-exhausted")

        if not result.complete:
            self.last_response_complete = False
            self._close(response)
            self._journal(
                "request_accounted",
                head=head,
                kind=kind,
                network_bytes=result.network_bytes,
                decompressed_bytes=result.decompressed_bytes,
                complete=False,
                uncertain=False,
                reason="incomplete-response",
                request_id=request_id,
            )
            self._pause("incomplete-response")
            raise BudgetPaused("incomplete-response")

        # 完整响应：持久完整 bytes 成功后，才允许解析/cache 并清理 in-flight。
        self.last_response_complete = True
        self._close(response)
        self._journal(
            "request_accounted",
            head=head,
            kind=kind,
            network_bytes=result.network_bytes,
            decompressed_bytes=result.decompressed_bytes,
            complete=True,
            uncertain=False,
            request_id=request_id,
        )
        return result

    def _close(self, response: Any) -> None:
        """尽力关闭响应；close 自身抛错也不得掩盖已计账结果或抢占 accounted。

        真实 ``http.client`` 响应在异常后 close 可能再抛 OSError；这里 best effort
        吞掉普通异常并记录原因，绝不让它冒泡覆盖已知 bytes / uncertain 结算。
        """
        close = getattr(response, "close", None)
        if callable(close):
            try:
                close()
            except Exception as error:  # noqa: BLE001 - close 失败不改变计账结论
                self.last_close_error = f"{type(error).__name__}: {error}"
