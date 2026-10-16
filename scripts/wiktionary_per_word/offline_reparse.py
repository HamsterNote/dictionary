"""离线重解析与候选生成纯函数。

对应 task 5.1 的“离线重解析与候选生成”与 task 6.4 的“带来源许可的完整响应
缓存离线重解析”。全部函数不联网，可只用标准库单测。

- 从缓存的原响应（HTML 或 Action API 的 JSON）重新提取观测，计算语义
  fingerprint。缓存的 JSON 既可能是 ``parse.tocdata``，也可能是 **主展开
  ``parse.text``**（``str`` 或 ``{"*": str}``）；后者必须按展开 HTML 处理，
  不能当成 tocdata 误判为无 English。
- HTTP hash 始终是**原响应字节**（JSON 原文）的 hash，不是展开后 HTML 的 hash。
- 与同一 revid 的旧证据比较，识别展开语义变化；无关文本变化不误触。
- 生成候选差异记录，保留全部观测（含片段/未解析）与逐条 8 维 scope，不因缺页
  或失败清空正式结果；只有“同证据 + 同 scope + 同 notation + 同 qualifiers”
  才是真重复，绝不跨 scope/口音按第一条 IPA 折叠。
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from dataclasses import dataclass, field
from enum import Enum
from html import unescape
from typing import Any, Iterable, Mapping

from . import EXTRACTOR_VERSION, TAG_RULE_VERSION
from .action_api import select_english_section
from .evidence import (
    DEFAULT_ATTRIBUTION,
    RENDER_VERSION,
    REQUEST_VERSION,
    WIKTIONARY_LICENSE_ID,
    WIKTIONARY_LICENSE_URL,
    CacheEntry,
    SourceEvidence,
    _ACCEPTED_LICENSE_IDS,
    _valid_cc_by_sa_url,
    compute_semantic_fingerprint,
)
from .html_extract import Observation, extract_observations


class CandidateAction(str, Enum):
    ADD = "add"
    REPLACE = "replace"
    KEEP = "keep"
    SUPPLEMENT = "supplement"
    REVIEW = "review"
    EXCLUDE_OLD_ERROR = "exclude-old-error"
    NO_CHANGE = "no-change"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class ReadingRef:
    """一条候选读法的观测引用，可追溯到源观测并带完整 8 维 scope。

    ``indices`` 指向传入 ``generate_candidates`` 的 source ``observations`` 下标；
    ``raw_ipa`` / ``tags`` / ``path`` / section / etymology / pos / form / role 保留
    原始 metadata，使候选可回溯到源观测，而不仅是归一化字符串。真重复会合并到同一
    引用（``ref`` 用 ``;`` 连接多个观测下标）。``qualification`` 标明当前合格状态：
    ``classification-pending`` 表示完整来源读法但尚未经 task 3.2 标签分类器正式
    qualification（不冒充 default qualified）；``evidence-only`` 表示残缺/损坏/空
    观测，仅作证据。
    """

    ref: str
    indices: tuple[int, ...]
    raw_ipa: str
    ipa: str
    notation: str
    complete: bool
    qualifiers: tuple[str, ...]
    tags: tuple[str, ...]
    path: tuple[str, ...]
    section: str
    etymology: str | None
    pos: str | None
    form: str | None
    role: str | None
    roles: tuple[str, ...]
    usage_labels: tuple[str, ...]
    unclassified_tags: tuple[str, ...]
    applicability: dict[str, Any]
    qualification: str

    def to_json(self) -> dict[str, Any]:
        return {
            "ref": self.ref,
            "indices": list(self.indices),
            "rawIpa": self.raw_ipa,
            "ipa": self.ipa,
            "notation": self.notation,
            "complete": self.complete,
            "qualifiers": list(self.qualifiers),
            "tags": list(self.tags),
            "path": list(self.path),
            "section": self.section,
            "etymology": self.etymology,
            "pos": self.pos,
            "form": self.form,
            "role": self.role,
            "roles": list(self.roles),
            "usageLabels": list(self.usage_labels),
            "unclassifiedTags": list(self.unclassified_tags),
            "applicability": self.applicability,
            "qualification": self.qualification,
        }


@dataclass(frozen=True, slots=True)
class Candidate:
    head: str
    action: CandidateAction
    readings: tuple[str, ...]
    current_value: str | None
    scope: str
    reasons: tuple[str, ...]
    evidence_id: str | None
    status: str
    reading_refs: tuple[ReadingRef, ...] = ()
    # ``default_readings`` 仅容纳经正式 qualification 的读法；本 lane 依赖 task 3.2
    # 分类器，尚未接入前恒为空，完整来源读法进入 ``pending_readings`` 待分类。
    default_readings: tuple[str, ...] = ()
    pending_readings: tuple[str, ...] = ()
    supplemental_readings: tuple[str, ...] = ()
    evidence_only_readings: tuple[str, ...] = ()

    def to_json(self) -> dict[str, Any]:
        return {
            "head": self.head,
            "action": self.action.value,
            "readings": list(self.readings),
            "currentValue": self.current_value,
            "scope": self.scope,
            "reasons": list(self.reasons),
            "evidenceId": self.evidence_id,
            "status": self.status,
            "readingRefs": [ref.to_json() for ref in self.reading_refs],
            "defaultReadings": list(self.default_readings),
            "pendingReadings": list(self.pending_readings),
            "supplementalReadings": list(self.supplemental_readings),
            "evidenceOnlyReadings": list(self.evidence_only_readings),
        }


@dataclass
class ReparseResult:
    observations: list[Observation]
    semantic_fingerprint: str
    warnings: list[str] = field(default_factory=list)


def reparse_html(body: bytes) -> ReparseResult:
    """离线重解析展开 HTML。"""
    html = body.decode("utf-8")
    result = extract_observations(html)
    return ReparseResult(
        observations=result.observations,
        semantic_fingerprint=compute_semantic_fingerprint(result.observations),
        warnings=list(result.warnings),
    )


def _try_json(body: bytes) -> Mapping[str, Any] | None:
    """只在看起来像 JSON 时才解析，避免把 HTML 误当 JSON。"""
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not text.lstrip().startswith("{"):
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _looks_like_json(body: bytes) -> bool:
    try:
        return body.decode("utf-8").lstrip().startswith("{")
    except UnicodeDecodeError:
        return False


def _extract_parse_text(parse: Mapping[str, Any]) -> str | None:
    """``parse.text`` 可能是 ``str``，也可能是 ``{"*": str}``。"""
    text = parse.get("text")
    if isinstance(text, dict):
        html = text.get("*")
    else:
        html = text
    return html if isinstance(html, str) else None


def _validate_cache_entry(entry: CacheEntry) -> None:
    """严格校验缓存条目：complete 必须严格 True，来源完整性由 hash/许可保证。

    手工构造的坏 entry（complete="false"、hash 不符、许可缺失）不得成功重解析。
    """
    if entry.complete is not True:
        raise ValueError("截断/不完整缓存不得重解析成功（complete 必须严格 True）")
    if hashlib.sha256(entry.body).hexdigest() != entry.http_sha256:
        raise ValueError("缓存 httpSha256 与 body 不符，拒绝重解析")
    if entry.license_id not in _ACCEPTED_LICENSE_IDS or not _valid_cc_by_sa_url(
        entry.license_url
    ):
        raise ValueError("缓存许可非 CC BY-SA 4.0，拒绝重解析")
    if not entry.source_url.strip() or not entry.attribution.strip():
        raise ValueError("缓存缺少 sourceURL/attribution，拒绝重解析")


def reparse_cached_entry(entry: CacheEntry) -> ReparseResult:
    """从完整响应缓存离线重解析。

    结构优先：根级 ``error`` 与畸形 JSON 一律 fail closed 并给出 warning；合法
    ``parse.text``（主展开）按 HTML 处理，``parse.tocdata`` 只产出结构 fingerprint。
    HTTP hash 始终是原响应字节（JSON 原文）的 hash。
    """
    _validate_cache_entry(entry)

    payload = _try_json(entry.body)
    if payload is not None:
        # 结构优先：根级 error（如 missingtitle）在 parse 判断之前处理。
        root_error = payload.get("error")
        if root_error:
            return ReparseResult(
                observations=[],
                semantic_fingerprint=_sha256_json({"error": str(root_error)}),
                warnings=["api-error"],
            )
        parse = payload.get("parse")
        if not isinstance(parse, dict):
            return ReparseResult(
                observations=[],
                semantic_fingerprint=_sha256_json({"structure": "malformed"}),
                warnings=["malformed-json-structure"],
            )
        if "text" in parse:
            html = _extract_parse_text(parse)
            if html is None:
                return ReparseResult(
                    observations=[],
                    semantic_fingerprint=_sha256_json({"mainText": "missing"}),
                    warnings=["main-parse-text-missing"],
                )
            return reparse_html(html.encode("utf-8"))
        if "tocdata" in parse:
            section_number, sections = select_english_section(payload)
            warnings = [] if section_number else ["no-english-section"]
            return ReparseResult(
                observations=[],
                semantic_fingerprint=_sha256_json(
                    {
                        "sections": [section.get("line") for section in sections],
                        "english": section_number,
                    }
                ),
                warnings=warnings,
            )
        return ReparseResult(
            observations=[],
            semantic_fingerprint=_sha256_json({"structure": "malformed"}),
            warnings=["malformed-json-structure"],
        )

    if _looks_like_json(entry.body):
        # 声称 JSON 但解析失败：fail closed，不当作 HTML。
        return ReparseResult(
            observations=[],
            semantic_fingerprint=_sha256_json({"malformed": True}),
            warnings=["malformed-json"],
        )
    return reparse_html(entry.body)


def _sha256_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def detect_semantic_change(previous: SourceEvidence, new_fingerprint: str) -> bool:
    """同一 revid 下，语义 fingerprint 变化才算变化；无关文本不误触。"""
    return previous.semantic_fingerprint != new_fingerprint


def build_source_evidence(
    *,
    word: str,
    page_url: str,
    history_url: str,
    revid: int | None,
    fetched_at: str,
    body: bytes,
    observations: Iterable[Observation],
    status: str = "extracted",
    change_note: str | None = None,
    language: str = "English",
) -> SourceEvidence:
    observations = list(observations)
    # http_sha256 / cache_sha256 始终是**原响应字节**的 hash（JSON 原文等），
    # 不是展开后 HTML 的 hash。
    body_hash = hashlib.sha256(body).hexdigest()
    return SourceEvidence(
        word=word,
        language=language,
        page_url=page_url,
        history_url=history_url,
        revid=revid,
        fetched_at=fetched_at,
        http_sha256=body_hash,
        semantic_fingerprint=compute_semantic_fingerprint(observations),
        extractor_version=EXTRACTOR_VERSION,
        tag_rule_version=TAG_RULE_VERSION,
        request_version=REQUEST_VERSION,
        render_version=RENDER_VERSION,
        license_id=WIKTIONARY_LICENSE_ID,
        license_url=WIKTIONARY_LICENSE_URL,
        attribution=DEFAULT_ATTRIBUTION,
        cache_sha256=body_hash,
        status=status,
        change_note=change_note,
    )


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", unescape(text))


def _reading_key(observation: Observation) -> tuple[Any, ...]:
    """真重复判定键：同 scope + 同 notation + 同 qualifiers + 同 usage 标签 + 同 IPA。

    usage/role 属于语义含义，必须入键，否则 `archaic` 与非限定相同 IPA 会被误合并。
    """
    return (
        json.dumps(observation.applicability.to_json(), ensure_ascii=False, sort_keys=True),
        observation.notation,
        tuple(_nfc(qualifier).strip() for qualifier in observation.qualifiers),
        tuple(_nfc(label).strip() for label in observation.usage_labels),
        tuple(observation.roles),
        _nfc(observation.ipa),
    )


def _merge_readings(
    observations: Iterable[Observation], evidence_id: str | None
) -> list[ReadingRef]:
    """按真重复键合并观测；跨 scope/口音/usage 即使 IPA 相同也各自保留。"""
    prefix = evidence_id or "evidence-unknown"
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    ordered: list[tuple[Any, ...]] = []
    for index, observation in enumerate(observations):
        key = _reading_key(observation)
        ref = f"{prefix}#obs:{index}"
        if key in merged:
            merged[key]["refs"].append(ref)
            merged[key]["indices"].append(index)
            continue
        merged[key] = {"refs": [ref], "indices": [index], "observation": observation}
        ordered.append(key)
    reading_refs: list[ReadingRef] = []
    for key in ordered:
        entry = merged[key]
        observation = entry["observation"]
        reading_refs.append(
            ReadingRef(
                ref=";".join(entry["refs"]),
                indices=tuple(entry["indices"]),
                raw_ipa=observation.raw_ipa,
                ipa=observation.ipa,
                notation=observation.notation,
                complete=observation.complete,
                qualifiers=tuple(observation.qualifiers),
                tags=tuple(observation.tags),
                path=tuple(observation.path),
                section=observation.section,
                etymology=observation.etymology,
                pos=observation.pos,
                form=observation.form,
                role=observation.role,
                roles=tuple(observation.roles),
                usage_labels=tuple(observation.usage_labels),
                unclassified_tags=tuple(observation.unclassified_tags),
                applicability=observation.applicability.to_json(),
                qualification=(
                    "classification-pending" if observation.complete else "evidence-only"
                ),
            )
        )
    return reading_refs


def generate_candidates(
    *,
    head: str,
    current_value: str | None,
    observations: Iterable[Observation],
    evidence_id: str | None = None,
) -> list[Candidate]:
    """保守候选生成：保留全部观测与逐条 scope，不轻易判定旧值错误。

    合格分层（依赖 task 3.2 标签分类器正式 qualification）：

    - ``pending_readings``：完整来源读法，**尚未**正式 qualification，逐条保留
      raw/scope/usage/未知限制待分类；**不**写入 ``default_readings``。
    - ``default_readings``：仅容纳经正式 qualification 的读法；分类器接入前恒为空。
    - ``supplemental_readings``：依赖 3.2 的补充读法；接入前恒为空。
    - ``evidence_only_readings``：未达完整、空、损坏、截断等 ALL 仅作证据，不标
      supplemental。

    真重复键 = 同证据 + 同 8 维 scope + 同 notation + 同 qualifiers + 同 usage/
    unknown 标签 + 同 roles + 同 IPA；跨 scope/口音/usage 即使 IPA 相同也各自保留。
    """
    observations = list(observations)
    reading_refs = _merge_readings(observations, evidence_id)
    complete_refs = [ref for ref in reading_refs if ref.complete]
    fragment_refs = [ref for ref in reading_refs if not ref.complete]
    # 完整来源读法尚未经 task 3.2 标签分类器正式 qualification：进入 pending，
    # 不冒充 default qualified；usage（archaic/rare/region 等）逐条保留等待判定。
    source_readings = tuple(ref.ipa for ref in complete_refs)
    pending_readings = source_readings
    all_fragment_readings = tuple(ref.ipa for ref in fragment_refs)
    # 未达完整、空、损坏、控制字符等 ALL 仅作 evidence-only，不标 supplemental。
    evidence_only_readings = all_fragment_readings
    supplemental_readings: tuple[str, ...] = ()
    default_readings: tuple[str, ...] = ()

    candidates: list[Candidate] = []
    if not observations:
        candidates.append(
            Candidate(
                head=head,
                action=CandidateAction.NO_CHANGE,
                readings=(),
                current_value=current_value,
                scope="none",
                reasons=("no-observations",),
                evidence_id=evidence_id,
                status="no-qualified",
                reading_refs=(),
            )
        )
        return candidates

    if not complete_refs:
        candidates.append(
            Candidate(
                head=head,
                action=CandidateAction.REVIEW,
                readings=all_fragment_readings,
                current_value=current_value,
                scope="fragment-only",
                reasons=("only-incomplete-or-unresolved",),
                evidence_id=evidence_id,
                status="unresolved",
                reading_refs=tuple(reading_refs),
                default_readings=(),
                pending_readings=(),
                supplemental_readings=(),
                evidence_only_readings=evidence_only_readings,
            )
        )
        return candidates

    common = {
        "current_value": current_value,
        "reading_refs": tuple(complete_refs),
        "default_readings": (),
        "pending_readings": pending_readings,
        "supplemental_readings": (),
        "evidence_only_readings": evidence_only_readings,
    }
    if current_value is None:
        candidates.append(
            Candidate(
                head=head,
                action=CandidateAction.ADD,
                readings=source_readings,
                scope="source-defined-classification-pending",
                reasons=("no-current-value", "usage-classification-pending"),
                evidence_id=evidence_id,
                status="candidate",
                **common,
            )
        )
    elif current_value in source_readings:
        candidates.append(
            Candidate(
                head=head,
                action=CandidateAction.KEEP,
                readings=source_readings,
                scope="source-defined-classification-pending",
                reasons=("current-present-in-source", "usage-classification-pending"),
                evidence_id=evidence_id,
                status="no-change",
                **common,
            )
        )
    else:
        # 旧值范围未知，不擅自判错；保留为待核验候选。
        candidates.append(
            Candidate(
                head=head,
                action=CandidateAction.REVIEW,
                readings=source_readings,
                scope="source-defined-but-legacy-scope-unknown",
                reasons=(
                    "legacy-scope-unknown",
                    "requires-human-scope-resolution",
                    "usage-classification-pending",
                ),
                evidence_id=evidence_id,
                status="candidate",
                **common,
            )
        )

    if fragment_refs:
        candidates.append(
            Candidate(
                head=head,
                action=CandidateAction.REVIEW,
                readings=all_fragment_readings,
                current_value=current_value,
                scope="fragment-evidence-only",
                reasons=("fragment-preserved-as-evidence-only",),
                evidence_id=evidence_id,
                status="evidence-only",
                reading_refs=tuple(fragment_refs),
                default_readings=(),
                pending_readings=(),
                supplemental_readings=(),
                evidence_only_readings=evidence_only_readings,
            )
        )
    return candidates
