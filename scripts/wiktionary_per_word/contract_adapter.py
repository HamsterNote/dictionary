"""把内部模型机械对齐到 ``contracts.py`` / ``contracts.ts`` 的 JSON 合同。

本模块**只做序列化适配**，不复制、不修改 ``contracts.py``，也不在运行时强依赖
它（测试再 import 它做校验）。对齐点：

- scope 三种格式：``known`` / ``explicit-all``（evidence 为引用列表）/ ``unknown``，
  维度名为 ``language, entry, lexeme, role, pos, sense, accent, other``（**8 维**，
  含独立的 ``lexeme``）。内部 ``Applicability`` 已输出 8 维。
- evidence / observation / checkpoint 的字段名与枚举。
- 内部 pause reason 映射到合同 pause 枚举。
- 语言的等价说明：内部来源语言保存为可读音系名（当前为 ``English``），合同
  使用 BCP-47 码（``en``）。适配层做**显式等价映射**，**原来源语言仍完整保存在
  内部 ``SourceEvidence.language``**；未知语言原样透传，不猜测。
- 可选字段（``lastCompletionEvidence`` / ``pauseReason``）在无值时**省略键**，
  不写 ``null``（TS 侧只接受 ``undefined``，``null`` 会被判非法）。

这样 contracts lane 返回后即可“机械 align”，无需改动其文件。
"""

from __future__ import annotations

import unicodedata
from typing import Any

from .evidence import SourceEvidence
from .html_extract import Observation
from .ledger import BatchCheckpoint

# 合同 schema 常量（与 contracts.py SCHEMA 一致，但不 import 其模块）。
CONTRACT_SCHEMA: dict[str, str] = {
    "observation": "pronunciation-observation/1",
    "evidence": "pronunciation-evidence/1",
    "checkpoint": "pronunciation-checkpoint/1",
}

WIKTIONARY_SPDX = "CC-BY-SA-4.0"
REQUEST_VERSION = "action-api/1"
RENDER_VERSION = "wikitext-render/1"

# 语言等价策略：内部保存来源语言（English/…），合同用 BCP-47。只映射已知等价，
# 未知语言原样保留；绝不用“未知即 en”伪造。
_LANGUAGE_EQUIVALENTS: dict[str, str] = {
    "english": "en",
    "en": "en",
}


def language_to_contract(language: str) -> str:
    """把内部来源语言映射到合同语言码；未知语言原样透传（不猜测）。"""
    if not isinstance(language, str) or not language.strip():
        return language
    return _LANGUAGE_EQUIVALENTS.get(language.strip().lower(), language)


_PAUSE_REASON_MAP = {
    "distinct-head-budget": "head-limit",
    "decompressed-budget-exhausted": "byte-limit",
    "incomplete-response": "truncated",
    "consumption-uncertain": "uncertain-consumption",
    "ua-missing": "ua-missing",
    "budget-unauthorized": "budget-unauthorized",
}


def pause_reason_to_contract(reason: str | None) -> str | None:
    if reason is None:
        return None
    return _PAUSE_REASON_MAP.get(reason, "other")


def completeness_to_contract(observation: Observation) -> str:
    """把内部完整性映射到合同 ``_COMPLETENESS`` 枚举。

    与内部提取器一致：控制字符按 Unicode 类别（``Cc``/``Cf``/``Cs``/``Co``/``Cn``，
    含 DEL 与格式字符）判定，不用 ``ord<32`` 漏判；截断（EOF/未闭合 capture）映射
    ``truncated``；被提取器判为 complete 才 ``complete``。**raw 原值不改**，仅读取判断。
    """
    raw = observation.raw_ipa
    if not raw.strip():
        return "empty"
    if any(unicodedata.category(char) in ("Cc", "Cf", "Cs", "Co", "Cn") for char in raw):
        return "control-character"
    if "truncated-capture" in observation.fragment_reasons:
        return "truncated"
    if observation.complete:
        return "complete"
    if observation.notation == "unknown":
        return "broken-delimiter"
    return "fragment"


def _language_scope_to_contract(scope: dict[str, Any]) -> dict[str, Any]:
    """对 ``language`` 维度做与顶层一致的显式等价映射。

    - ``known``：逐值等价映射（``English→en``），多值保留；
    - ``explicit-all`` / ``unknown``：**原义保留**（不改成 known，也不当通配）；
    - 其他/异常结构：原样返回，交由合同校验器判非法。

    只返回新 dict，**不 mutate** 内部 ``Applicability`` / raw metadata。
    """
    if not isinstance(scope, dict):
        return scope
    if scope.get("kind") != "known":
        return dict(scope)
    values = scope.get("values")
    if not isinstance(values, list):
        return dict(scope)
    return {
        "kind": "known",
        "values": [
            language_to_contract(value) if isinstance(value, str) else value
            for value in values
        ],
    }


def _applicability_to_contract(observation: Observation) -> dict[str, Any]:
    """输出 8 维 applicability，并把 language 维度的 known 值做等价映射。"""
    applicability = observation.applicability.to_json()
    if "language" in applicability:
        applicability = dict(applicability)
        applicability["language"] = _language_scope_to_contract(applicability["language"])
    return applicability


def observation_to_contract(
    observation: Observation,
    *,
    observation_id: str,
    evidence_id: str,
    source_spelling: str,
    language: str = "English",
    synthetic: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema": CONTRACT_SCHEMA["observation"],
        "observationId": observation_id,
        "evidenceId": evidence_id,
        "language": language_to_contract(language),
        "sourceSpelling": source_spelling,
        # 空/片段观测保留：rawIpa / normalizedIpa 允许为空字符串。
        "rawIpa": observation.raw_ipa,
        "normalizedIpa": observation.ipa,
        "notation": observation.notation,
        "completeness": completeness_to_contract(observation),
        # rawTags 保留全部原始标签（含未知限制 metadata），供合同追溯。
        "rawTags": list(observation.tags),
        "rawQualifiers": list(observation.qualifiers),
        "structuralPath": list(observation.path),
        "applicability": _applicability_to_contract(observation),
    }
    if synthetic:
        payload["synthetic"] = True
    return payload


# 明确的“首次提取”变更说明语义：仅当内部证据 status 表示首轮来源提取时使用。
# 不依据则 fail closed，绝不无声补一个泛化 changeNotice。
CHANGE_NOTICE_FIRST_EXTRACTION = "首次按词提取（首轮来源提取）"
_FIRST_EXTRACTION_STATUSES = frozenset(("extracted",))


def change_notice_to_contract(evidence: SourceEvidence) -> str:
    """决定合同 ``changeNotice``：显式 change_note 优先；否则仅当有明确首次提取
    语义时声明；再无依据则 fail closed。"""
    note = evidence.change_note
    if isinstance(note, str) and note.strip():
        return note
    if evidence.status in _FIRST_EXTRACTION_STATUSES:
        return CHANGE_NOTICE_FIRST_EXTRACTION
    raise ValueError(
        f"证据缺少 changeNotice 且 status={evidence.status!r} 不具首次提取语义，拒绝无声补"
    )


def evidence_to_contract(
    evidence: SourceEvidence, *, synthetic: bool = False
) -> dict[str, Any]:
    # 先对真实内部证据做严格校验（复用 SourceEvidence.from_json 的现成严格接口，
    # 不写 evidence.py）。缺失/空白/错误许可/属性类型不符都会在此抛错，绝不把
    # 非 CC BY-SA 许可伪装成 CC4。
    validated = SourceEvidence.from_json(evidence.to_json())
    revision = str(validated.revid) if validated.revid is not None else "unknown"
    payload: dict[str, Any] = {
        "schema": CONTRACT_SCHEMA["evidence"],
        "evidenceId": validated.evidence_id,
        "sourceSite": "wiktionary",
        "language": language_to_contract(validated.language),
        "pageUrl": validated.page_url,
        "historyUrl": validated.history_url,
        "revision": revision,
        "extractedAt": validated.fetched_at,
        # request / render 版本取自内部证据，不用常量覆盖，避免丢失来源 provenance。
        "requestVersion": validated.request_version,
        "renderVersion": validated.render_version,
        "extractorVersion": validated.extractor_version,
        "tagRuleVersion": validated.tag_rule_version,
        "responseContentHash": validated.http_sha256,
        "ipaSemanticFingerprint": validated.semantic_fingerprint,
        "license": {
            # 已由 from_json 校验为 CC BY-SA 4.0 之一，才映射到 SPDX 并声明同许可。
            "spdx": WIKTIONARY_SPDX,
            "url": validated.license_url,
            "attribution": validated.attribution,
            "changeNotice": change_notice_to_contract(validated),
            "shareAlike": True,
        },
    }
    if validated.cache_sha256 is not None:
        payload["cacheRef"] = validated.cache_sha256
    if synthetic:
        payload["synthetic"] = True
    return payload


def checkpoint_to_contract(
    checkpoint: BatchCheckpoint,
    *,
    last_completion_evidence: str | None = None,
) -> dict[str, Any]:
    """产出合同 ``BudgetCheckpoint``：**仅审查用预算 DTO projection**，不是可恢复
    checkpoint。

    真实 resume 必须读取 ledger 的完整持久 checkpoint（含 active_request / errors /
    categories / 授权绑定等安全字段）；本 projection **不能用于还原或扩预算**。
    这里只读不写，不 mutate 传入 checkpoint，且把内部 pause reason 保守映射为合同
    枚举（未知原因 → ``other``，不会解禁）。合同未承载的恢复安全字段属 HTTP 集成
    lane 的最终验收范围，本 lane 不声称其已满足。
    """
    started = [entry.head for entry in checkpoint.words.values() if entry.started]
    queued = [
        entry.head for entry in checkpoint.words.values() if entry.status.value == "queued"
    ]
    payload: dict[str, Any] = {
        "schema": CONTRACT_SCHEMA["checkpoint"],
        "batchId": checkpoint.batch_id,
        "schemaVersions": {
            "overlay": checkpoint.schema_version,
            "extractor": checkpoint.extractor_version,
            "tagRule": checkpoint.tag_rule_version,
        },
        "approvedBudget": {
            "maxDistinctHeads": checkpoint.authorization.distinct_heads,
            "maxDecompressedBytes": checkpoint.authorization.decompressed_bytes,
            "authorized": checkpoint.authorization.granted,
        },
        "queue": queued,
        "startedDistinctHeads": started,
        "headStates": {
            head: entry.status.value for head, entry in checkpoint.words.items()
        },
        "counts": {
            "requests": checkpoint.budget.request_count,
            "retries": checkpoint.budget.retry_count,
            "auxiliaryRequests": checkpoint.budget.requests_by_kind.get("aux", 0),
            "decompressedBytes": checkpoint.budget.decompressed_bytes,
            "networkBytes": checkpoint.budget.network_bytes,
        },
    }
    # 可选字段无值时省略键（不写 null），与 TS 的 undefined 语义一致。
    if last_completion_evidence is not None:
        payload["lastCompletionEvidence"] = last_completion_evidence
    pause_reason = pause_reason_to_contract(checkpoint.pause_reason)
    if pause_reason is not None:
        payload["pauseReason"] = pause_reason
    return payload
