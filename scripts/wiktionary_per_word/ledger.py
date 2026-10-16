"""持久账本 / checkpoint / 逐词状态机 / 请求级持久协议。

对应 tasks 6.2 与 6.3，以及 oracle 问题 3/4/5/7/9。与 ``http_adapter.RunBudget``
配合，实现：

- distinct head **开始前**持久预扣；首轮最多开始 100 词。
- 失败 / 缺页 / 无合格读法都计入已处理 distinct heads。
- 同词重试不增加 distinct，但响应照常计费（由 adapter/budget 负责）。
- 任一预算触限后同批保持暂停，恢复不能绕过；不自动补辅助/重试、不自动开新 run。
- checkpoint 原子持久化，恢复同批累计不 reset；40 词 / 8 MiB 从原累计继续。
- 新建批次**拒绝已存在的 checkpoint 路径**（绝不覆盖旧批次、绝不清零）。
- 已加载的账本 ``resumable=False``，未经 ``resume()`` 不得 ``start_word`` /
  ``assert_can_request``；in-flight 或请求级未清标记时 fail closed。
- 请求级持久协议（:class:`HttpAdapter` journal）：dispatch 前持久
  attempt/category/in-flight；已知 network/decoded bytes 完整持久后才解析/cache；
  无法确定额外消费时 fail closed 且不清理 in-flight。
- schema / extractor / tag-rule 版本改变或升级时拒绝恢复，更不允许清零。
- checkpoint 严格不变量：授权额度精确匹配、计数为非负 int（非 bool）、started
  集合一致、触限必须有合适暂停态、请求分类基本一致；**绝不修值/清零/取大**。
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Final, Mapping

from . import EXTRACTOR_VERSION, SCHEMA_VERSION, TAG_RULE_VERSION
from .http_adapter import RequestKind, RetryBudgetExhausted, RunBudget

# 触限 / 消费不确定 / 结构性失败型暂停：恢复不得绕过（durable pause）。
# ``unsupported-encoding`` / ``incomplete-response`` 同样必须持久暂停，不能只靠
# 未清 ``activeRequest`` 在重启后 fail closed。
BUDGET_PAUSE_REASONS: Final = frozenset(
    {
        "distinct-head-budget",
        "decompressed-budget-exhausted",
        "consumption-uncertain",
        "unsupported-encoding",
        "incomplete-response",
        "journal-persist-failed",
    }
)


class VersionMismatch(RuntimeError):
    """checkpoint 版本与运行版本不一致，拒绝恢复（不重置）。"""


class ResumeRejected(RuntimeError):
    """恢复被拒绝（触限暂停 / 消费不确定 / 未经 resume）。"""


class AuthorizationError(RuntimeError):
    """缺少或使用了无效/合成授权。"""


class CheckpointInvariantError(RuntimeError):
    """checkpoint 不变量被破坏：拒绝加载，绝不修值/清零/取大。"""


class WordStatus(str, Enum):
    QUEUED = "queued"
    IN_FLIGHT = "in-flight"
    EXTRACTED = "extracted"
    MISSING = "missing"
    NO_QUALIFIED = "no-qualified"
    UNRESOLVED = "unresolved"
    FAILED = "failed"
    PAUSED = "paused"
    REPORTED = "reported"


# 计入 distinct head 的终态。
TERMINAL_STATUSES: Final = frozenset(
    {
        WordStatus.EXTRACTED,
        WordStatus.MISSING,
        WordStatus.NO_QUALIFIED,
        WordStatus.UNRESOLVED,
        WordStatus.FAILED,
    }
)


@dataclass
class BatchAuthorization:
    """一次批次的明确授权额度。真实入口拒绝 synthetic。"""

    distinct_heads: int
    decompressed_bytes: int
    granted: bool
    source: str
    synthetic: bool = False

    def validate(self, *, allow_synthetic: bool = False) -> None:
        if not self.granted:
            raise AuthorizationError("授权未授予")
        if not self.source:
            raise AuthorizationError("授权必须有来源说明")
        if self.synthetic and not allow_synthetic:
            raise AuthorizationError("synthetic 授权不能作为真实许可")
        if self.distinct_heads <= 0 or self.decompressed_bytes <= 0:
            raise AuthorizationError("授权额度必须为正")

    def to_json(self) -> dict[str, Any]:
        return {
            "distinctHeads": self.distinct_heads,
            "decompressedBytes": self.decompressed_bytes,
            "granted": self.granted,
            "source": self.source,
            "synthetic": self.synthetic,
        }


@dataclass
class WordEntry:
    head: str
    status: WordStatus = WordStatus.QUEUED
    attempts: int = 0
    started: bool = False
    note: str | None = None
    evidence_ids: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "head": self.head,
            "status": self.status.value,
            "attempts": self.attempts,
            "started": self.started,
            "note": self.note,
            "evidenceIds": list(self.evidence_ids),
        }

    @classmethod
    def from_json(cls, payload: Mapping[str, Any]) -> "WordEntry":
        head = payload.get("head")
        if not isinstance(head, str) or not head:
            raise CheckpointInvariantError("word.head 必须是非空字符串")
        status_raw = payload.get("status", "queued")
        try:
            status = WordStatus(status_raw)
        except ValueError as error:
            raise CheckpointInvariantError(f"非法 word.status: {status_raw!r}") from error
        attempts = _strict_non_negative_int(payload.get("attempts", 0), "word.attempts")
        started = payload.get("started", False)
        if not isinstance(started, bool):
            raise CheckpointInvariantError("word.started 必须是布尔值")
        note = payload.get("note")
        if note is not None and not isinstance(note, str):
            raise CheckpointInvariantError("word.note 必须是字符串或 null")
        evidence_ids = payload.get("evidenceIds", [])
        if not isinstance(evidence_ids, list) or any(
            not isinstance(item, str) for item in evidence_ids
        ):
            raise CheckpointInvariantError("word.evidenceIds 必须是字符串数组")
        return cls(
            head=head,
            status=status,
            attempts=attempts,
            started=started,
            note=note,
            evidence_ids=list(evidence_ids),
        )


def _strict_non_negative_int(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CheckpointInvariantError(f"{path} 必须是非负整数（且非布尔），实为 {value!r}")
    return value


@dataclass
class BatchCheckpoint:
    batch_id: str
    authorization: BatchAuthorization
    budget: RunBudget = field(default_factory=RunBudget)
    words: dict[str, WordEntry] = field(default_factory=dict)
    schema_version: str = SCHEMA_VERSION
    extractor_version: str = EXTRACTOR_VERSION
    tag_rule_version: str = TAG_RULE_VERSION
    pause_reason: str | None = None
    pause_detail: str | None = None
    active_request: dict[str, Any] | None = None
    # 请求级单调序号：request_started 自增，accounted 校验 id 匹配，防止清错请求。
    request_seq: int = 0
    # logical operation 重试上限（由 CLI config.max_retries 落盘，resume 不重置）。
    retry_limit: int = 2
    # logical operation 持久重试计数：key -> {operationId, head, kind, attempt, retries}。
    operations: dict[str, dict[str, Any]] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""

    # ------------------------------------------------------------------
    def to_json(self) -> dict[str, Any]:
        return {
            "batchId": self.batch_id,
            "authorization": self.authorization.to_json(),
            "budget": self.budget.to_json(),
            "words": {head: entry.to_json() for head, entry in self.words.items()},
            "schemaVersion": self.schema_version,
            "extractorVersion": self.extractor_version,
            "tagRuleVersion": self.tag_rule_version,
            "pauseReason": self.pause_reason,
            "pauseDetail": self.pause_detail,
            "activeRequest": self.active_request,
            "requestSeq": self.request_seq,
            "retryLimit": self.retry_limit,
            "operations": {key: dict(value) for key, value in self.operations.items()},
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    @classmethod
    def from_json(
        cls,
        payload: Mapping[str, Any],
        *,
        expected_schema: str = SCHEMA_VERSION,
        expected_extractor: str = EXTRACTOR_VERSION,
        expected_tag_rule: str = TAG_RULE_VERSION,
    ) -> "BatchCheckpoint":
        schema = str(payload.get("schemaVersion", ""))
        extractor = str(payload.get("extractorVersion", ""))
        tag_rule = str(payload.get("tagRuleVersion", ""))
        if schema != expected_schema or extractor != expected_extractor or tag_rule != expected_tag_rule:
            raise VersionMismatch(
                "checkpoint 版本与运行版本不一致，拒绝恢复："
                f"schema {schema!r} extractor {extractor!r} tagRule {tag_rule!r}"
            )
        auth_payload = payload.get("authorization", {})
        authorization = _parse_authorization(auth_payload)
        budget = _parse_budget(payload.get("budget", {}))
        words_payload = payload.get("words", {})
        if not isinstance(words_payload, dict):
            raise CheckpointInvariantError("checkpoint.words 必须是对象")
        words: dict[str, WordEntry] = {}
        for head, entry in words_payload.items():
            if not isinstance(head, str):
                raise CheckpointInvariantError("checkpoint.words 的 key 必须是字符串")
            parsed = WordEntry.from_json(entry)
            if parsed.head != head:
                raise CheckpointInvariantError(
                    f"checkpoint.words[{head!r}] 的 head 字段不一致: {parsed.head!r}"
                )
            words[head] = parsed

        pause_reason = payload.get("pauseReason")
        if pause_reason is not None and not isinstance(pause_reason, str):
            raise CheckpointInvariantError("pauseReason 必须是字符串或 null")
        active_request = payload.get("activeRequest")
        if active_request is not None and not isinstance(active_request, dict):
            raise CheckpointInvariantError("activeRequest 必须是对象或 null")
        request_seq = _strict_non_negative_int(payload.get("requestSeq", 0), "requestSeq")
        retry_limit = _strict_non_negative_int(payload.get("retryLimit", 2), "retryLimit")
        operations_payload = payload.get("operations", {})
        if not isinstance(operations_payload, Mapping):
            raise CheckpointInvariantError("operations 必须是对象")
        operations: dict[str, dict[str, Any]] = {}
        for key, value in operations_payload.items():
            if not isinstance(key, str) or not isinstance(value, Mapping):
                raise CheckpointInvariantError("operations 的 key/值结构异常")
            operations[key] = {
                "operationId": _strict_non_negative_int(
                    value.get("operationId", 0), f"operations[{key}].operationId"
                ),
                "head": str(value.get("head", "")),
                "kind": str(value.get("kind", "")),
                "attempt": _strict_non_negative_int(
                    value.get("attempt", 0), f"operations[{key}].attempt"
                ),
                "retries": _strict_non_negative_int(
                    value.get("retries", 0), f"operations[{key}].retries"
                ),
            }

        checkpoint = cls(
            batch_id=str(payload["batchId"]),
            authorization=authorization,
            budget=budget,
            words=words,
            schema_version=schema,
            extractor_version=extractor,
            tag_rule_version=tag_rule,
            pause_reason=pause_reason,
            pause_detail=payload.get("pauseDetail"),
            active_request=dict(active_request) if active_request is not None else None,
            request_seq=request_seq,
            retry_limit=retry_limit,
            operations=operations,
            created_at=str(payload.get("createdAt", "")),
            updated_at=str(payload.get("updatedAt", "")),
        )
        _validate_checkpoint_invariants(checkpoint)
        return checkpoint


def _parse_authorization(payload: Any) -> BatchAuthorization:
    if not isinstance(payload, Mapping):
        raise CheckpointInvariantError("authorization 必须是对象")
    distinct = _strict_non_negative_int(payload.get("distinctHeads", 0), "authorization.distinctHeads")
    decompressed = _strict_non_negative_int(
        payload.get("decompressedBytes", 0), "authorization.decompressedBytes"
    )
    granted = payload.get("granted", False)
    synthetic = payload.get("synthetic", False)
    source = payload.get("source", "")
    if not isinstance(granted, bool):
        raise CheckpointInvariantError("authorization.granted 必须是布尔值")
    if not isinstance(synthetic, bool):
        raise CheckpointInvariantError("authorization.synthetic 必须是布尔值")
    if not isinstance(source, str):
        raise CheckpointInvariantError("authorization.source 必须是字符串")
    return BatchAuthorization(
        distinct_heads=distinct,
        decompressed_bytes=decompressed,
        granted=granted,
        source=source,
        synthetic=synthetic,
    )


def _parse_budget(payload: Any) -> RunBudget:
    if not isinstance(payload, Mapping):
        raise CheckpointInvariantError("budget 必须是对象")
    requests_by_kind = payload.get("requests_by_kind", {})
    if not isinstance(requests_by_kind, Mapping):
        raise CheckpointInvariantError("budget.requests_by_kind 必须是对象")
    kinds: dict[str, int] = {}
    for key, value in requests_by_kind.items():
        if not isinstance(key, str):
            raise CheckpointInvariantError("budget.requests_by_kind 的 key 必须是字符串")
        kinds[key] = _strict_non_negative_int(value, f"budget.requests_by_kind[{key}]")
    return RunBudget(
        max_decompressed_bytes=_strict_non_negative_int(
            payload.get("max_decompressed_bytes", 0), "budget.max_decompressed_bytes"
        ),
        max_distinct_heads=_strict_non_negative_int(
            payload.get("max_distinct_heads", 0), "budget.max_distinct_heads"
        ),
        decompressed_bytes=_strict_non_negative_int(
            payload.get("decompressed_bytes", 0), "budget.decompressed_bytes"
        ),
        network_bytes=_strict_non_negative_int(
            payload.get("network_bytes", 0), "budget.network_bytes"
        ),
        request_count=_strict_non_negative_int(
            payload.get("request_count", 0), "budget.request_count"
        ),
        retry_count=_strict_non_negative_int(payload.get("retry_count", 0), "budget.retry_count"),
        error_count=_strict_non_negative_int(payload.get("error_count", 0), "budget.error_count"),
        distinct_heads_started=_strict_non_negative_int(
            payload.get("distinct_heads_started", 0), "budget.distinct_heads_started"
        ),
        requests_by_kind=kinds,
    )


def _validate_checkpoint_invariants(checkpoint: BatchCheckpoint) -> None:
    """严格不变量：违反即拒绝加载，绝不修值/清零/取大。"""
    auth = checkpoint.authorization
    budget = checkpoint.budget

    # 授权额度必须精确匹配（upper bound exact）。
    if budget.max_decompressed_bytes != auth.decompressed_bytes:
        raise CheckpointInvariantError(
            "budget.max_decompressed_bytes 必须精确等于授权额度"
            f"（{budget.max_decompressed_bytes} != {auth.decompressed_bytes}）"
        )
    if budget.max_distinct_heads != auth.distinct_heads:
        raise CheckpointInvariantError(
            "budget.max_distinct_heads 必须精确等于授权额度"
            f"（{budget.max_distinct_heads} != {auth.distinct_heads}）"
        )

    # usage 不得越过限额。
    if budget.decompressed_bytes > budget.max_decompressed_bytes:
        raise CheckpointInvariantError("decompressed_bytes 不得越过授权上限")
    if budget.distinct_heads_started > budget.max_distinct_heads:
        raise CheckpointInvariantError("distinct_heads_started 不得越过授权上限")

    # 请求分类基本一致：分类之和 <= attempt 总数，retry/error <= attempts。
    if sum(budget.requests_by_kind.values()) > budget.request_count:
        raise CheckpointInvariantError("requests_by_kind 之和不得超过 request_count")
    if budget.retry_count > budget.request_count:
        raise CheckpointInvariantError("retry_count 不得超过 request_count")
    if budget.error_count > budget.request_count:
        raise CheckpointInvariantError("error_count 不得超过 request_count")

    # started 集合一致：budget 计数 == started 的 word 数。
    started_heads = [head for head, entry in checkpoint.words.items() if entry.started]
    if len(started_heads) != budget.distinct_heads_started:
        raise CheckpointInvariantError(
            "started 集合与 distinct_heads_started 不一致"
            f"（{len(started_heads)} != {budget.distinct_heads_started}）"
        )

    # 终态 / in-flight 词必须 started：绝不允许“凭空 started=True 却不计数”的终态。
    for head, entry in checkpoint.words.items():
        if entry.status in TERMINAL_STATUSES and not entry.started:
            raise CheckpointInvariantError(
                f"终态词 {head!r}（{entry.status.value}）必须 started=True 且计入 distinct"
            )
        if entry.status == WordStatus.IN_FLIGHT and not entry.started:
            raise CheckpointInvariantError(f"in-flight 词 {head!r} 必须 started=True")

    # 触限必须有合适的暂停态（不得以未暂停状态加载触限 checkpoint）。
    if budget.decompressed_bytes >= budget.max_decompressed_bytes and checkpoint.pause_reason is None:
        raise CheckpointInvariantError("bytes 已达/越上限但未处于暂停态")
    if budget.distinct_heads_started >= budget.max_distinct_heads:
        all_terminal = all(
            entry.status in TERMINAL_STATUSES
            for entry in checkpoint.words.values()
            if entry.started
        )
        if all_terminal and checkpoint.pause_reason is None:
            raise CheckpointInvariantError("distinct head 已用尽且词头均终态但未处于暂停态")

    # logical operation 重试计数：非负、且各 operation 之和不得超过全批 retry_count。
    operation_total = sum(op["retries"] for op in checkpoint.operations.values())
    if operation_total > budget.retry_count:
        raise CheckpointInvariantError(
            f"operations 重试之和({operation_total}) 不得超过 budget.retry_count({budget.retry_count})"
        )


class BatchLedger:
    """批次账本：distinct 预扣、状态机、原子持久化、恢复、请求级持久协议。"""

    def __init__(
        self,
        checkpoint: BatchCheckpoint,
        *,
        path: Path | None = None,
        allow_synthetic_authorization: bool = False,
        fresh: bool = False,
    ) -> None:
        checkpoint.authorization.validate(allow_synthetic=allow_synthetic_authorization)
        self.checkpoint = checkpoint
        self.path = path
        # 新建批次可直接运行；加载的批次必须显式 resume()。
        self.resumable = fresh

    # ------------------------------------------------------------------
    # 构造 / 恢复
    # ------------------------------------------------------------------
    @classmethod
    def create(
        cls,
        *,
        batch_id: str,
        authorization: BatchAuthorization,
        path: Path | None = None,
        created_at: str,
        allow_synthetic_authorization: bool = False,
        retry_limit: int = 2,
    ) -> "BatchLedger":
        """新建批次。必须带明确授权（额度来自授权，不硬编码 100/20MiB）。

        若 checkpoint 路径已存在，**拒绝覆盖**：已有批次必须经 ``load()`` +
        ``resume()`` 续作，绝不能清零 40 heads / 8 MiB 等累计。
        ``retry_limit`` 为 logical operation 重试上限，落盘后 resume 不重置。
        """
        if path is not None and path.exists():
            raise AuthorizationError(
                f"checkpoint 已存在，拒绝 create 覆盖: {path}；请 load()+resume() 续作"
            )
        if retry_limit < 0:
            raise ValueError("retry_limit 不能为负")
        budget = RunBudget(
            max_decompressed_bytes=authorization.decompressed_bytes,
            max_distinct_heads=authorization.distinct_heads,
        )
        checkpoint = BatchCheckpoint(
            batch_id=batch_id,
            authorization=authorization,
            budget=budget,
            retry_limit=retry_limit,
            created_at=created_at,
            updated_at=created_at,
        )
        ledger = cls(
            checkpoint,
            path=path,
            allow_synthetic_authorization=allow_synthetic_authorization,
            fresh=True,
        )
        ledger.persist()
        return ledger

    @classmethod
    def load(
        cls,
        path: Path,
        *,
        allow_synthetic_authorization: bool = False,
        expected_schema: str = SCHEMA_VERSION,
        expected_extractor: str = EXTRACTOR_VERSION,
        expected_tag_rule: str = TAG_RULE_VERSION,
    ) -> "BatchLedger":
        """加载已有 checkpoint。``resumable=False``，必须显式 ``resume()``。"""
        if not path.exists():
            raise ResumeRejected(f"checkpoint 不存在，无法 load: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        checkpoint = BatchCheckpoint.from_json(
            payload,
            expected_schema=expected_schema,
            expected_extractor=expected_extractor,
            expected_tag_rule=expected_tag_rule,
        )
        return cls(
            checkpoint,
            path=path,
            allow_synthetic_authorization=allow_synthetic_authorization,
            fresh=False,
        )

    def resume(self) -> None:
        """显式恢复同批。触限 / 消费不确定 / 未清请求时保持暂停，拒绝绕过。"""
        if self.checkpoint.pause_reason in BUDGET_PAUSE_REASONS:
            raise ResumeRejected(
                f"暂停原因 {self.checkpoint.pause_reason!r} 不可恢复绕过"
            )
        # 请求级 in-flight 未清：额外消费无法确定，fail closed（不退预扣、不免费重试）。
        if self.checkpoint.active_request is not None:
            self.mark_paused(
                "consumption-uncertain",
                f"request not cleared: {self.checkpoint.active_request}",
            )
            self.persist()
            raise ResumeRejected("存在未清理的请求级 in-flight，消费不确定，fail closed")

        inflight = [
            entry.head
            for entry in self.checkpoint.words.values()
            if entry.status == WordStatus.IN_FLIGHT
        ]
        if inflight:
            self.mark_paused("consumption-uncertain", f"in-flight: {sorted(inflight)}")
            self.persist()
            raise ResumeRejected("存在 in-flight 且消费不确定，fail closed")
        self.resumable = True

    # ------------------------------------------------------------------
    # 预算 / 暂停
    # ------------------------------------------------------------------
    @property
    def budget(self) -> RunBudget:
        return self.checkpoint.budget

    @property
    def paused(self) -> bool:
        return self.checkpoint.pause_reason is not None

    def mark_paused(self, reason: str, detail: str | None = None) -> None:
        self.checkpoint.pause_reason = reason
        self.checkpoint.pause_detail = detail

    def _require_resumable(self) -> None:
        if not self.resumable:
            raise ResumeRejected(
                "账本未经 resume()，拒绝请求/开始新词（恢复同批必须显式 resume）"
            )

    def assert_can_request(self) -> None:
        self._require_resumable()
        if self.paused:
            raise ResumeRejected(f"批次已暂停: {self.checkpoint.pause_reason!r}")
        if self.budget.remaining_decompressed() <= 0:
            self.mark_paused("decompressed-budget-exhausted", "bytes 已用尽")
            self.persist()
            raise ResumeRejected("解压预算已耗尽，暂停")

    # ------------------------------------------------------------------
    # 请求级持久协议（HttpAdapter journal）
    # ------------------------------------------------------------------
    def _word_attempt(self, head: str) -> int:
        entry = self.checkpoint.words.get(head)
        return entry.attempts if entry is not None else 0

    def _operation_key(self, *, head: str, kind: Any, ordinal: int = 0) -> str:
        """logical operation 身份：{batchId}:{head}:{wordAttempt}:{kind}[:auxOrdinal]。

        重试计数的粒度是 **logical operation**，不是整个 batch：两个词、TOC/MAIN
        各自独立额度；``retry_count`` 仅作全批审计。
        """
        kind_value = getattr(kind, "value", str(kind))
        suffix = f":{ordinal}" if kind_value == RequestKind.AUX.value else ""
        return f"{self.checkpoint.batch_id}:{head}:{self._word_attempt(head)}:{kind_value}{suffix}"

    def claim_retry(self, *, head: str, kind: Any, reason: str, ordinal: int = 0) -> int:
        """为 logical operation 声明一次重试（HTTP + API 共享同一 operation 上限）。

        - operation-local 重试必须 < ``retry_limit``；
        - 批次未暂停、解压字节仍有剩余；
        - local 与全批 ``retry_count`` 同时自增，并在 sleep/dispatch **之前**持久；
        - 持久失败回滚计数并抛出（调用方不得 dispatch）。
        返回该 operation 的重试序号（>=1）。
        """
        self._require_resumable()
        if self.paused:
            raise RetryBudgetExhausted(f"批次已暂停: {self.checkpoint.pause_reason!r}")
        if self.budget.remaining_decompressed() <= 0:
            self.mark_paused("decompressed-budget-exhausted", reason)
            self.persist()
            raise RetryBudgetExhausted("解压预算耗尽，禁止重试")
        key = self._operation_key(head=head, kind=kind, ordinal=ordinal)
        operation = self.checkpoint.operations.get(key)
        created = operation is None
        if operation is None:
            operation = {
                "operationId": len(self.checkpoint.operations) + 1,
                "head": head,
                "kind": getattr(kind, "value", str(kind)),
                "attempt": self._word_attempt(head),
                "retries": 0,
            }
            self.checkpoint.operations[key] = operation
        if operation["retries"] >= self.checkpoint.retry_limit:
            raise RetryBudgetExhausted(
                f"operation 重试额度耗尽（{operation['retries']}/{self.checkpoint.retry_limit}）: {key}"
            )
        operation["retries"] += 1
        self.budget.retry_count += 1
        try:
            self.persist()
        except BaseException:
            # 持久失败：回滚计数并抛出，调用方不得 dispatch（无免费重试）。
            operation["retries"] -= 1
            self.budget.retry_count -= 1
            if created:
                self.checkpoint.operations.pop(key, None)
            raise
        return operation["retries"]

    def request_started(self, *, head: str, kind: Any) -> int:
        """dispatch 前持久 attempt/category/in-flight（返回请求序号）。

        必须通过 ``assert_can_request``：暂停 / 预算耗尽 / 未经 resume 一律拒绝。
        若存在**未结算**的 in-flight（``settled`` 非真），拒绝覆盖：同一 checkpoint
        绝不允许新 adapter/新请求静默顶替旧的未清请求（防止消费不确定被冲掉）。
        """
        self._require_resumable()
        self.assert_can_request()
        active = self.checkpoint.active_request
        if active is not None and not bool(active.get("settled")):
            raise ResumeRejected(
                f"存在未结算的请求级 in-flight，拒绝 dispatch: {active}"
            )
        self.checkpoint.request_seq += 1
        self.checkpoint.active_request = {
            "id": self.checkpoint.request_seq,
            "head": head,
            "kind": getattr(kind, "value", str(kind)),
            "operation": self._operation_key(head=head, kind=kind),
            "settled": False,
            "uncertain": False,
        }
        self.persist()
        return self.checkpoint.request_seq

    def request_accounted(
        self,
        *,
        head: str,
        kind: Any,
        network_bytes: int,
        decompressed_bytes: int,
        complete: bool,
        uncertain: bool,
        reason: str | None = None,
        request_id: int | None = None,
    ) -> None:
        """持久已知 network/decoded bytes；仅完整成功才清理 in-flight。

        - ``request_id`` 必须与当前 in-flight 序号一致，否则拒绝（不得清别 request）。
        - ``uncertain`` 或结构性/触限 ``reason``：持久记录 + durable 暂停，保留 in-flight。
        - known-zero / 完整成功：结算并清理 in-flight，允许后续重试/解析。
        持久失败时保持原 active_request（fail closed、不清 in-flight）。
        """
        kind_value = getattr(kind, "value", str(kind))
        active = self.checkpoint.active_request
        if active is not None:
            active_id = active.get("id")
            if request_id is not None and active_id not in (None, request_id):
                raise CheckpointInvariantError(
                    f"request_accounted 序号不匹配（in-flight {active_id!r} != {request_id!r}），"
                    "拒绝清别 request"
                )
            if active.get("head") not in (None, head) or active.get("kind") not in (None, kind_value):
                raise CheckpointInvariantError(
                    "request_accounted head/kind 与当前 in-flight 不匹配，拒绝清别 request"
                )
            active_operation = active.get("operation")
            if active_operation is not None and active_operation != self._operation_key(
                head=head, kind=kind
            ):
                raise CheckpointInvariantError(
                    "request_accounted operation 与当前 in-flight 不匹配，拒绝清别 request"
                )
        keep = bool(uncertain) or (reason in BUDGET_PAUSE_REASONS)
        record = {
            "id": request_id if request_id is not None else (active.get("id") if active else None),
            "head": head,
            "kind": kind_value,
            "networkBytes": int(network_bytes),
            "decompressedBytes": int(decompressed_bytes),
            "complete": bool(complete),
            "uncertain": bool(uncertain),
            "reason": reason,
            "settled": True,
        }
        previous = active
        self.checkpoint.active_request = record if keep else None
        if uncertain:
            self.mark_paused(
                "consumption-uncertain",
                reason or f"request uncertain ({kind_value}:{head})",
            )
        elif reason in BUDGET_PAUSE_REASONS and not complete:
            self.mark_paused(reason, f"request {reason} ({kind_value}:{head})")
        try:
            self.persist()
        except BaseException:
            # 持久失败：不清 in-flight，保持 fail closed。
            self.checkpoint.active_request = previous
            raise

    # ------------------------------------------------------------------
    # 逐词状态机
    # ------------------------------------------------------------------
    def start_word(self, head: str) -> WordEntry:
        """开始处理一个词：**任何**未 started 的词（含预置 QUEUED）都先预扣名额。

        统一所有 ``started=False`` 路径做配额检查并持久占额，绝不因词已在
        ``words`` 中（例如预置队列的 QUEUED）就绕过 distinct 预算。
        """
        self._require_resumable()
        if self.paused:
            raise ResumeRejected(f"批次已暂停: {self.checkpoint.pause_reason!r}")

        existing = self.checkpoint.words.get(head)
        if existing is None or not existing.started:
            # 需要预扣新 distinct 名额（新词或预置未 started 的 queued 词）。
            if self.budget.distinct_heads_started >= self.budget.max_distinct_heads:
                # 第 101 词：不写入、不启动，暂停（绝不留下未 started 的新词）。
                self.mark_paused(
                    "distinct-head-budget",
                    f"已达 {self.budget.max_distinct_heads} distinct heads",
                )
                self.persist()
                raise ResumeRejected("已开始 distinct head 用尽，拒绝启动新词")
            if existing is None:
                existing = WordEntry(head=head, status=WordStatus.QUEUED)
                self.checkpoint.words[head] = existing
            existing.started = True
            self.budget.distinct_heads_started += 1
            existing.attempts += 1
        else:
            # 同词重试：不增加 distinct，但 attempts 递增。
            if existing.status != WordStatus.IN_FLIGHT:
                existing.attempts += 1
        existing.status = WordStatus.IN_FLIGHT
        # 开始前持久登记名额（预扣）。
        self.persist()
        return existing

    def finish_word(
        self,
        head: str,
        status: WordStatus,
        *,
        note: str | None = None,
        evidence_ids: list[str] | None = None,
    ) -> WordEntry:
        """收尾一个词。只允许对**已 started 且 in-flight**的词收尾。

        拒绝不存在的词头、未 started 的词、以及非 in-flight 的词：绝不凭终态
        “造” 一个 started=True 却不计入 distinct 的条目。若预算名额已用尽，
        终态后立即持久暂停。
        """
        entry = self.checkpoint.words.get(head)
        if entry is None:
            raise CheckpointInvariantError(
                f"finish_word 未知词头 {head!r}：不得凭空创建 started 条目"
            )
        if not entry.started:
            raise CheckpointInvariantError(
                f"finish_word 词头 {head!r} 未 started，拒绝收尾"
            )
        if entry.status != WordStatus.IN_FLIGHT:
            raise CheckpointInvariantError(
                f"finish_word 词头 {head!r} 非 in-flight（当前 {entry.status.value}），拒绝收尾"
            )
        entry.status = status
        entry.note = note
        if evidence_ids:
            for evidence_id in evidence_ids:
                if evidence_id not in entry.evidence_ids:
                    entry.evidence_ids.append(evidence_id)
        # 终态后若 distinct 名额已用尽，立即持久暂停，禁止再请求旧词/新词。
        if (
            status in TERMINAL_STATUSES
            and self.budget.distinct_heads_started >= self.budget.max_distinct_heads
            and self.checkpoint.pause_reason is None
        ):
            self.mark_paused(
                "distinct-head-budget",
                f"已达 {self.budget.max_distinct_heads} distinct heads（终态）",
            )
        self.persist()
        return entry

    def processed_distinct_heads(self) -> int:
        return sum(
            1
            for entry in self.checkpoint.words.values()
            if entry.status in TERMINAL_STATUSES
        )

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------
    def persist(self) -> None:
        self.checkpoint.updated_at = _utc_now_iso()
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            self.checkpoint.to_json(), ensure_ascii=False, sort_keys=True, indent=2
        )
        # 原子替换：临时文件同目录 + os.replace。
        descriptor, temporary = tempfile.mkstemp(
            dir=str(self.path.parent), prefix=self.path.name, suffix=".tmp"
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except BaseException:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
