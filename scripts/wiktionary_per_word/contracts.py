"""音标叠加层 JSON 合同的 Python 读取/校验侧。

与 TypeScript 侧 `src/pronunciation-overlay/contracts.ts` 的 schema 版本常量必须一致；
`test_pronunciation_contracts.py` 会解析 TS 文件核对常量。

本模块只做离线形状与引用校验，不联网、不采集、不发布，也不写任何正式结果。
目录内只保留本文件；不新建 ``__init__.py`` 或其他 Python 文件。
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

# ---------------------------------------------------------------------------
# schema 版本常量（必须与 contracts.ts 一致）
# ---------------------------------------------------------------------------

SCHEMA: dict[str, str] = {
    "overlay": "pronunciation-overlay/1",
    "identity": "pronunciation-identity/1",
    "evidence": "pronunciation-evidence/1",
    "observation": "pronunciation-observation/1",
    "rule": "pronunciation-rule/1",
    "resolved": "pronunciation-resolved/1",
    "manifest": "pronunciation-manifest/1",
    "checkpoint": "pronunciation-checkpoint/1",
    "approval": "pronunciation-approval/1",
    "display": "pronunciation-display/1",
}

# entry 与 lexeme 是独立维度。
SCOPE_DIMENSIONS: tuple[str, ...] = (
    "language",
    "entry",
    "lexeme",
    "role",
    "pos",
    "sense",
    "accent",
    "other",
)

OPAQUE_ID_PATTERN = re.compile(
    r"^(?:ent|lex)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def is_opaque_id_format(value: object) -> bool:
    return isinstance(value, str) and OPAQUE_ID_PATTERN.match(value) is not None


_GRAMMAR_ROLES = ("base", "present", "past", "past-participle")
_NOTATIONS = ("phonemic", "phonetic", "unknown")
_COMPLETENESS = (
    "complete",
    "fragment",
    "empty",
    "broken-delimiter",
    "control-character",
    "truncated",
)
_REVIEW_STATUS = ("active", "due", "pending-review", "revoked", "replaced")
_RULE_ORIGINS = ("system", "user")
_RULE_FIELDS = ("word", "phonetic", "meaning")
_RULE_OPS = ("set", "clear", "suppress")
_PROVENANCE = ("user", "system", "qualified-source", "legacy")
_DISPOSITIONS = ("default", "supplemental", "evidence-only", "unresolved")
_ACCENT_CLASSES = (
    "standard",
    "unspecified",
    "uk-unspecified",
    "us-unspecified",
    "regional",
    "unknown",
)
_USAGE = ("rare", "archaic", "obsolete")
_HEAD_STATES = (
    "queued",
    "in-flight",
    "extracted",
    "missing",
    "no-qualified",
    "unresolved",
    "failed",
    "paused",
    "reported",
)
_PAUSE_REASONS = (
    "head-limit",
    "byte-limit",
    "truncated",
    "ua-missing",
    "budget-unauthorized",
    "uncertain-consumption",
    "other",
)
_LICENSE_SCOPE = ("wiktionary-derived", "application", "echdict-original")

_KEY_PATTERN = re.compile(r"^\s*(\w+):\s*'([^']+)',\s*$")

# 文档集中必须存在的列表字段；缺失不得默认为空数组。
_REQUIRED_DOCUMENT_LISTS = (
    "identityEntryIds",
    "evidence",
    "observations",
    "rules",
    "resolved",
    "approvals",
    "checkpoints",
)


def parse_schema_constants_from_typescript(source: str) -> dict[str, str]:
    """从 contracts.ts 的 ``PRONUNCIATION_SCHEMA`` 块解析版本常量，供一致性核对。"""

    match = re.search(r"PRONUNCIATION_SCHEMA\s*=\s*\{(?P<body>.*?)\}\s*as const", source, re.S)
    if match is None:
        raise ValueError("未找到 PRONUNCIATION_SCHEMA 块")
    result: dict[str, str] = {}
    for line in match.group("body").splitlines():
        key_match = _KEY_PATTERN.match(line)
        if key_match is not None:
            result[key_match.group(1)] = key_match.group(2)
    return result


# ---------------------------------------------------------------------------
# JSON 规范化与指纹
# ---------------------------------------------------------------------------


def canonical_json(value: Any) -> str:
    """按键排序的规范化 JSON，用于稳定的文档比较。"""

    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def document_fingerprint(value: Any) -> str:
    """sha256 内容指纹（Python 侧读取用；与 TS 侧非加密 FNV 指纹用途不同）。"""

    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# 校验基元
# ---------------------------------------------------------------------------


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _require_string(record: dict[str, Any], key: str, path: str, issues: list[str]) -> None:
    value = record.get(key)
    if not isinstance(value, str) or value == "":
        issues.append(f"{path}.{key}: required-string: {key} 必须是非空字符串")


def _require_string_maybe_empty(
    record: dict[str, Any], key: str, path: str, issues: list[str]
) -> None:
    if not isinstance(record.get(key), str):
        issues.append(f"{path}.{key}: required-string: {key} 必须是字符串")


def _optional_string(record: dict[str, Any], key: str, path: str, issues: list[str]) -> None:
    value = record.get(key)
    if value is None:
        return
    if not isinstance(value, str) or value == "":
        issues.append(f"{path}.{key}: optional-string: {key} 若存在必须是非空字符串")


def _require_number(record: dict[str, Any], key: str, path: str, issues: list[str]) -> None:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        issues.append(f"{path}.{key}: required-number: {key} 必须是非负数字")


def _require_string_array(
    record: dict[str, Any],
    key: str,
    path: str,
    issues: list[str],
    *,
    allow_empty: bool = True,
) -> None:
    value = record.get(key)
    if not isinstance(value, list):
        issues.append(f"{path}.{key}: required-array: {key} 必须是数组")
        return
    if not allow_empty and len(value) == 0:
        issues.append(f"{path}.{key}: empty-array: {key} 不能为空数组")
    for index, item in enumerate(value):
        if not isinstance(item, str) or item == "":
            issues.append(f"{path}.{key}[{index}]: array-item: {key} 元素必须是非空字符串")


def _require_schema(record: dict[str, Any], expected: str, path: str, issues: list[str]) -> None:
    if record.get("schema") != expected:
        issues.append(f"{path}.schema: schema-version: schema 必须为 {expected}")


def _require_version_field(
    record: dict[str, Any], key: str, expected: str, path: str, issues: list[str]
) -> None:
    if record.get(key) != expected:
        issues.append(f"{path}.{key}: schema-version: {key} 必须为 {expected}")


def _require_enum(
    record: dict[str, Any], key: str, allowed: tuple[str, ...], path: str, issues: list[str]
) -> None:
    if record.get(key) not in allowed:
        issues.append(f"{path}.{key}: invalid-enum: {key} 必须是 {' | '.join(allowed)}")


def _require_opaque_id(record: dict[str, Any], key: str, path: str, issues: list[str]) -> None:
    value = record.get(key)
    if not isinstance(value, str) or value == "":
        issues.append(f"{path}.{key}: invalid-id: {key} 必须是非空字符串")
        return
    if not is_opaque_id_format(value):
        issues.append(f"{path}.{key}: invalid-id: {key} 必须是不透明 ID（ent_/lex_ + UUID）")


# ---------------------------------------------------------------------------
# 校验：范围 / 证据 / 各文档
# ---------------------------------------------------------------------------


def validate_scope_constraint(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: scope-object: 适用范围约束必须是对象")
        return
    kind = value.get("kind")
    if kind == "known":
        values = value.get("values")
        if not isinstance(values, list) or len(values) == 0:
            issues.append(f"{path}.values: scope-known-empty: known 约束必须给出至少一个取值")
        else:
            for index, item in enumerate(values):
                if not isinstance(item, str) or item == "":
                    issues.append(f"{path}.values[{index}]: scope-known-item: known 取值必须是非空字符串")
        return
    if kind == "explicit-all":
        evidence = value.get("evidence")
        if not isinstance(evidence, list) or len(evidence) == 0:
            issues.append(f"{path}.evidence: scope-all-evidence: explicit-all 必须带证据引用")
        else:
            for index, item in enumerate(evidence):
                if not isinstance(item, str) or item == "":
                    issues.append(f"{path}.evidence[{index}]: scope-all-evidence-item: explicit-all 证据项必须是非空字符串")
        return
    if kind == "unknown":
        reason = value.get("reason")
        if not isinstance(reason, str) or reason == "":
            issues.append(f"{path}.reason: scope-unknown-reason: unknown 必须给出原因")
        return
    issues.append(f"{path}.kind: scope-unknown-as-all: kind 必须是 known | explicit-all | unknown")


def validate_applicability_scope(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: scope-required: 适用范围必须是对象")
        return
    for dimension in SCOPE_DIMENSIONS:
        if dimension not in value:
            issues.append(f"{path}.{dimension}: scope-missing-dimension: 缺少维度 {dimension}")
            continue
        validate_scope_constraint(value[dimension], f"{path}.{dimension}", issues)


def collect_scope_evidence_refs(scope: Any) -> list[str]:
    """收集范围内所有 explicit-all 的证据引用。"""

    refs: list[str] = []
    if not _is_record(scope):
        return refs
    for dimension in SCOPE_DIMENSIONS:
        constraint = scope.get(dimension)
        if _is_record(constraint) and constraint.get("kind") == "explicit-all":
            evidence = constraint.get("evidence")
            if isinstance(evidence, list):
                refs.extend(item for item in evidence if isinstance(item, str))
    return refs


def validate_source_license(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: license-required: 缺少许可对象")
        return
    for key in ("spdx", "url", "attribution", "changeNotice"):
        _require_string(value, key, path, issues)
    if not isinstance(value.get("shareAlike"), bool):
        issues.append(f"{path}.shareAlike: license-share-alike: shareAlike 必须是布尔值")


def validate_source_evidence(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: evidence-required: 证据必须是对象")
        return
    _require_schema(value, SCHEMA["evidence"], path, issues)
    for key in (
        "evidenceId",
        "sourceSite",
        "language",
        "pageUrl",
        "historyUrl",
        "revision",
        "extractedAt",
        "requestVersion",
        "renderVersion",
        "extractorVersion",
        "tagRuleVersion",
        "responseContentHash",
        "ipaSemanticFingerprint",
    ):
        _require_string(value, key, path, issues)
    _optional_string(value, "cacheRef", path, issues)
    validate_source_license(value.get("license"), f"{path}.license", issues)
    license_value = value.get("license")
    if _is_record(license_value) and value.get("sourceSite") == "wiktionary":
        if license_value.get("spdx") != "CC-BY-SA-4.0":
            issues.append(f"{path}.license.spdx: license-spdx: Wiktionary 衍生数据必须是 CC-BY-SA-4.0")
        if license_value.get("shareAlike") is not True:
            issues.append(f"{path}.license.shareAlike: license-share-alike: Wiktionary 衍生数据必须声明同许可")


def validate_observation(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: observation-required: 观测必须是对象")
        return
    _require_schema(value, SCHEMA["observation"], path, issues)
    for key in ("observationId", "evidenceId", "language", "sourceSpelling"):
        _require_string(value, key, path, issues)
    # 空/片段观测保留：rawIpa / normalizedIpa 允许为空字符串。
    _require_string_maybe_empty(value, "rawIpa", path, issues)
    _require_string_maybe_empty(value, "normalizedIpa", path, issues)
    _require_enum(value, "notation", _NOTATIONS, path, issues)
    _require_enum(value, "completeness", _COMPLETENESS, path, issues)
    for key in ("rawTags", "rawQualifiers", "structuralPath"):
        _require_string_array(value, key, path, issues)
    validate_applicability_scope(value.get("applicability"), f"{path}.applicability", issues)


def validate_rule(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: rule-required: 规则必须是对象")
        return
    _require_schema(value, SCHEMA["rule"], path, issues)
    _require_string(value, "ruleId", path, issues)
    _require_enum(value, "origin", _RULE_ORIGINS, path, issues)
    _require_enum(value, "reviewStatus", _REVIEW_STATUS, path, issues)
    # 旧有效规则可能无 timestamp：createdAt 可缺失，但须给出原因并保持待复核。
    created_at = value.get("createdAt")
    created_at_unknown_reason = value.get("createdAtUnknownReason")
    if created_at is None:
        if not isinstance(created_at_unknown_reason, str) or created_at_unknown_reason == "":
            issues.append(
                f"{path}.createdAt: rule-created-at-required: createdAt 缺失时必须给出非空 createdAtUnknownReason（旧规则不得伪填时间）"
            )
        elif value.get("reviewStatus") != "pending-review":
            issues.append(
                f"{path}.reviewStatus: rule-created-at-review: createdAt 未知的旧规则必须保持 pending-review 且仍有效"
            )
    elif not isinstance(created_at, str) or created_at == "":
        issues.append(f"{path}.createdAt: required-string: createdAt 若存在必须是非空字符串")
    elif created_at_unknown_reason is not None:
        issues.append(
            f"{path}.createdAtUnknownReason: rule-created-at-conflict: createdAt 已知时不得再声明 createdAtUnknownReason"
        )
    _optional_string(value, "createdAtUnknownReason", path, issues)
    for key in ("lastVerifiedAt", "reviewDueAt", "supersedesRuleId", "revokedByRuleId"):
        _optional_string(value, key, path, issues)
    _require_string_array(value, "evidenceRefs", path, issues)

    target = value.get("target")
    if not _is_record(target):
        issues.append(f"{path}.target: rule-target: 规则必须有 target")
    elif target.get("kind") == "entry":
        _require_opaque_id(target, "entryId", f"{path}.target", issues)
    elif target.get("kind") == "legacy-headword":
        _require_string(target, "word", f"{path}.target", issues)
    else:
        issues.append(f"{path}.target.kind: rule-target-kind: target.kind 必须是 entry | legacy-headword")

    operations = value.get("operations")
    if not isinstance(operations, list) or len(operations) == 0:
        issues.append(f"{path}.operations: rule-operations: 规则必须至少有一个字段操作")
    else:
        for index, operation in enumerate(operations):
            operation_path = f"{path}.operations[{index}]"
            if not _is_record(operation):
                issues.append(f"{operation_path}: rule-operation: 操作必须是对象")
                continue
            _require_enum(operation, "field", _RULE_FIELDS, operation_path, issues)
            _require_enum(operation, "op", _RULE_OPS, operation_path, issues)
            op = operation.get("op")
            operation_value = operation.get("value")
            if op == "set":
                # set 不得用空值表达「清空」；空音标须用 suppress 明确表达。
                if not isinstance(operation_value, str) or operation_value == "":
                    issues.append(f"{operation_path}.value: rule-op-set-empty: set 操作必须带非空 value；空音标须用 suppress")
            elif operation_value is not None:
                issues.append(f"{operation_path}.value: rule-op-value-not-allowed: 非 set 操作不得带 value")
            refs = operation.get("observationRefs")
            if refs is not None:
                if not isinstance(refs, list):
                    issues.append(f"{operation_path}.observationRefs: rule-operation-refs: observationRefs 必须是数组")
                else:
                    for ref_index, ref in enumerate(refs):
                        if not isinstance(ref, str) or ref == "":
                            issues.append(f"{operation_path}.observationRefs[{ref_index}]: rule-operation-refs-item: observationRefs 元素必须是非空字符串")
    validate_applicability_scope(value.get("conditions"), f"{path}.conditions", issues)


def validate_resolved(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: resolved-required: 结果必须是对象")
        return
    _require_schema(value, SCHEMA["resolved"], path, issues)
    _require_opaque_id(value, "entryId", path, issues)
    _require_enum(value, "reviewStatus", _REVIEW_STATUS, path, issues)
    for key in (
        "defaultReadingRefs",
        "supplementalReadingRefs",
        "retainedReadingRefs",
        "unresolvedReasons",
        "excludedReasons",
    ):
        _require_string_array(value, key, path, issues)
    validate_applicability_scope(value.get("conditions"), f"{path}.conditions", issues)
    provenance = value.get("fieldProvenance")
    if not isinstance(provenance, list):
        issues.append(f"{path}.fieldProvenance: resolved-provenance: fieldProvenance 必须是数组")
    else:
        for index, item in enumerate(provenance):
            item_path = f"{path}.fieldProvenance[{index}]"
            if not _is_record(item):
                issues.append(f"{item_path}: resolved-provenance-item: provenance 必须是对象")
                continue
            _require_enum(item, "field", _RULE_FIELDS, item_path, issues)
            _require_enum(item, "source", _PROVENANCE, item_path, issues)
            _optional_string(item, "ref", item_path, issues)


def validate_manifest(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: manifest-required: manifest 必须是对象")
        return
    _require_schema(value, SCHEMA["manifest"], path, issues)
    for key in ("manifestVersion", "candidateHash", "approvalId"):
        _require_string(value, key, path, issues)
    _optional_string(value, "previousManifestVersion", path, issues)
    _require_version_field(value, "identitySchemaVersion", SCHEMA["identity"], path, issues)
    _require_version_field(value, "evidenceSchemaVersion", SCHEMA["evidence"], path, issues)
    _require_version_field(value, "observationSchemaVersion", SCHEMA["observation"], path, issues)
    _require_version_field(value, "ruleSchemaVersion", SCHEMA["rule"], path, issues)
    _require_version_field(value, "resolvedSchemaVersion", SCHEMA["resolved"], path, issues)

    assets = value.get("assets")
    if not isinstance(assets, list) or len(assets) == 0:
        issues.append(f"{path}.assets: manifest-assets: manifest 必须包含资产")
    else:
        for index, asset in enumerate(assets):
            asset_path = f"{path}.assets[{index}]"
            if not _is_record(asset):
                issues.append(f"{asset_path}: manifest-asset: 资产必须是对象")
                continue
            for key in ("path", "sha256", "licenseSpdx"):
                _require_string(asset, key, asset_path, issues)
            _require_number(asset, "bytes", asset_path, issues)

    per_entry = value.get("perEntryResultVersions")
    if not _is_record(per_entry):
        issues.append(f"{path}.perEntryResultVersions: manifest-per-entry: perEntryResultVersions 必须是对象")
    else:
        for entry_id, version in per_entry.items():
            if not is_opaque_id_format(entry_id):
                issues.append(f"{path}.perEntryResultVersions.{entry_id}: invalid-id: 结果版本键必须是不透明 ID")
            if not isinstance(version, str) or version == "":
                issues.append(f"{path}.perEntryResultVersions.{entry_id}: manifest-per-entry-value: 结果版本必须是非空字符串")

    projection = value.get("compatibleProjection")
    if not isinstance(projection, list):
        issues.append(f"{path}.compatibleProjection: manifest-projection: compatibleProjection 必须是数组")
    else:
        for index, entry in enumerate(projection):
            entry_path = f"{path}.compatibleProjection[{index}]"
            if not _is_record(entry):
                issues.append(f"{entry_path}: manifest-projection-item: 投影项必须是对象")
                continue
            _require_opaque_id(entry, "entryId", entry_path, issues)
            _require_string(entry, "legacyWord", entry_path, issues)
            _optional_string(entry, "phonetic", entry_path, issues)
            if entry.get("notation") is not None:
                _require_enum(entry, "notation", _NOTATIONS, entry_path, issues)

    license_assets = value.get("licenseAssets")
    if not isinstance(license_assets, list) or len(license_assets) == 0:
        issues.append(f"{path}.licenseAssets: manifest-license-assets: manifest 必须包含许可资产")
    else:
        wiktionary_licenses: list[str] = []
        for index, asset in enumerate(license_assets):
            asset_path = f"{path}.licenseAssets[{index}]"
            if not _is_record(asset):
                issues.append(f"{asset_path}: manifest-license-asset: 许可资产必须是对象")
                continue
            for key in ("spdx", "url", "noticePath"):
                _require_string(asset, key, asset_path, issues)
            _require_enum(asset, "scope", _LICENSE_SCOPE, asset_path, issues)
            if asset.get("scope") == "wiktionary-derived":
                if asset.get("spdx") != "CC-BY-SA-4.0":
                    issues.append(f"{asset_path}.spdx: license-spdx: Wiktionary 衍生许可资产必须是 CC-BY-SA-4.0")
                else:
                    wiktionary_licenses.append(str(asset.get("spdx")))
        if not wiktionary_licenses:
            issues.append(f"{path}.licenseAssets: manifest-license-missing: 缺少 Wiktionary 衍生数据的 CC-BY-SA-4.0 许可资产")


def validate_checkpoint(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: checkpoint-required: checkpoint 必须是对象")
        return
    _require_schema(value, SCHEMA["checkpoint"], path, issues)
    _require_string(value, "batchId", path, issues)
    versions = value.get("schemaVersions")
    if not _is_record(versions):
        issues.append(f"{path}.schemaVersions: checkpoint-versions: schemaVersions 必须是对象")
    else:
        for key in ("overlay", "extractor", "tagRule"):
            _require_string(versions, key, f"{path}.schemaVersions", issues)
    budget = value.get("approvedBudget")
    if not _is_record(budget):
        issues.append(f"{path}.approvedBudget: checkpoint-budget: approvedBudget 必须是对象")
    else:
        _require_number(budget, "maxDistinctHeads", f"{path}.approvedBudget", issues)
        _require_number(budget, "maxDecompressedBytes", f"{path}.approvedBudget", issues)
        if not isinstance(budget.get("authorized"), bool):
            issues.append(f"{path}.approvedBudget.authorized: checkpoint-budget-authorized: authorized 必须是布尔值")
    _require_string_array(value, "queue", path, issues)
    _require_string_array(value, "startedDistinctHeads", path, issues)
    head_states = value.get("headStates")
    if not _is_record(head_states):
        issues.append(f"{path}.headStates: checkpoint-head-states: headStates 必须是对象")
    else:
        for head, state in head_states.items():
            if state not in _HEAD_STATES:
                issues.append(f"{path}.headStates.{head}: checkpoint-head-state: 词头状态非法")
    counts = value.get("counts")
    if not _is_record(counts):
        issues.append(f"{path}.counts: checkpoint-counts: counts 必须是对象")
    else:
        for key in ("requests", "retries", "auxiliaryRequests", "decompressedBytes", "networkBytes"):
            _require_number(counts, key, f"{path}.counts", issues)
    _optional_string(value, "lastCompletionEvidence", path, issues)
    if value.get("pauseReason") is not None:
        _require_enum(value, "pauseReason", _PAUSE_REASONS, path, issues)


def validate_approval(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: approval-required: 批准记录必须是对象")
        return
    _require_schema(value, SCHEMA["approval"], path, issues)
    for key in ("approvalId", "candidateHash", "baseManifestVersion", "approvedBy", "approvedAt"):
        _require_string(value, key, path, issues)
    _require_version_field(value, "identitySchemaVersion", SCHEMA["identity"], path, issues)
    _require_version_field(value, "evidenceSchemaVersion", SCHEMA["evidence"], path, issues)
    _require_version_field(value, "observationSchemaVersion", SCHEMA["observation"], path, issues)
    _require_version_field(value, "ruleSchemaVersion", SCHEMA["rule"], path, issues)
    _require_version_field(value, "resolvedSchemaVersion", SCHEMA["resolved"], path, issues)
    _require_string_array(value, "includedHeads", path, issues)
    _require_string_array(value, "excludedHeads", path, issues)
    if value.get("action") != "approve-batch":
        issues.append(f"{path}.action: approval-action: action 必须是 approve-batch")


def validate_display(value: Any, path: str, issues: list[str]) -> None:
    if not _is_record(value):
        issues.append(f"{path}: display-required: 展示 DTO 必须是对象")
        return
    _require_schema(value, SCHEMA["display"], path, issues)
    _require_opaque_id(value, "entryId", path, issues)
    _require_string(value, "word", path, issues)
    _require_string_maybe_empty(value, "originalIpa", path, issues)
    _require_enum(value, "role", _GRAMMAR_ROLES, path, issues)
    _require_enum(value, "notation", _NOTATIONS, path, issues)
    _require_enum(value, "tier", _DISPOSITIONS, path, issues)
    _require_enum(value, "reviewStatus", _REVIEW_STATUS, path, issues)
    _require_enum(value, "origin", _PROVENANCE, path, issues)
    _require_string_array(value, "usage", path, issues)

    accent = value.get("accent")
    if not _is_record(accent):
        issues.append(f"{path}.accent: display-accent: accent 必须是对象")
    else:
        _require_enum(accent, "class", _ACCENT_CLASSES, f"{path}.accent", issues)
        _require_string(accent, "label", f"{path}.accent", issues)
        _optional_string(accent, "region", f"{path}.accent", issues)
        if not isinstance(accent.get("unspecified"), bool):
            issues.append(f"{path}.accent.unspecified: display-accent-unspecified: unspecified 必须是布尔值")
        if accent.get("unspecified") is True and accent.get("class") != "unspecified":
            issues.append(f"{path}.accent: display-accent-disguise: 未注明口音不得标为 UK/US 等具体口音")

    attribution = value.get("attribution")
    if not _is_record(attribution):
        issues.append(f"{path}.attribution: display-attribution: attribution 必须是对象")
    else:
        for key in ("pageUrl", "historyUrl", "licenseUrl", "licenseSpdx", "changeNotice"):
            _require_string(attribution, key, f"{path}.attribution", issues)


# ---------------------------------------------------------------------------
# 文档集与引用完整性
# ---------------------------------------------------------------------------


def _collect_ids(items: list[Any], key: str, path: str, issues: list[str]) -> set[str]:
    ids: set[str] = set()
    for index, item in enumerate(items):
        if not _is_record(item):
            continue
        value = item.get(key)
        if not isinstance(value, str) or value == "":
            continue
        if value in ids:
            issues.append(f"{path}[{index}].{key}: duplicate-id: 重复 ID {value}")
            continue
        ids.add(value)
    return ids


def validate_document_set(value: Any) -> list[str]:
    """校验完整文档集：形状 + 交叉引用 + 许可 + 批准绑定。返回问题列表（空即合法）。"""

    issues: list[str] = []
    if not _is_record(value):
        return ["$: document-set-required: 文档集必须是对象"]

    # 必需列表字段缺失或类型错误 → 直接拒绝，不得默认空数组。
    for key in _REQUIRED_DOCUMENT_LISTS:
        if not isinstance(value.get(key), list):
            issues.append(f"$.{key}: document-list-required: {key} 必须是数组")
    # 可选列表字段：若存在则必须是数组（不得静默丢弃非法类型）。
    for key in ("identityLexemeIds", "displays"):
        if value.get(key) is not None and not isinstance(value.get(key), list):
            issues.append(f"$.{key}: document-list-optional-array: {key} 若存在必须是数组")
    if not _is_record(value.get("manifest")):
        issues.append("$.manifest: manifest-required: manifest 必须是对象")

    def as_list(key: str) -> list[Any]:
        candidate = value.get(key)
        return candidate if isinstance(candidate, list) else []

    evidence = as_list("evidence")
    observations = as_list("observations")
    rules = as_list("rules")
    resolved = as_list("resolved")
    approvals = as_list("approvals")
    checkpoints = as_list("checkpoints")
    displays = as_list("displays")

    identity_list = value.get("identityEntryIds") if isinstance(value.get("identityEntryIds"), list) else []
    identity_ids: set[str] = set()
    for index, entry_id in enumerate(identity_list):
        if not isinstance(entry_id, str) or entry_id == "":
            issues.append(f"$.identityEntryIds[{index}]: identity-id: 身份 ID 必须是非空字符串")
            continue
        if not is_opaque_id_format(entry_id) or not entry_id.startswith("ent_"):
            issues.append(f"$.identityEntryIds[{index}]: invalid-id: entry 身份 ID 必须是 ent_ 不透明 ID")
        if entry_id in identity_ids:
            issues.append(f"$.identityEntryIds[{index}]: duplicate-id: 重复身份 ID {entry_id}")
        identity_ids.add(entry_id)

    # lexeme 身份：可选列表，但一旦存在必须校验前缀/重复，且供 known scope 引用核对。
    lexeme_list = value.get("identityLexemeIds") if isinstance(value.get("identityLexemeIds"), list) else []
    lexeme_ids: set[str] = set()
    for index, lexeme_id in enumerate(lexeme_list):
        if not isinstance(lexeme_id, str) or lexeme_id == "":
            issues.append(f"$.identityLexemeIds[{index}]: identity-id: lexeme 身份 ID 必须是非空字符串")
            continue
        if not is_opaque_id_format(lexeme_id) or not lexeme_id.startswith("lex_"):
            issues.append(f"$.identityLexemeIds[{index}]: invalid-id: lexeme 身份 ID 必须是 lex_ 不透明 ID")
        if lexeme_id in lexeme_ids:
            issues.append(f"$.identityLexemeIds[{index}]: duplicate-id: 重复 lexeme 身份 ID {lexeme_id}")
        lexeme_ids.add(lexeme_id)

    for index, item in enumerate(evidence):
        validate_source_evidence(item, f"$.evidence[{index}]", issues)
    for index, item in enumerate(observations):
        validate_observation(item, f"$.observations[{index}]", issues)
    for index, item in enumerate(rules):
        validate_rule(item, f"$.rules[{index}]", issues)
    for index, item in enumerate(resolved):
        validate_resolved(item, f"$.resolved[{index}]", issues)
    validate_manifest(value.get("manifest"), "$.manifest", issues)
    for index, item in enumerate(approvals):
        validate_approval(item, f"$.approvals[{index}]", issues)
    for index, item in enumerate(checkpoints):
        validate_checkpoint(item, f"$.checkpoints[{index}]", issues)
    for index, item in enumerate(displays):
        validate_display(item, f"$.displays[{index}]", issues)

    evidence_ids = _collect_ids(evidence, "evidenceId", "$.evidence", issues)
    observation_ids = _collect_ids(observations, "observationId", "$.observations", issues)
    approval_ids = _collect_ids(approvals, "approvalId", "$.approvals", issues)
    rule_ids = _collect_ids(rules, "ruleId", "$.rules", issues)

    for index, item in enumerate(observations):
        if not _is_record(item):
            continue
        evidence_id = item.get("evidenceId")
        if isinstance(evidence_id, str) and evidence_id not in evidence_ids:
            issues.append(f"$.observations[{index}].evidenceId: dangling-reference: 引用了不存在的证据 {evidence_id}")

    # 范围内 explicit-all 证据必须存在。
    scope_paths: list[tuple[Any, str]] = []
    for index, item in enumerate(observations):
        scope_paths.append((item.get("applicability") if _is_record(item) else None, f"$.observations[{index}].applicability"))
    for index, item in enumerate(rules):
        scope_paths.append((item.get("conditions") if _is_record(item) else None, f"$.rules[{index}].conditions"))
    for index, item in enumerate(resolved):
        scope_paths.append((item.get("conditions") if _is_record(item) else None, f"$.resolved[{index}].conditions"))
    for scope, path in scope_paths:
        for ref in collect_scope_evidence_refs(scope):
            if ref not in evidence_ids:
                issues.append(f"{path}: dangling-reference: 范围 explicit-all 引用了不存在的证据 {ref}")

    # known 维度的 entry / lexeme 取值必须引用已声明身份（未知不得伪装为具体 ID）。
    for scope, path in scope_paths:
        if not _is_record(scope):
            continue
        entry_constraint = scope.get("entry")
        if _is_record(entry_constraint) and entry_constraint.get("kind") == "known":
            values = entry_constraint.get("values")
            if isinstance(values, list):
                for ref_index, ref in enumerate(values):
                    if isinstance(ref, str) and ref not in identity_ids:
                        issues.append(
                            f"{path}.entry.values[{ref_index}]: dangling-reference: known entry 引用了不存在的条目 {ref}"
                        )
        lexeme_constraint = scope.get("lexeme")
        if _is_record(lexeme_constraint) and lexeme_constraint.get("kind") == "known":
            values = lexeme_constraint.get("values")
            if isinstance(values, list):
                for ref_index, ref in enumerate(values):
                    if isinstance(ref, str) and ref not in lexeme_ids:
                        issues.append(
                            f"{path}.lexeme.values[{ref_index}]: dangling-reference: known lexeme 引用了不存在的 lexeme {ref}"
                        )

    for index, item in enumerate(rules):
        if not _is_record(item):
            continue
        refs = item.get("evidenceRefs")
        if isinstance(refs, list):
            for ref_index, ref in enumerate(refs):
                if isinstance(ref, str) and ref not in evidence_ids:
                    issues.append(f"$.rules[{index}].evidenceRefs[{ref_index}]: dangling-reference: 引用了不存在的证据 {ref}")
        target = item.get("target")
        if _is_record(target) and target.get("kind") == "entry":
            entry_id = target.get("entryId")
            if isinstance(entry_id, str) and entry_id not in identity_ids:
                issues.append(f"$.rules[{index}].target.entryId: dangling-reference: 引用了不存在的条目 {entry_id}")
        operations = item.get("operations")
        if isinstance(operations, list):
            for op_index, operation in enumerate(operations):
                if not _is_record(operation):
                    continue
                op_refs = operation.get("observationRefs")
                if not isinstance(op_refs, list):
                    continue
                for ref_index, ref in enumerate(op_refs):
                    if isinstance(ref, str) and ref not in observation_ids:
                        issues.append(
                            f"$.rules[{index}].operations[{op_index}].observationRefs[{ref_index}]: dangling-reference: 引用了不存在的观测 {ref}"
                        )
        # supersedes / revokedBy 必须引用存在的规则，且不得自引用。
        for key in ("supersedesRuleId", "revokedByRuleId"):
            ref = item.get(key)
            if not isinstance(ref, str):
                continue
            if ref == item.get("ruleId"):
                issues.append(f"$.rules[{index}].{key}: self-reference: {key} 不得引用自身")
            elif ref not in rule_ids:
                issues.append(f"$.rules[{index}].{key}: dangling-reference: 引用了不存在的规则 {ref}")

    for index, item in enumerate(resolved):
        if not _is_record(item):
            continue
        entry_id = item.get("entryId")
        if isinstance(entry_id, str) and entry_id not in identity_ids:
            issues.append(f"$.resolved[{index}].entryId: dangling-reference: 引用了不存在的条目 {entry_id}")
        for key in ("defaultReadingRefs", "supplementalReadingRefs", "retainedReadingRefs"):
            refs = item.get(key)
            if not isinstance(refs, list):
                continue
            for ref_index, ref in enumerate(refs):
                if isinstance(ref, str) and ref not in observation_ids:
                    issues.append(f"$.resolved[{index}].{key}[{ref_index}]: dangling-reference: 引用了不存在的观测 {ref}")
        # 逐字段来源引用：user/system 指规则，qualified-source 指观测，legacy 允许证据/观测/规则。
        provenance = item.get("fieldProvenance")
        if isinstance(provenance, list):
            for prov_index, prov in enumerate(provenance):
                if not _is_record(prov):
                    continue
                ref = prov.get("ref")
                if not isinstance(ref, str):
                    continue
                source = prov.get("source")
                if source in ("user", "system"):
                    if ref not in rule_ids:
                        issues.append(
                            f"$.resolved[{index}].fieldProvenance[{prov_index}].ref: dangling-reference: fieldProvenance 应按 source 引用规则 {ref}"
                        )
                elif source == "qualified-source":
                    if ref not in observation_ids:
                        issues.append(
                            f"$.resolved[{index}].fieldProvenance[{prov_index}].ref: dangling-reference: qualified-source 的 fieldProvenance 应引用观测 {ref}"
                        )
                elif source == "legacy":
                    if ref not in evidence_ids and ref not in observation_ids and ref not in rule_ids:
                        issues.append(
                            f"$.resolved[{index}].fieldProvenance[{prov_index}].ref: dangling-reference: legacy 的 fieldProvenance 引用了不存在的来源 {ref}"
                        )
        # suppression.ruleId 必须引用存在的规则。
        suppression = item.get("suppression")
        if _is_record(suppression):
            rule_id = suppression.get("ruleId")
            if isinstance(rule_id, str) and rule_id not in rule_ids:
                issues.append(
                    f"$.resolved[{index}].suppression.ruleId: dangling-reference: suppression 引用了不存在的规则 {rule_id}"
                )

    # 检查点 lastCompletionEvidence 必须引用存在的证据。
    for index, item in enumerate(checkpoints):
        if not _is_record(item):
            continue
        ref = item.get("lastCompletionEvidence")
        if isinstance(ref, str) and ref not in evidence_ids:
            issues.append(f"$.checkpoints[{index}].lastCompletionEvidence: dangling-reference: 引用了不存在的证据 {ref}")

    for index, item in enumerate(displays):
        if not _is_record(item):
            continue
        entry_id = item.get("entryId")
        if isinstance(entry_id, str) and entry_id not in identity_ids:
            issues.append(f"$.displays[{index}].entryId: dangling-reference: 引用了不存在的条目 {entry_id}")

    manifest = value.get("manifest")
    if _is_record(manifest):
        approval_id = manifest.get("approvalId")
        if isinstance(approval_id, str) and approval_id not in approval_ids:
            issues.append(f"$.manifest.approvalId: dangling-reference: 引用了不存在的批准 {approval_id}")
        elif isinstance(approval_id, str):
            matching = [item for item in approvals if _is_record(item) and item.get("approvalId") == approval_id]
            approval = matching[0] if matching else None
            if _is_record(approval):
                if approval.get("candidateHash") != manifest.get("candidateHash"):
                    issues.append("$.manifest.candidateHash: approval-mismatch: manifest 与批准记录的 candidateHash 不一致")
                if approval.get("baseManifestVersion") != manifest.get("previousManifestVersion"):
                    issues.append(
                        "$.manifest.previousManifestVersion: approval-mismatch: 批准绑定的 base manifest 与当前 baseline 不一致"
                    )
        per_entry = manifest.get("perEntryResultVersions")
        if _is_record(per_entry):
            for entry_id in per_entry:
                if entry_id not in identity_ids:
                    issues.append(
                        f"$.manifest.perEntryResultVersions.{entry_id}: dangling-reference: 结果版本引用了不存在的条目 {entry_id}"
                    )
        # 兼容投影的 entryId 必须引用已声明身份。
        projection = manifest.get("compatibleProjection")
        if isinstance(projection, list):
            for proj_index, entry in enumerate(projection):
                if not _is_record(entry):
                    continue
                entry_id = entry.get("entryId")
                if isinstance(entry_id, str) and entry_id not in identity_ids:
                    issues.append(
                        f"$.manifest.compatibleProjection[{proj_index}].entryId: dangling-reference: 投影引用了不存在的条目 {entry_id}"
                    )

    return issues
