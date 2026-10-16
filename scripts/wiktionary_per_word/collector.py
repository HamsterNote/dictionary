"""按词采集编排：HTTP adapter + Action API + 提取 + 证据/缓存 + 账本。

把各模块串起来。默认只在测试/离线夹具里运行；真实联网必须由第 10 组独立
授权后的 CLI apply 路径提供合规 UA、名单与预算才会发生。

关键约束：

- 每词开始前预扣 distinct 名额并持久化；失败/缺页/无合格读法都计额。
- 预算触限时标记暂停，不补辅助/重试、不启动第 101 词、不自动开新 run。
- 适配层与账本共享同一预算对象，且把 adapter.journal 接到账本，请求级
  in-flight / 已知 bytes 在解析/cache 之前持久化。
- 缺页/无 English 成为状态，不清空正式结果；截断响应不进入成功缓存。
- 结构性 API 错误（坏 JSON/UTF8/缺 parse）持久 FAILED 并收尾，绝不留 in-flight；
  仅真实 missing title 码映射 MISSING；maxlag 等可重试错误受预算有限重试。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Iterable

from .action_api import (
    DEFAULT_API_ENDPOINT,
    ActionApiError,
    PageStatus,
    RetryableActionApiError,
    fetch_english_page,
)
from .evidence import EvidenceLedger, ResponseCache, SourceEvidence
from .html_extract import extract_observations
from .http_adapter import (
    BudgetPaused,
    FetchedResponse,
    HttpAdapter,
    JournalError,
    PausedError,
    RequestKind,
    TransportError,
)
from .ledger import (
    TERMINAL_STATUSES,
    BatchLedger,
    ResumeRejected,
    WordEntry,
    WordStatus,
)
from .offline_reparse import build_source_evidence

_MAX_RETRY_BACKOFF_SECONDS = 300.0
_MIN_RETRY_BACKOFF_SECONDS = 5.0


@dataclass
class BatchRunReport:
    processed: list[str] = field(default_factory=list)
    paused_reason: str | None = None
    stopped_before: str | None = None


class Collector:
    def __init__(
        self,
        *,
        ledger: BatchLedger,
        adapter: HttpAdapter,
        cache: ResponseCache,
        evidence_ledger: EvidenceLedger,
        now: Callable[[], str],
        endpoint: str = DEFAULT_API_ENDPOINT,
    ) -> None:
        self.ledger = ledger
        self.adapter = adapter
        self.cache = cache
        self.evidence_ledger = evidence_ledger
        self.now = now
        self.endpoint = endpoint
        # 适配层与账本必须共享同一预算对象，否则请求计账会脱离持久账本。
        if adapter.budget is not ledger.budget:
            raise ValueError("adapter.budget 与 ledger.budget 必须是同一对象")
        # 请求级持久协议：把 adapter 的 journal 接到账本（若尚未接线）。
        if getattr(adapter, "journal", None) is None:
            adapter.journal = ledger
        # logical operation 重试上限以 adapter 的 max_retries 为准（本批一次落盘，
        # resume 时 operation 计数已持久，不会获得免费重试）。
        ledger.checkpoint.retry_limit = adapter.max_retries

    # ------------------------------------------------------------------
    def collect_word(self, head: str) -> WordEntry:
        """采集一个词。返回其终态 WordEntry。

        **同词重试**：对已存在（含终态）的词再次调用是显式重试——不增加 distinct，
        响应照常计费（``start_word`` 的 attempts 递增）。**恢复**时的“跳过终态”由
        :meth:`run_batch` 负责（正常 resume 不重抓终态词）。
        """
        # 暂停/预算前置检查。
        self.ledger.assert_can_request()
        self.ledger.start_word(head)
        fetched_at = self.now()

        # 重试已下移到 action_api 的 TOC/MAIN 独立循环：同一 logical operation 的
        # HTTP/API 重试共享额度并在 sleep/dispatch 前持久；此处只负责收尾。
        try:
            page = fetch_english_page(self.adapter, head, endpoint=self.endpoint)
        except RetryableActionApiError as error:
            return self.ledger.finish_word(
                head, WordStatus.FAILED, note=f"api-retriable-exhausted:{error}"
            )
        except BudgetPaused as error:
            self.ledger.mark_paused(error.reason, f"word={head}")
            return self.ledger.finish_word(
                head, WordStatus.FAILED, note=f"budget-pause:{error.reason}"
            )
        except (JournalError, PausedError) as error:
            self.ledger.mark_paused("journal-persist-failed", f"word={head}: {error}")
            return self.ledger.finish_word(
                head, WordStatus.FAILED, note=f"fail-closed:{error}"
            )
        except ActionApiError as error:
            # 结构性 API 错误（坏 JSON/UTF8/缺 parse 等）：持久 FAILED 收尾，
            # 绝不留 in-flight，也不清空正式结果。
            return self.ledger.finish_word(
                head, WordStatus.FAILED, note=f"api-error:{error}"
            )
        except (TransportError, OSError) as error:
            return self.ledger.finish_word(
                head, WordStatus.FAILED, note=f"transport:{error}"
            )

        # 缓存 TOC / MAIN 响应（均需完整；adapter 已保证且已持久计账）。
        for response in page.requests:
            self._cache_response(response, fetched_at=fetched_at)

        if page.status is PageStatus.MISSING:
            return self.ledger.finish_word(head, WordStatus.MISSING, note="page-missing")
        if page.status is PageStatus.NO_ENGLISH:
            return self.ledger.finish_word(head, WordStatus.NO_QUALIFIED, note="no-english-section")
        assert page.html is not None

        extraction = extract_observations(page.html)
        main_body = page.requests[-1].body if page.requests else page.html.encode("utf-8")
        evidence = build_source_evidence(
            word=head,
            page_url=f"https://en.wiktionary.org/wiki/{head}",
            history_url=f"https://en.wiktionary.org/w/index.php?title={head}&action=history",
            revid=page.revid,
            fetched_at=fetched_at,
            body=main_body,
            observations=extraction.observations,
        )
        self.evidence_ledger.record(evidence)

        if any(observation.complete for observation in extraction.observations):
            return self.ledger.finish_word(
                head,
                WordStatus.EXTRACTED,
                evidence_ids=[evidence.evidence_id],
            )
        if extraction.observations:
            return self.ledger.finish_word(
                head,
                WordStatus.UNRESOLVED,
                note="observations-without-complete-reading",
                evidence_ids=[evidence.evidence_id],
            )
        return self.ledger.finish_word(
            head,
            WordStatus.NO_QUALIFIED,
            note="no-ipa-observations",
            evidence_ids=[evidence.evidence_id],
        )

    # ------------------------------------------------------------------
    def run_batch(self, heads: Iterable[str]) -> BatchRunReport:
        """串行跑一批词。第 101 词/触限时给出**稳定报告**，不抛异常覆 ledger。

        正常 **resume** 的名单常含首轮词头：这里跳过已是终态的词（不重抓、不重计费），
        只处理未开始/未终态的词。需要显式重试某个终态词应直接调用
        :meth:`collect_word`（spec 未授权前不自动加 retry 功能）。
        """
        report = BatchRunReport()
        for head in heads:
            if self.ledger.paused:
                report.paused_reason = self.ledger.checkpoint.pause_reason
                report.stopped_before = head
                break
            existing = self.ledger.checkpoint.words.get(head)
            if existing is not None and existing.status in TERMINAL_STATUSES:
                # resume 队列跳过终态：不重抓、不冒泡为 processed。
                continue
            try:
                self.collect_word(head)
            except ResumeRejected:
                # start_word/assert_can_request 拒绝：稳定收尾，不覆 ledger 状态。
                report.paused_reason = self.ledger.checkpoint.pause_reason or "resume-rejected"
                report.stopped_before = head
                break
            report.processed.append(head)
            if self.ledger.paused:
                report.paused_reason = self.ledger.checkpoint.pause_reason
        return report

    # ------------------------------------------------------------------
    def _cache_response(self, response: FetchedResponse, *, fetched_at: str) -> None:
        content_type = (
            "application/json"
            if response.kind is RequestKind.TOC
            else "text/html"
        )
        # 完整响应才写入缓存；adapter 已保证未截断。
        try:
            self.cache.put(
                response.body,
                content_type=content_type,
                complete=True,
                source_url=response.url,
                fetched_at=fetched_at,
            )
        except Exception:
            # 缓存失败不阻断候选；记录由调用方/测试断言。
            pass
