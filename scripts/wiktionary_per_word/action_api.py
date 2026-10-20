"""Action API 编排：动态定位 English hLevel=2 并获取完整 English 展开文本。

对应 task 5.2。要点：

- 用 ``parse`` + ``tocdata|revid`` 动态选择 ``line == "English"`` 且 ``hLevel == 2`` 的
  section，**不写死 section=1**。
- 再以该 revision 的 oldid 对选中 index 取 ``prop=text|revid`` 并核对版本和语言根（官方展开已含模板输出，
  主线不自行展开模板）。
- 缺页 / 无 English 成为明确状态，**不清空正式结果**。
- Kaikki 只作可选对照，其不可用不阻断官方流程。
"""

from __future__ import annotations

import json
import base64
import hashlib
import re
import urllib.parse
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Final, Mapping

from .http_adapter import FetchedResponse, HttpAdapter, RequestKind
from .html_extract import extract_observations

DEFAULT_API_ENDPOINT: Final = "https://en.wiktionary.org/w/api.php"
ENGLISH_HEADING: Final = "English"


class PageStatus(str, Enum):
    FOUND = "found"
    MISSING = "missing"
    NO_ENGLISH = "no-english"


class ActionApiError(RuntimeError):
    """Action API 返回错误或结构不可用（结构性失败，须持久 FAILED）。"""


class RetryableActionApiError(ActionApiError):
    """可重试的上游 API 错误（maxlag / ratelimited 等），受预算有限重试。"""


# 真实缺页：仅此码映射为 MISSING。
_MISSING_CODES = ("missingtitle", "nosuchpageid", "nosuchrevid")
# 上游暂时性错误：可在预算内有限重试。
_RETRIABLE_CODES = ("maxlag", "ratelimited", "readonly", "internal_api_error", "backend-fail")


@dataclass
class PageFetch:
    page: str
    status: PageStatus
    english_section_index: str | None = None
    revid: int | None = None
    html: str | None = None
    toc_sections: list[dict[str, Any]] = field(default_factory=list)
    requests: list[FetchedResponse] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # MAIN 语言根校验拒绝原因：不抛中断，交由 collector 把被拒 MAIN 以
    # evidence-only 留证持久化后仍按 FAILED 完成（fail-closed 语义不变）。
    language_rejection: str | None = None

    def cache_checkpoint(self, fetched_at: str) -> dict:
        """Only fully received, already accounted responses enter local recovery."""
        return {
            "head": self.page, "status": self.status.value, "html": self.html,
            "revid": self.revid, "fetchedAt": fetched_at,
            "languageRejection": self.language_rejection,
            "responses": [{"url": r.url, "kind": r.kind.value,
                           "body": base64.b64encode(r.body).decode("ascii"),
                           "sha256": hashlib.sha256(r.body).hexdigest()}
                          for r in self.requests],
        }

    @classmethod
    def from_cache_checkpoint(cls, value: dict) -> "PageFetch":
        if not isinstance(value, dict) or set(value) != {
            "head", "status", "html", "revid", "fetchedAt", "responses",
            "languageRejection",
        }:
            raise ValueError("invalid pending cache page")
        if (not isinstance(value["head"], str) or not value["head"] or
                not isinstance(value["fetchedAt"], str) or not value["fetchedAt"] or
                (value["revid"] is not None and type(value["revid"]) is not int)):
            raise ValueError("invalid pending cache identity")
        rejection = value["languageRejection"]
        if rejection is not None and (not isinstance(rejection, str) or not rejection.strip()):
            raise ValueError("invalid pending cache language rejection")
        status = PageStatus(value["status"])
        if ((status == PageStatus.FOUND and not isinstance(value["html"], str)) or
                (status != PageStatus.FOUND and value["html"] is not None)):
            raise ValueError("invalid pending cache HTML")
        responses = value["responses"]
        if not isinstance(responses, list) or not 1 <= len(responses) <= 6:
            raise ValueError("invalid pending cache response count")
        requests = []
        seen_main = False
        for index, item in enumerate(responses):
            if not isinstance(item, dict) or set(item) != {"url", "kind", "body", "sha256"}:
                raise ValueError("invalid pending cache response")
            if (not isinstance(item["url"], str) or not item["url"] or
                    not isinstance(item["body"], str) or
                    item["kind"] not in ("toc", "main") or
                    (index == 0 and item["kind"] != "toc") or
                    (seen_main and item["kind"] != "main")):
                raise ValueError("invalid pending cache provenance")
            seen_main = seen_main or item["kind"] == "main"
            body = base64.b64decode(item["body"], validate=True)
            if hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("pending cache body hash differs")
            requests.append(FetchedResponse(
                url=item["url"], kind=RequestKind(item["kind"]), body=body,
                status=200, headers={}, network_bytes=0, decompressed_bytes=len(body),
                attempts=0, retried=False))
        if (status == PageStatus.FOUND and not seen_main) or (status == PageStatus.NO_ENGLISH and seen_main):
            raise ValueError("pending cache response kinds differ from page status")
        return cls(page=value["head"], status=status, html=value["html"],
                   revid=value["revid"], requests=requests,
                   language_rejection=rejection)


def build_tocdata_url(page: str, *, endpoint: str = DEFAULT_API_ENDPOINT) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "parse",
            "page": page,
            "prop": "tocdata|revid",
            "format": "json",
            "redirects": "1",
        }
    )
    return f"{endpoint}?{query}"


def build_parse_text_url(
    oldid: int, section_index: str, *, endpoint: str = DEFAULT_API_ENDPOINT
) -> str:
    if type(oldid) is not int or oldid <= 0:
        raise ActionApiError("MAIN requires a positive integer oldid from TOC")
    if not isinstance(section_index, str) or re.fullmatch(r"[1-9][0-9]*", section_index) is None:
        raise ActionApiError("MAIN requires a valid section index from TOC")
    query = urllib.parse.urlencode(
        {
            "action": "parse",
            "oldid": oldid,
            "section": section_index,
            "prop": "text|revid",
            "format": "json",
        }
    )
    return f"{endpoint}?{query}"


def _revision(payload: Mapping[str, Any], kind: str) -> int:
    parse = payload.get("parse")
    revid = parse.get("revid") if isinstance(parse, Mapping) else None
    if type(revid) is not int or revid <= 0:
        raise ActionApiError(f"{kind} response requires a positive integer revid")
    return revid


def _decode_json(response: FetchedResponse) -> Mapping[str, Any]:
    try:
        payload = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        # 截断内容不会到达这里（adapter 已拒绝），但坏 JSON 仍保守报错。
        raise ActionApiError(f"响应不是有效 JSON: {error}") from error
    # 顶层必须是对象：``[]`` / ``null`` / ``"str"`` 等不能携带 ``.get``，直接
    # 结构性失败（ActionApiError），绝不留在 in-flight、也不伪装成 MISSING。
    if not isinstance(payload, Mapping):
        raise ActionApiError(
            f"响应 JSON 顶层必须是对象，实为 {type(payload).__name__}"
        )
    return payload


def select_english_section(
    payload: Mapping[str, Any],
) -> tuple[str | None, list[dict[str, Any]]]:
    """从 tocdata 中选出 English hLevel=2 的 parse section index。

    ``number`` 是目录展示编号，``tocLevel`` 是相对嵌套层级，均不能定位章节。
    只接受原始标题 English，不把 HTML、大小写或缺失字段猜成目标语言。
    """
    parse = payload.get("parse")
    if not isinstance(parse, Mapping):
        raise ActionApiError("tocdata 缺少 parse 字段")
    tocdata = parse.get("tocdata")
    if tocdata is None:
        raise ActionApiError("tocdata 缺少 parse.tocdata 字段")
    if not isinstance(tocdata, Mapping):
        raise ActionApiError("tocdata.tocdata 结构异常")
    sections = tocdata.get("sections")
    if not isinstance(sections, list):
        raise ActionApiError("tocdata.sections 结构异常")
    selected = None
    for section in sections:
        if not isinstance(section, Mapping):
            raise ActionApiError("tocdata.sections 元素必须是对象")
        line, level = section.get("line"), section.get("hLevel")
        if not isinstance(line, str) or type(level) is not int or level < 1:
            raise ActionApiError("tocdata section 缺少有效 line/hLevel")
        if line == ENGLISH_HEADING and level == 2:
            index = section.get("index")
            if not isinstance(index, str) or re.fullmatch(r"[1-9][0-9]*", index) is None:
                raise ActionApiError("English section 缺少有效 parse index")
            if selected is not None:
                raise ActionApiError("多个 English hLevel=2 section，拒绝猜测")
            selected = index
    return selected, list(sections)


def _has_api_error(payload: Mapping[str, Any]) -> str | None:
    error = payload.get("error")
    if isinstance(error, dict):
        return str(error.get("code") or error.get("info") or "unknown-api-error")
    if error:
        return str(error)
    return None


def classify_api_error(code: str) -> str:
    """把 API 错误码分为 ``missing`` / ``retriable`` / ``structural``。"""
    if code in _MISSING_CODES:
        return "missing"
    if code in _RETRIABLE_CODES:
        return "retriable"
    return "structural"


def _claim_api_retry(adapter: HttpAdapter, *, head: str, kind: RequestKind, api_error: str) -> None:
    """为 HTTP-200 的 API 错误声明一次 operation 重试；额度耗尽则抛可重试错误。

    错误/重试在同一 logical operation 上计账，并在 sleep 前持久（由适配层
    ``claim_operation_retry`` 保证）；额度耗尽必须停止重试，交由 collector 收尾。
    """
    adapter.budget.note_error()
    retry_index = adapter.claim_operation_retry(
        head=head, kind=kind, reason=f"api-error:{api_error}"
    )
    if retry_index is None:
        raise RetryableActionApiError(
            f"{kind.value}-api-error:{api_error}(retry-budget-exhausted)"
        )
    adapter.operation_retry_wait(retry_index)


def fetch_english_page(
    adapter: HttpAdapter,
    page: str,
    *,
    endpoint: str = DEFAULT_API_ENDPOINT,
) -> PageFetch:
    """抓取并定位 English 段，返回完整展开 HTML 或明确缺失状态。

    TOC 与 MAIN **各自**有独立的 fetch+decode/APIerror 重试循环：MAIN 的可重试
    错误只会重抓 MAIN，绝不回退重跑 TOC（避免重复计费与放大）。
    """
    fetch = PageFetch(page=page, status=PageStatus.MISSING)

    # --- TOC：独立循环 ---
    while True:
        toc_response = adapter.fetch(
            build_tocdata_url(page, endpoint=endpoint), kind=RequestKind.TOC, head=page
        )
        fetch.requests.append(toc_response)
        toc_payload = _decode_json(toc_response)
        api_error = _has_api_error(toc_payload)
        if api_error is None:
            break
        fetch.warnings.append(f"tocdata-api-error:{api_error}")
        category = classify_api_error(api_error)
        if category == "missing":
            fetch.status = PageStatus.MISSING
            return fetch
        if category == "retriable":
            _claim_api_retry(adapter, head=page, kind=RequestKind.TOC, api_error=api_error)
            continue
        raise ActionApiError(f"tocdata-api-error:{api_error}")

    toc_revid = _revision(toc_payload, "TOC")
    fetch.revid = toc_revid
    section_index, sections = select_english_section(toc_payload)
    fetch.toc_sections = sections
    if section_index is None:
        fetch.status = PageStatus.NO_ENGLISH
        return fetch

    fetch.english_section_index = section_index

    # --- MAIN：独立循环；MAIN 错误绝不重跑 TOC ---
    while True:
        text_response = adapter.fetch(
            build_parse_text_url(toc_revid, section_index, endpoint=endpoint),
            kind=RequestKind.MAIN,
            head=page,
        )
        fetch.requests.append(text_response)
        text_payload = _decode_json(text_response)
        api_error = _has_api_error(text_payload)
        if api_error is None:
            break
        fetch.warnings.append(f"parse-api-error:{api_error}")
        category = classify_api_error(api_error)
        if category == "missing":
            # TOC already resolved a page revision. An unavailable oldid is a
            # failed snapshot fetch, not proof that the head/page is missing.
            raise ActionApiError(f"MAIN snapshot unavailable:{api_error}")
        if category == "retriable":
            _claim_api_retry(adapter, head=page, kind=RequestKind.MAIN, api_error=api_error)
            continue
        raise ActionApiError(f"parse-api-error:{api_error}")

    parse = text_payload.get("parse")
    if not isinstance(parse, Mapping):
        raise ActionApiError("parse 文本响应缺少 parse 字段")
    text = parse.get("text")
    if isinstance(text, dict):
        html = text.get("*")
    else:
        html = text
    if not isinstance(html, str):
        raise ActionApiError("parse 文本响应缺少展开 HTML")
    if _revision(text_payload, "MAIN") != toc_revid:
        raise ActionApiError("MAIN revid differs from TOC revision")
    try:
        extract_observations(html, expected_language=ENGLISH_HEADING)
    except ValueError as error:
        # 不抛中断：拒绝原因随 PageFetch 交给 collector，被拒 MAIN 以
        # evidence-only 留证持久化（不进候选），词仍按 FAILED 完成。
        fetch.language_rejection = f"MAIN language root rejected: {error}"
    fetch.html = html
    fetch.status = PageStatus.FOUND
    return fetch


def optional_compare_available(path: str | None) -> tuple[bool, str | None]:
    """Kaikki 可选对照：缺失不阻断官方按词流程。"""
    if path is None:
        return False, "optional-compare-not-configured"
    return False, "optional-compare-not-used-in-main-path"
