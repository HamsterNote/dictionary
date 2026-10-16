"""内部 scope 表示：兼容 contracts lane 的三种格式。

设计决策 3 要求每个适用范围维度使用三种显式形式之一，不能用空字段隐式表示
“全部”：

- ``known(values)``：来源或人工明确给出的一组取值。
- ``explicit-all(evidence)``：只有来源或人工**明确**表示通用范围时才能用；
  必须带证据引用。
- ``unknown(reason)``：无法解释/关联的情况，保留为待核验，不自行提升为通配。

真正的 JSON 合同由另一 lane 的 ``scripts/wiktionary_per_word/contracts.py``
定义。本模块只做**内部设计**，序列化结果同时可被三种格式机械对齐：

    {"kind": "known", "values": ["RP", "GA"]}
    {"kind": "explicit-all", "evidence": "obs:..."}
    {"kind": "unknown", "reason": "role-not-determinable"}

``from_json`` 在某个字段为 ``None`` 或缺失时**不会**返回 explicit-all，
而是保守返回 ``unknown``，避免“未知即通配”。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final, Iterable, Literal

ScopeKind = Literal["known", "explicit-all", "unknown"]

_VALID_KINDS: Final = frozenset(("known", "explicit-all", "unknown"))


@dataclass(frozen=True, slots=True)
class Scope:
    """单个维度的适用范围。

    构造请用 :meth:`known` / :meth:`explicit_all` / :meth:`unknown`，不要直接
    用默认值绕过校验。

    与 ``contracts.py`` 的 ``validate_scope_constraint`` 机械对齐：
    ``explicit-all`` 的 ``evidence`` 是**引用列表**。
    """

    kind: ScopeKind
    values: tuple[str, ...] = ()
    evidence: tuple[str, ...] = ()
    reason: str | None = None

    # ---- 三个具名构造器 ----
    @classmethod
    def known(cls, values: Iterable[str]) -> "Scope":
        collected = tuple(dict.fromkeys(str(value) for value in values))
        if not collected:
            # 空集合不是“已知全部”，按未知处理。
            return cls.unknown("empty-known-values")
        return cls(kind="known", values=collected)

    @classmethod
    def explicit_all(cls, evidence: str | Iterable[str]) -> "Scope":
        if isinstance(evidence, str):
            refs = (evidence,) if evidence else ()
        else:
            refs = tuple(dict.fromkeys(str(ref) for ref in evidence if str(ref)))
        if not refs:
            raise ValueError("explicit-all 必须带证据引用，不能空")
        return cls(kind="explicit-all", evidence=refs)

    @classmethod
    def unknown(cls, reason: str) -> "Scope":
        if not reason:
            raise ValueError("unknown 必须带原因码")
        return cls(kind="unknown", reason=reason)

    # ---- 便捷判断 ----
    @property
    def is_unknown(self) -> bool:
        return self.kind == "unknown"

    @property
    def is_explicit_all(self) -> bool:
        return self.kind == "explicit-all"

    @property
    def is_known(self) -> bool:
        return self.kind == "known"

    @property
    def is_wildcard(self) -> bool:
        """只有 explicit-all 才是真正的通配；unknown 绝不是。"""
        return self.kind == "explicit-all"

    # ---- 序列化 ----
    def to_json(self) -> dict[str, Any]:
        if self.kind == "known":
            return {"kind": "known", "values": list(self.values)}
        if self.kind == "explicit-all":
            return {"kind": "explicit-all", "evidence": list(self.evidence)}
        return {"kind": "unknown", "reason": self.reason}

    @classmethod
    def from_json(cls, payload: Any) -> "Scope":
        """宽容读取三种格式；无法识别时 fail closed 为 unknown。"""
        if isinstance(payload, Scope):
            return payload
        if payload is None:
            return cls.unknown("missing-scope")
        if isinstance(payload, str):
            # 裸字符串按 known 单值处理（机械对齐旧格式时可能遇到）。
            return cls.known([payload]) if payload else cls.unknown("empty-string-scope")
        if isinstance(payload, (list, tuple, set)):
            return cls.known(list(payload)) if payload else cls.unknown("empty-list-scope")
        if not isinstance(payload, dict):
            return cls.unknown(f"unrecognized-scope-type:{type(payload).__name__}")
        kind = payload.get("kind")
        if kind == "known":
            values = payload.get("values")
            if not isinstance(values, (list, tuple)) or not values:
                return cls.unknown("known-without-values")
            return cls.known([str(value) for value in values])
        if kind == "explicit-all":
            evidence = payload.get("evidence")
            if isinstance(evidence, str):
                evidence = [evidence] if evidence else []
            if not isinstance(evidence, (list, tuple)) or not evidence:
                # 没有证据的 explicit-all 视作坏引用，降级 unknown。
                return cls.unknown("explicit-all-without-evidence")
            return cls.explicit_all([str(ref) for ref in evidence])
        if kind == "unknown":
            return cls.unknown(str(payload.get("reason") or "unspecified"))
        return cls.unknown(f"invalid-scope-kind:{kind!r}")

    def __post_init__(self) -> None:
        if self.kind not in _VALID_KINDS:
            raise ValueError(f"非法 scope kind: {self.kind!r}")
        if self.kind == "known" and not self.values:
            raise ValueError("known scope 必须至少有一个值")
        if self.kind == "explicit-all" and not self.evidence:
            raise ValueError("explicit-all scope 必须带证据")
        if self.kind == "unknown" and not self.reason:
            raise ValueError("unknown scope 必须带原因")


@dataclass(frozen=True, slots=True)
class Applicability:
    """一条观测的完整适用范围，每个维度独立三态。

    共 **8 个维度**：``language`` / ``entry`` / ``lexeme`` / ``role`` /
    ``pos`` / ``sense`` / ``accent`` / ``other``。``lexeme`` 与其余维度一样，
    在无法确定时保守为 ``unknown``，绝不隐式当作通配。
    """

    language: Scope
    entry: Scope = field(default_factory=lambda: Scope.unknown("entry-unspecified"))
    lexeme: Scope = field(default_factory=lambda: Scope.unknown("lexeme-unspecified"))
    role: Scope = field(default_factory=lambda: Scope.unknown("role-unspecified"))
    pos: Scope = field(default_factory=lambda: Scope.unknown("pos-unspecified"))
    sense: Scope = field(default_factory=lambda: Scope.unknown("sense-unspecified"))
    accent: Scope = field(default_factory=lambda: Scope.unknown("accent-unspecified"))
    other: Scope = field(default_factory=lambda: Scope.unknown("other-unspecified"))

    def to_json(self) -> dict[str, Any]:
        return {
            "language": self.language.to_json(),
            "entry": self.entry.to_json(),
            "lexeme": self.lexeme.to_json(),
            "role": self.role.to_json(),
            "pos": self.pos.to_json(),
            "sense": self.sense.to_json(),
            "accent": self.accent.to_json(),
            "other": self.other.to_json(),
        }

    @classmethod
    def from_json(cls, payload: Any) -> "Applicability":
        if isinstance(payload, Applicability):
            return payload
        if not isinstance(payload, dict):
            return cls(language=Scope.unknown("missing-applicability"))
        return cls(
            language=Scope.from_json(payload.get("language")),
            entry=Scope.from_json(payload.get("entry")),
            lexeme=Scope.from_json(payload.get("lexeme")),
            role=Scope.from_json(payload.get("role")),
            pos=Scope.from_json(payload.get("pos")),
            sense=Scope.from_json(payload.get("sense")),
            accent=Scope.from_json(payload.get("accent")),
            other=Scope.from_json(payload.get("other")),
        )
