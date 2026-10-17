"""不可变来源证据与完整响应缓存。

对应 task 6.4。要点：

- 证据保存 page / history / revision、提取时间、请求/渲染/提取器/标签规则版本、
  HTTP 响应 hash、以及 **IPA + qualifier + applicability 语义 fingerprint**、许可
  与归因、变更说明。
- 语义 fingerprint 只覆盖语义字段（IPA、notation、完整度、qualifier、用途/地域
  标签、role、pos、etymology、8 维 applicability），页面无关文本/排版变化不会
  误触；qualifier 与标签比较前做 NFC + 边界空白规整，原值不受影响。
- 完整响应缓存带来源许可；截断/不完整响应**不得**作为成功缓存写入。
- 缓存以“内容 hash + 来源/时间/许可归因”共同标识 provenance：同一 body 来自不同
  source / 抓取时间 / 许可时不会被静默覆盖而丢失来源。
- 缓存加载时校验 body hash、complete 标志、许可元信息与 metadata 身份，发现篡改
  即报错（fail closed）。
- 历史证据只追加、不覆盖：同一 revid 重新渲染产生新证据而非改写旧证据。
- 支持带来源许可的离线重解析。

不承诺 ``oldid`` 冻结模板，也不承诺完整历史渲染可复现。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass, field
from html import unescape
from pathlib import Path
from typing import Any, Final, Iterable, Mapping

from . import EXTRACTOR_VERSION, TAG_RULE_VERSION
from .html_extract import CLASS_RULE_VERSION, Observation

WIKTIONARY_LICENSE_ID: Final = "CC BY-SA 4.0"
WIKTIONARY_LICENSE_URL: Final = "https://creativecommons.org/licenses/by-sa/4.0/"
DEFAULT_ATTRIBUTION: Final = "Wiktionary contributors"
REQUEST_VERSION: Final = "action-api/1"
RENDER_VERSION: Final = "wikitext-render/1"

_HEX64: Final = re.compile(r"^[0-9a-f]{64}$")
_ACCEPTED_LICENSE_IDS: Final = frozenset((WIKTIONARY_LICENSE_ID, "CC-BY-SA-4.0"))
_ACCEPTED_LICENSE_URLS: Final = frozenset(
    (
        WIKTIONARY_LICENSE_URL.rstrip("/"),
        "https://creativecommons.org/licenses/by-sa/4.0",
    )
)


def _require_nonempty_str(payload: Mapping[str, Any], key: str) -> str:
    if key not in payload:
        raise ValueError(f"SourceEvidence 缺少必需字段 {key}")
    value = payload[key]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"SourceEvidence 字段 {key} 必须为非空字符串，实际 {value!r}")
    return value


def _require_hex64(payload: Mapping[str, Any], key: str, *, allow_none: bool = False) -> str | None:
    value = payload.get(key)
    if allow_none and value is None:
        return None
    if not isinstance(value, str) or not _HEX64.match(value):
        raise ValueError(f"SourceEvidence 字段 {key} 必须为 64 位十六进制，实际 {value!r}")
    return value


def _valid_cc_by_sa_url(url: object) -> bool:
    return isinstance(url, str) and url.rstrip("/") in _ACCEPTED_LICENSE_URLS


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _nfc_strip(text: str) -> str:
    """比较用规范化：解码 HTML 实体 + NFC + 去边界空白；不改原值。"""
    return unicodedata.normalize("NFC", unescape(text)).strip()


def _normalize_scope_json(scope: Mapping[str, Any]) -> dict[str, Any]:
    """fingerprint 用：known 值做 NFC + 去空白并排序；其余保持原样。"""
    if scope.get("kind") == "known":
        values = sorted(
            {_nfc_strip(str(value)) for value in scope.get("values", []) if _nfc_strip(str(value))}
        )
        return {"kind": "known", "values": values}
    return dict(scope)


def _normalize_applicability(applicability: Any) -> dict[str, Any]:
    return {
        dimension: _normalize_scope_json(scope)
        for dimension, scope in applicability.to_json().items()
    }


def compute_semantic_fingerprint(observations: Iterable[Observation]) -> str:
    """对语义字段做规范化后求 fingerprint。

    只包含 IPA、notation、complete、qualifiers（NFC + 边界空白规整后排序）、
    用途/地域标签、role(s)、pos、etymology 与 8 维 applicability。**不含** raw
    HTML、表格/标题排版 class 与结构路径，因此无关文本/排版变化不会改变
    fingerprint；而 region/archaic/rare 等用途标签变化会改变 fingerprint。
    """
    semantic: list[dict[str, Any]] = []
    for observation in observations:
        qualifiers = sorted(
            {_nfc_strip(q) for q in observation.qualifiers if _nfc_strip(q)}
        )
        usage_labels = sorted(
            {_nfc_strip(label) for label in observation.usage_labels if _nfc_strip(label)}
        )
        # 未知限制 class：保守待分类，其存在/变化必须进入 fingerprint，供 3.2 判定。
        unclassified_tags = sorted(
            {
                _nfc_strip(tag)
                for tag in observation.unclassified_tags
                if _nfc_strip(tag)
            }
        )
        semantic.append(
            {
                "ipa": observation.ipa,
                "notation": observation.notation,
                "complete": observation.complete,
                "qualifiers": qualifiers,
                "usageLabels": usage_labels,
                "unclassifiedTags": unclassified_tags,
                "roles": list(observation.roles),
                "pos": observation.pos,
                "etymology": observation.etymology,
                "applicability": _normalize_applicability(observation.applicability),
            }
        )
    semantic.sort(key=_canonical_json)
    payload = {"classRuleVersion": CLASS_RULE_VERSION, "observations": semantic}
    return _sha256_bytes(_canonical_json(payload).encode("utf-8"))


@dataclass(frozen=True, slots=True)
class SourceEvidence:
    """一条不可变来源证据。"""

    word: str
    language: str
    page_url: str
    history_url: str
    revid: int | None
    fetched_at: str
    http_sha256: str
    semantic_fingerprint: str
    extractor_version: str = EXTRACTOR_VERSION
    tag_rule_version: str = TAG_RULE_VERSION
    request_version: str = REQUEST_VERSION
    render_version: str = RENDER_VERSION
    license_id: str = WIKTIONARY_LICENSE_ID
    license_url: str = WIKTIONARY_LICENSE_URL
    attribution: str = DEFAULT_ATTRIBUTION
    cache_sha256: str | None = None
    status: str = "extracted"
    change_note: str | None = None

    @property
    def evidence_id(self) -> str:
        # evidence identity 覆盖全部实质不可变元信息（语言/页面/历史/版本/许可/缓存/
        # 状态/变更），避免同一响应 body 在不同 provenance 下 evidenceId 碰撞。
        return _sha256_bytes(
            _canonical_json(
                {
                    "word": self.word,
                    "language": self.language,
                    "pageUrl": self.page_url,
                    "historyUrl": self.history_url,
                    "revid": self.revid,
                    "fetchedAt": self.fetched_at,
                    "httpSha256": self.http_sha256,
                    "semanticFingerprint": self.semantic_fingerprint,
                    "extractorVersion": self.extractor_version,
                    "tagRuleVersion": self.tag_rule_version,
                    "requestVersion": self.request_version,
                    "renderVersion": self.render_version,
                    "licenseId": self.license_id,
                    "licenseUrl": self.license_url,
                    "attribution": self.attribution,
                    "cacheSha256": self.cache_sha256,
                    "status": self.status,
                    "changeNote": self.change_note,
                }
            ).encode("utf-8")
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "evidenceId": self.evidence_id,
            "word": self.word,
            "language": self.language,
            "pageUrl": self.page_url,
            "historyUrl": self.history_url,
            "revid": self.revid,
            "fetchedAt": self.fetched_at,
            "httpSha256": self.http_sha256,
            "semanticFingerprint": self.semantic_fingerprint,
            "extractorVersion": self.extractor_version,
            "tagRuleVersion": self.tag_rule_version,
            "requestVersion": self.request_version,
            "renderVersion": self.render_version,
            "licenseId": self.license_id,
            "licenseUrl": self.license_url,
            "attribution": self.attribution,
            "cacheSha256": self.cache_sha256,
            "status": self.status,
            "changeNote": self.change_note,
        }

    @classmethod
    def from_json(cls, payload: Mapping[str, Any]) -> "SourceEvidence":
        """严格读取：必需元信息缺失/类型不符/许可不实即报错，不静默补默认。"""
        if not isinstance(payload, Mapping):
            raise ValueError("SourceEvidence payload 必须是对象")
        word = _require_nonempty_str(payload, "word")
        language = _require_nonempty_str(payload, "language")
        page_url = _require_nonempty_str(payload, "pageUrl")
        history_url = _require_nonempty_str(payload, "historyUrl")
        fetched_at = _require_nonempty_str(payload, "fetchedAt")
        http_sha256 = _require_hex64(payload, "httpSha256")
        semantic_fingerprint = _require_hex64(payload, "semanticFingerprint")
        cache_sha256 = _require_hex64(payload, "cacheSha256", allow_none=True)
        extractor_version = _require_nonempty_str(payload, "extractorVersion")
        tag_rule_version = _require_nonempty_str(payload, "tagRuleVersion")
        request_version = _require_nonempty_str(payload, "requestVersion")
        render_version = _require_nonempty_str(payload, "renderVersion")
        status = _require_nonempty_str(payload, "status")
        attribution = _require_nonempty_str(payload, "attribution")
        license_id = _require_nonempty_str(payload, "licenseId")
        license_url = _require_nonempty_str(payload, "licenseUrl")
        if license_id not in _ACCEPTED_LICENSE_IDS:
            raise ValueError(f"LicenseId 不是 CC BY-SA 4.0：{license_id!r}")
        if not _valid_cc_by_sa_url(license_url):
            raise ValueError(f"LicenseUrl 不是 CC BY-SA 4.0 实际 URL：{license_url!r}")
        if "revid" not in payload:
            raise ValueError("SourceEvidence 缺少必需字段 revid")
        revid = payload["revid"]
        if revid is not None:
            if not isinstance(revid, int) or isinstance(revid, bool):
                raise ValueError(f"revid 必须为 int 或 None，实际 {revid!r}")
        evidence = cls(
            word=word,
            language=language,
            page_url=page_url,
            history_url=history_url,
            revid=revid,
            fetched_at=fetched_at,
            http_sha256=http_sha256,
            semantic_fingerprint=semantic_fingerprint,
            extractor_version=extractor_version,
            tag_rule_version=tag_rule_version,
            request_version=request_version,
            render_version=render_version,
            license_id=license_id,
            license_url=license_url,
            attribution=attribution,
            cache_sha256=cache_sha256,
            status=status,
            change_note=payload.get("changeNote"),
        )
        declared = payload.get("evidenceId")
        if declared is not None and str(declared) != evidence.evidence_id:
            raise ValueError("evidenceId 与按内容重算不一致，拒绝不实身份")
        return evidence


class ImmutableViolation(RuntimeError):
    """试图覆盖已存在的不可变证据/缓存。"""


class IncompleteCacheError(ValueError):
    """尝试把截断/不完整响应写入成功缓存。"""


class CacheIntegrityError(RuntimeError):
    """缓存加载校验失败（hash / 许可 / complete / metadata 身份不一致）。"""


@dataclass
class CacheEntry:
    http_sha256: str
    body: bytes
    content_type: str
    complete: bool
    source_url: str
    license_id: str = WIKTIONARY_LICENSE_ID
    license_url: str = WIKTIONARY_LICENSE_URL
    attribution: str = DEFAULT_ATTRIBUTION
    fetched_at: str = ""
    provenance_id: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "httpSha256": self.http_sha256,
            "provenanceId": self.provenance_id,
            "bodyFile": f"{self.http_sha256}.body",
            "contentType": self.content_type,
            "complete": self.complete,
            "sourceUrl": self.source_url,
            "licenseId": self.license_id,
            "licenseUrl": self.license_url,
            "attribution": self.attribution,
            "fetchedAt": self.fetched_at,
            "bytes": len(self.body),
        }


class ResponseCache:
    """完整响应缓存：write-once、immutable、可落盘以便离线重解析。

    同一份 body 来自不同 source / 抓取时间 / 许可时使用不同的 ``provenanceId``，
    各自保留，不会互相覆盖或丢失来源。
    """

    def __init__(self, directory: Path | None = None, *, read_only: bool = False) -> None:
        self.directory = directory
        self.read_only = read_only
        self._entries: dict[str, CacheEntry] = {}
        self._by_body: dict[str, list[str]] = {}
        if directory is not None:
            if not read_only:
                directory.mkdir(parents=True, exist_ok=True)
            self._load()

    # ------------------------------------------------------------------
    def _provenance_id(
        self,
        *,
        http_sha256: str,
        content_type: str,
        source_url: str,
        fetched_at: str,
        license_id: str,
        license_url: str,
        attribution: str,
    ) -> str:
        return _sha256_bytes(
            _canonical_json(
                {
                    "httpSha256": http_sha256,
                    "contentType": content_type,
                    "sourceUrl": source_url,
                    "fetchedAt": fetched_at,
                    "licenseId": license_id,
                    "licenseUrl": license_url,
                    "attribution": attribution,
                    "complete": True,
                }
            ).encode("utf-8")
        )

    def _index(self, entry: CacheEntry) -> None:
        self._entries[entry.provenance_id] = entry
        bucket = self._by_body.setdefault(entry.http_sha256, [])
        if entry.provenance_id not in bucket:
            bucket.append(entry.provenance_id)

    # ------------------------------------------------------------------
    def _load(self) -> None:
        assert self.directory is not None
        for metadata_path in sorted(self.directory.glob("*.meta.json")):
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            digest = str(payload["httpSha256"])
            expected_body_file = f"{digest}.body"
            body_file = str(payload.get("bodyFile") or "")
            # bodyFile 必须与 content hash 对应，且不得路径穿越。
            if (
                body_file != expected_body_file
                or "/" in body_file
                or "\\" in body_file
                or ".." in body_file
            ):
                raise CacheIntegrityError(f"非法 bodyFile: {body_file!r}")
            body_path = self.directory / body_file
            if not body_path.exists():
                raise CacheIntegrityError(f"缓存缺少 body 文件: {body_file}")
            body = body_path.read_bytes()
            if _sha256_bytes(body) != digest:
                raise CacheIntegrityError(f"缓存 body hash 不匹配: {body_file}")
            declared_bytes = payload.get("bytes")
            if (
                not isinstance(declared_bytes, int)
                or isinstance(declared_bytes, bool)
                or declared_bytes != len(body)
            ):
                raise CacheIntegrityError(f"缓存 bytes 声明非法或与长度不符: {body_file}")
            # complete 必须是严格 JSON true（不接受 "false"/其他真值）。
            if payload.get("complete") is not True:
                raise CacheIntegrityError(f"缓存 entry 非严格完整: {metadata_path.name}")
            license_id = str(payload.get("licenseId") or "")
            license_url = str(payload.get("licenseUrl") or "")
            attribution = str(payload.get("attribution") or "")
            source_url = str(payload.get("sourceUrl") or "")
            if license_id not in _ACCEPTED_LICENSE_IDS:
                raise CacheIntegrityError(f"缓存许可 id 不合法: {metadata_path.name}")
            if not _valid_cc_by_sa_url(license_url):
                raise CacheIntegrityError(f"缓存许可 URL 非 CC BY-SA 4.0: {metadata_path.name}")
            if not attribution.strip() or not source_url.strip():
                raise CacheIntegrityError(f"缓存缺少 sourceURL/attribution: {metadata_path.name}")
            content_type = str(payload.get("contentType", "application/octet-stream"))
            fetched_at = str(payload.get("fetchedAt", ""))
            provenance_id = metadata_path.name[: -len(".meta.json")]
            declared_provenance = payload.get("provenanceId")
            if declared_provenance is not None and str(declared_provenance) != provenance_id:
                raise CacheIntegrityError(
                    f"缓存声明 provenanceId 与文件名不一致: {metadata_path.name}"
                )
            expected = self._provenance_id(
                http_sha256=digest,
                content_type=content_type,
                source_url=source_url,
                fetched_at=fetched_at,
                license_id=license_id,
                license_url=license_url,
                attribution=attribution,
            )
            if expected != provenance_id:
                raise CacheIntegrityError(
                    f"缓存 provenance 身份不匹配: {metadata_path.name}"
                )
            self._index(
                CacheEntry(
                    http_sha256=digest,
                    body=body,
                    content_type=content_type,
                    complete=True,
                    source_url=source_url,
                    license_id=license_id,
                    license_url=license_url,
                    attribution=attribution,
                    fetched_at=fetched_at,
                    provenance_id=provenance_id,
                )
            )

    def put(
        self,
        body: bytes,
        *,
        content_type: str,
        complete: bool,
        source_url: str,
        fetched_at: str,
        license_id: str = WIKTIONARY_LICENSE_ID,
        license_url: str = WIKTIONARY_LICENSE_URL,
        attribution: str = DEFAULT_ATTRIBUTION,
    ) -> CacheEntry:
        if self.read_only:
            raise CacheIntegrityError("只读缓存不得写入")
        # complete 必须是严格 True（字符串 "false"/其他真值不得当作完整）。
        if complete is not True:
            raise IncompleteCacheError("不完整/截断响应不得写入成功缓存")
        if not isinstance(source_url, str) or not source_url.strip():
            raise ValueError("成功缓存必须提供非空 sourceURL")
        if not isinstance(attribution, str) or not attribution.strip():
            raise ValueError("成功缓存必须提供非空 attribution")
        if license_id not in _ACCEPTED_LICENSE_IDS:
            raise ValueError(f"成功缓存许可必须为 CC BY-SA 4.0，实际 {license_id!r}")
        if not _valid_cc_by_sa_url(license_url):
            raise ValueError(f"成功缓存许可 URL 必须为 CC BY-SA 4.0 实际地址，实际 {license_url!r}")
        digest = _sha256_bytes(body)
        provenance_id = self._provenance_id(
            http_sha256=digest,
            content_type=content_type,
            source_url=source_url,
            fetched_at=fetched_at,
            license_id=license_id,
            license_url=license_url,
            attribution=attribution,
        )
        existing = self._entries.get(provenance_id)
        if existing is not None:
            if existing.body != body:
                # 内容寻址下不应发生；保守拒绝覆盖。
                raise ImmutableViolation("缓存 key 冲突且内容不同")
            return existing
        entry = CacheEntry(
            http_sha256=digest,
            body=body,
            content_type=content_type,
            complete=True,
            source_url=source_url,
            license_id=license_id,
            license_url=license_url,
            attribution=attribution,
            fetched_at=fetched_at,
            provenance_id=provenance_id,
        )
        if self.directory is not None:
            self._persist(entry)
        self._index(entry)
        return entry

    def _persist(self, entry: CacheEntry) -> None:
        assert self.directory is not None
        body_path = self.directory / f"{entry.http_sha256}.body"
        meta_path = self.directory / f"{entry.provenance_id}.meta.json"
        metadata = json.dumps(entry.to_json(), ensure_ascii=False, sort_keys=True,
                              indent=2).encode("utf-8")
        self._persist_bytes(body_path, entry.body)
        self._persist_bytes(meta_path, metadata)

    @staticmethod
    def _persist_bytes(path: Path, payload: bytes) -> None:
        # Retry may find a body or metadata already committed by a failed put.
        # Identical bytes are idempotent; different bytes remain immutable.
        if path.exists():
            if path.read_bytes() != payload:
                raise ImmutableViolation("缓存文件已存在且内容不同")
        else:
            fd, temporary = tempfile.mkstemp(prefix=".cache-", suffix=".tmp", dir=path.parent)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        # Also sync on an idempotent retry after a previous directory-fsync failure.
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        if path.read_bytes() != payload:
            raise CacheIntegrityError("缓存落盘后校验失败")

    def get(self, http_sha256: str) -> CacheEntry | None:
        """按 body hash 取唯一 provenance；多 provenance 时 fail closed，不默选第一条。"""
        bucket = self._by_body.get(http_sha256)
        if not bucket:
            return None
        if len(bucket) > 1:
            raise CacheIntegrityError(
                f"body {http_sha256} 存在多个 provenance（{len(bucket)}），"
                "请用 get_by_provenance/provenance_for 明确指定"
            )
        return self._entries[bucket[0]]

    def get_by_provenance(self, provenance_id: str) -> CacheEntry | None:
        return self._entries.get(provenance_id)

    def provenance_for(self, http_sha256: str) -> list[CacheEntry]:
        return [self._entries[pid] for pid in self._by_body.get(http_sha256, [])]

    def entries(self) -> list[CacheEntry]:
        return [self._entries[key] for key in sorted(self._entries)]

    def __len__(self) -> int:
        return len(self._entries)


@dataclass
class EvidenceLedger:
    """只追加的来源证据历史，不覆盖旧证据。"""

    records: list[SourceEvidence] = field(default_factory=list)
    _by_id: dict[str, SourceEvidence] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self._by_id = {}
        for record in self.records:
            if record.evidence_id in self._by_id:
                raise ImmutableViolation("重复 evidenceId")
            self._by_id[record.evidence_id] = record

    def record(self, evidence: SourceEvidence) -> bool:
        """追加证据。返回 True 表示新增，False 表示完全相同（幂等）。"""
        existing = self._by_id.get(evidence.evidence_id)
        if existing is not None:
            if existing.to_json() == evidence.to_json():
                return False
            raise ImmutableViolation("evidenceId 冲突且内容不同")
        self._by_id[evidence.evidence_id] = evidence
        self.records.append(evidence)
        return True

    def latest_for(self, word: str) -> SourceEvidence | None:
        for record in reversed(self.records):
            if record.word == word:
                return record
        return None

    def history_for(self, word: str) -> list[SourceEvidence]:
        return [record for record in self.records if record.word == word]

    def to_json(self) -> list[dict[str, Any]]:
        return [record.to_json() for record in self.records]

    @classmethod
    def from_json(cls, payload: list[Mapping[str, Any]]) -> "EvidenceLedger":
        return cls(records=[SourceEvidence.from_json(item) for item in payload])
