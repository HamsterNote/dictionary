"""基于 ``html.parser.HTMLParser`` 的结构栈提取器。

对应 tasks 5.3。设计要点：

- 用标题栈（h1–h6）表达 Etymology / Pronunciation / POS 层级，天然支持多个
  Etymology / Pronunciation / 词条，而不是只取第一项。
- 用块级帧（``li`` / ``dd`` / ``dt`` / ``tr`` / ``td`` / ``p``）限定 qualifier
  的父级作用域：只收集同一帧内、IPA 之前出现的 qualifier，因此**相邻音频标签
  不会被借用**。
- 同名块的隐式闭合只在“真正的同级兄弟”发生；中间隔着 ``ul`` / ``ol`` / ``dl``
  等容器的**合法嵌套**同名块不会被误弹。
- 子块**继承**父块已收集的 qualifier（作用域向下），但**不继承**兄弟块中后出现的
  qualifier（避免兄弟污染）。
- 音频上下文（``audio`` 元素或 audio 类/扩展名链接）内的文本被抑制；void 元素
  不会把音频抑制深度卡死。
- 保留全部原始 tags 与结构路径；关联不明保留为 unresolved；不猜测缺失的
  POS / 词义 / 词形角色；片段与空 IPA 也保留证据但不认作完整读法。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
from typing import Final, Iterable

from .scope_model import Applicability, Scope

HEADING_TAGS: Final = frozenset(("h1", "h2", "h3", "h4", "h5", "h6"))
# 真正作为 qualifier 作用域边界的块/容器元素：li/dd/dt/tr/td/p 之外，div/ul/ol/dl/
# section/table 等容器也成帧（避免泄漏到兄弟容器）。
BLOCK_TAGS: Final = frozenset(("li", "dd", "dt", "tr", "td", "p"))
SCOPE_TAGS: Final = BLOCK_TAGS | frozenset(
    (
        "div",
        "section",
        "article",
        "ul",
        "ol",
        "dl",
        "table",
        "tbody",
        "thead",
        "tfoot",
        "figure",
        "blockquote",
    )
)
# 只有 BLOCK_TAGS（li/dd/dt/tr/td/p）适用“同名同级兄弟隐式闭合”；div/section/ul
# 等容器**可合法同名嵌套**，绝不因同名 start 被误弹。
IMPLICIT_CLOSE_TAGS: Final = frozenset(("li", "dd", "dt", "tr", "td"))
# class 规则/分类器版本：unknown restriction 的保守待分类依赖 3.2，本版本用于
# 语义 fingerprint，规则升级时语义指纹随之变化（不静默沿用旧分类）。
CLASS_RULE_VERSION: Final = "wiktionary-per-word/class-rules/1"
# 明确的排版/结构 class：不参与语义 fingerprint，避免 layout 变化误触。
LAYOUT_CLASS_PREFIXES: Final = (
    "mw-",
    "mw_",
    "navbox",
    "metadata",
    "noprint",
    "reference",
    "reflist",
    "inflection",
    "hatnote",
    "sistersitebox",
    "interproject",
    "plainlist",
    "hlist",
    "navbar",
    "catlinks",
    "toc",
    "template",
    "box-",
)
LAYOUT_CLASS_TOKENS: Final = frozenset(
    (
        "ipa",
        "audio",
        "audiofile",
        "h-audio",
        "mw-audio",
        "media",
        "heading",
        "mw-heading",
        "toc",
        "tocnumber",
        "toctext",
        "printfooter",
        "catlinks",
        "noprint",
        "metadata",
        "reference",
    )
)


def is_layout_class(token: str) -> bool:
    """判定 class token 是否为明确排版/结构类（不参与语义 fingerprint）。"""
    low = token.lower()
    if low in LAYOUT_CLASS_TOKENS:
        return True
    return any(low.startswith(prefix) for prefix in LAYOUT_CLASS_PREFIXES)
# HTML void 元素：没有结束标签，不能压入音频抑制栈，否则会永久抑制后续文本。
VOID_TAGS: Final = frozenset(
    (
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    )
)
# class token 命中即视为 qualifier / usage label。
QUALIFIER_CLASS_TOKENS: Final = frozenset(
    (
        "qualifier-content",
        "qualifier",
        "ib-content",
        "label",
        "usage-label-sense",
        "usage-label-accent",
        "accent-label",
        "regional-label",
    )
)
AUDIO_CLASS_TOKENS: Final = frozenset(("audio", "audiofile", "h-audio", "mw-audio", "media"))
AUDIO_EXTENSIONS: Final = (".ogg", ".oga", ".wav", ".mp3", ".flac", ".opus")
POS_HEADINGS: Final = frozenset(
    (
        "noun",
        "verb",
        "adjective",
        "adverb",
        "pronoun",
        "preposition",
        "conjunction",
        "interjection",
        "determiner",
        "numeral",
        "article",
        "particle",
        "proper noun",
        "phrase",
        "prefix",
        "suffix",
        "circumfix",
        "infix",
        "root",
        "symbol",
    )
)
# 词形角色提示：全部扫描而不是首个命中即停，因此“past tense and past participle”
# 会同时得到 past 与 past-participle 两个角色。词边界匹配（\b），避免
# “unstressed form” 误中 “stressed”。引文形式角色（strong/weak/stressed/
# unstressed）与变位角色同列，供资格层区分弱读与 citation form。
ROLE_HINTS: Final = (
    ("past participle", "past-participle"),
    ("present participle", "present-participle"),
    ("past tense", "past"),
    ("present tense", "present"),
    ("third-person singular", "present"),
    ("simple past", "past"),
    ("base form", "base"),
    ("weak form", "weak"),
    ("strong form", "strong"),
    ("unstressed", "unstressed"),
    ("stressed", "stressed"),
)
# 非语言 h2 白名单：Wiktionary 长语言列表页的 “More languages” 折叠块在 section
# HTML 里表现为第二个 h2，但它不是语言。只排除这个已证实伪根，其他未知 h2 照旧
# 触发语言根校验拒绝（fail closed）。
NON_LANGUAGE_H2: Final = frozenset(("More languages",))

# 口音/地域白名单：仅这些规范化后的 qualifier 片段（实体解码、去外层括号、
# 按逗号切分、小写比较）可进入 accent 维度；不在表内的一律留在 other，
# 不把未知限定词猜成口音。值为展示用 canonical 名。
ACCENT_TOKENS: Final = {
    "received pronunciation": "Received Pronunciation",
    "rp": "Received Pronunciation",
    "standard southern british": "Standard Southern British",
    "general american": "General American",
    "ga": "General American",
    "uk": "UK",
    "us": "US",
    "australia": "Australia",
    "new zealand": "New Zealand",
    "canada": "Canada",
    "scotland": "Scotland",
    "ireland": "Ireland",
    "northern ireland": "Northern Ireland",
    "northumbria": "Northumbria",
    "general south african": "General South African",
    "south asia": "South Asia",
    "singapore": "Singapore",
    "singlish": "Singlish",
    "manglish": "Manglish",
    "african-american vernacular": "African-American Vernacular",
    "northwestern us": "Northwestern US",
    "ottawa valley": "Ottawa Valley",
}


def _normalize_qualifier(text: str) -> str:
    """实体解码 + 去边界空白 + 去一层外层括号；不改动语义内容。"""
    value = unescape(text).strip()
    if len(value) >= 2 and value.startswith("(") and value.endswith(")"):
        value = value[1:-1].strip()
    return value


def classify_accents(qualifiers: Iterable[str]) -> tuple[str, ...]:
    """从 qualifier 中按白名单提取口音/地域标签；判不出返回空。

    匹配用规范化片段（实体解码、去一层外层括号、逗号切分、小写）；不改写
    qualifier 原值。
    """
    accents: list[str] = []
    for qualifier in qualifiers:
        for segment in _normalize_qualifier(qualifier).split(","):
            token = segment.strip().lower()
            accent = ACCENT_TOKENS.get(token)
            if accent is not None and accent not in accents:
                accents.append(accent)
    return tuple(accents)
# 语义用途/地域标签：这些 class token 参与语义 fingerprint；纯排版类（mw-*、
# IPA、音频等）不参与，因此无关排版变化不会误触。
SEMANTIC_USAGE_TOKENS: Final = frozenset(
    (
        "archaic",
        "obsolete",
        "rare",
        "dated",
        "colloquial",
        "slang",
        "informal",
        "formal",
        "literary",
        "poetic",
        "nonstandard",
        "dialectal",
        "regional",
        "historical",
        "humorous",
        "derogatory",
        "offensive",
        "figurative",
        "idiomatic",
        "proscribed",
        "uncommon",
        "chiefly",
        "especially",
        "originally",
        "broadly",
        "loosely",
        "sometimes",
        "us",
        "uk",
        "ga",
        "rp",
        "general-american",
        "received-pronunciation",
        "american",
        "british",
        "australian",
        "canadian",
        "irish",
        "scottish",
        "new-zealand",
        "south-african",
        "england",
        "northern-england",
        "southern-us",
    )
) | QUALIFIER_CLASS_TOKENS


def _classes(attributes: list[tuple[str, str | None]]) -> tuple[str, ...]:
    for name, value in attributes:
        if name.lower() == "class" and value:
            return tuple(token for token in value.split() if token)
    return ()


def _normalize_ipa(text: str) -> str:
    """仅用于比较的规范化：解码 HTML 实体 + NFC + 去边界空白。

    **不改** 原值（``raw_ipa`` 保留实体与原始空白），也不丢弃有意义的重音符号、
    长度符、音节界、变音符，不把 ``[]`` 当作 ``/ /``。
    """
    return unicodedata.normalize("NFC", unescape(text)).strip()


def _has_control_character(text: str) -> bool:
    """控制/格式/代理/私用/未分配字符视为损坏，不能认作完整 IPA。"""
    return any(
        unicodedata.category(char) in ("Cc", "Cf", "Cs", "Co", "Cn") for char in text
    )


def classify_notation(text: str) -> str:
    stripped = _normalize_ipa(text)
    if len(stripped) >= 2 and stripped.startswith("/") and stripped.endswith("/"):
        return "phonemic"
    if len(stripped) >= 2 and stripped.startswith("[") and stripped.endswith("]"):
        return "phonetic"
    return "unknown"


def is_complete_ipa(text: str) -> bool:
    """完整 IPA 判定：定界符匹配、内部含实质内容、无控制字符、内部无杂散定界符。

    - ``/ /``、``[]`` 等空/纯空白内部 → 不完整。
    - ``/x]/``、``/x/ /y/`` 等内部混入另一类定界符或多个 IPA → 保守判为片段，
      不把整段当作完整读法（多 IPA 由上游 span 拆分，本层不臆断）。
    """
    stripped = _normalize_ipa(text)
    if len(stripped) < 3:
        return False
    if _has_control_character(stripped):
        return False
    notation = classify_notation(stripped)
    if notation == "unknown":
        return False
    inner = stripped[1:-1]
    if not inner.strip():
        return False
    if any(char in inner for char in "/[]"):
        return False
    return True


def detect_roles(text: str) -> tuple[str, ...]:
    """扫描全部角色提示，返回去重后按提示表顺序的角色元组（非首个命中即停）。

    比较前解码 HTML 实体，避免把 ``&quot;past tense&quot;`` 之类当普通文本。
    词边界匹配：``unstressed form`` 不会误中 ``stressed``。
    """
    lowered = unescape(text).lower()
    roles: list[str] = []
    for hint, role_name in ROLE_HINTS:
        pattern = r"\b" + re.escape(hint) + r"\b"
        if re.search(pattern, lowered) and role_name not in roles:
            roles.append(role_name)
    return tuple(roles)


@dataclass(frozen=True, slots=True)
class Observation:
    """一条来源音标观测。保留原值、全部 tags 与结构路径。"""

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
    applicability: Applicability
    roles: tuple[str, ...] = ()
    usage_labels: tuple[str, ...] = ()
    unclassified_tags: tuple[str, ...] = ()
    unresolved_reasons: tuple[str, ...] = ()
    fragment_reasons: tuple[str, ...] = ()

    def to_json(self) -> dict[str, object]:
        return {
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
            "applicability": self.applicability.to_json(),
            "unresolvedReasons": list(self.unresolved_reasons),
            "fragmentReasons": list(self.fragment_reasons),
        }


@dataclass
class ExtractionResult:
    observations: list[Observation] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, object]:
        return {
            "observations": [observation.to_json() for observation in self.observations],
            "languages": list(self.languages),
            "warnings": list(self.warnings),
        }


class _BlockFrame:
    """块级帧：限定 qualifier 作用域，并记录 tags。"""

    __slots__ = (
        "qualifiers",
        "class_tokens",
        "audio_depth",
        "heading_path",
        "tag_name",
        "depth",
    )

    def __init__(self, tag_name: str, heading_path: tuple[str, ...]) -> None:
        self.tag_name = tag_name
        self.qualifiers: list[str] = []
        self.class_tokens: list[str] = []
        self.audio_depth = 0
        self.heading_path = heading_path
        # 自身元素在元素栈中的深度（含自己），用于区分同级兄弟与合法嵌套。
        self.depth = 0


class WiktionaryHTMLExtractor(HTMLParser):
    """结构栈提取器。用法：``feed(html)`` 后读 ``result``。"""

    def __init__(self) -> None:
        # convert_charrefs=False：保留原始 HTML 实体于 raw 文本，只在比较时解码。
        super().__init__(convert_charrefs=False)
        self.result = ExtractionResult()
        self._heading_stack: list[tuple[int, str]] = []
        self._heading_level: int | None = None
        self._heading_text: list[str] = []
        self.language_roots: list[tuple[int, str]] = []
        self._blocks: list[_BlockFrame] = [_BlockFrame("#root", ())]
        self._elem_stack: list[tuple[str, tuple[str, ...]]] = []
        self._capture_kind: str | None = None
        # 捕获边界：记录捕获元素在元素栈中的深度（含自身）。当该元素被弹出即结束
        # 捕获，不靠逐 end 计数，避免 void/嵌套同 tag 导致泄漏或提前关闭。
        self._capture_elem_depth = 0
        self._capture_text: list[str] = []
        # 捕获元素自身的 class（emit 时该元素可能已被弹出，单独快照保留原 tags）。
        self._capture_classes: tuple[str, ...] = ()
        # 捕获期内打开的语义/结构元素 class（内部 tag 快照，仅供本条观测，不污染相邻）。
        self._capture_inner_classes: list[str] = []
        self._ipa_snapshot: tuple[_BlockFrame, tuple[str, ...], tuple[str, ...]] | None = None
        # 音频上下文栈：进入音频元素后抑制文本/qualifier 捕获。void 元素不入栈。
        self._audio_stack: list[str] = []

    # ------------------------------------------------------------------
    @property
    def _frame(self) -> _BlockFrame:
        return self._blocks[-1]

    def _heading_path(self) -> tuple[str, ...]:
        return tuple(text for _, text in self._heading_stack if text)

    def _in_audio(self) -> bool:
        return bool(self._audio_stack)

    # ---- 标题栈 ----
    def _push_heading(self, level: int, text: str) -> None:
        text = text.strip()
        # “More languages” 是长语言列表页的折叠块伪 h2，不是语言根；白名单式
        # 排除（不认识的新 h2 仍视为语言根，校验继续 fail closed）。
        is_pseudo_root = level == 2 and unescape(text) in NON_LANGUAGE_H2
        if level <= 2 and not is_pseudo_root:
            self.language_roots.append((level, unescape(text)))
        if level == 2 and not is_pseudo_root:
            self.result.languages.append(unescape(text))
        while self._heading_stack and self._heading_stack[-1][0] >= level:
            self._heading_stack.pop()
        self._heading_stack.append((level, text))

    # ---- 帧 ----
    # ------------------------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        classes = _classes(attrs)
        # void 元素没有结束标签：不入元素栈、不计捕获边界，避免栈/捕获泄漏。
        if tag not in VOID_TAGS:
            self._elem_stack.append((tag, classes))

        if tag in HEADING_TAGS:
            self._heading_level = int(tag[1])
            self._heading_text = []

        # 音频上下文：进入后抑制文本/qualifier 捕获。
        href = next((value for name, value in attrs if name.lower() == "href" and value), None)
        is_audio = (
            tag == "audio"
            or bool(AUDIO_CLASS_TOKENS.intersection(classes))
            or (href is not None and href.lower().endswith(AUDIO_EXTENSIONS))
        )
        if is_audio:
            # void 元素没有结束标签，压栈会永久抑制后续文本；不压栈即可。
            if tag not in VOID_TAGS:
                self._audio_stack.append(tag)
            return

        if tag in SCOPE_TAGS:
            # p 常不显式闭合：任何新块开始前先弹出未闭合的 p 帧（p 不能嵌套 p）。
            while len(self._blocks) > 1 and self._blocks[-1].tag_name == "p":
                self._blocks.pop()
            # 仅 li/dd/dt/tr/td 适用“同名同级兄弟隐式闭合”；div/section/ul 等容器
            # 可合法同名嵌套，绝不因同名 start 被误弹。中间隔着容器的嵌套保留。
            if tag in IMPLICIT_CLOSE_TAGS:
                while len(self._blocks) > 1:
                    top = self._blocks[-1]
                    if top.tag_name != tag:
                        break
                    if len(self._elem_stack) != top.depth + 1:
                        break
                    self._blocks.pop()
            parent = self._frame
            frame = _BlockFrame(tag, self._heading_path())
            # 子块继承父块已收集的 qualifier（作用域向下）。
            frame.qualifiers = list(parent.qualifiers)
            frame.depth = len(self._elem_stack)
            self._blocks.append(frame)

        # 处理 qualifier 与 IPA 捕获。
        lowered = {token.lower() for token in classes}
        if self._capture_kind is None and lowered & QUALIFIER_CLASS_TOKENS:
            self._capture_kind = "qualifier"
            self._capture_elem_depth = len(self._elem_stack)
            self._capture_text = []
            self._capture_classes = classes
            self._capture_inner_classes = []
            return

        if self._capture_kind is None and "ipa" in lowered:
            self._capture_kind = "ipa"
            self._capture_elem_depth = len(self._elem_stack)
            self._capture_text = []
            self._capture_classes = classes
            self._capture_inner_classes = []
            self._ipa_snapshot = (
                self._frame,
                tuple(self._frame.qualifiers),
                tuple(self._heading_path()),
            )
            return

        # 捕获进行中：记录内部元素 class 快照（含语义/未知限制），仅供本条观测。
        if self._capture_kind is not None:
            for token in classes:
                if token not in self._capture_inner_classes:
                    self._capture_inner_classes.append(token)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # 自闭合元素：走同一路径，随后立即闭合。
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        self._capture_text_data(data)

    def handle_entityref(self, name: str) -> None:
        # 保留原始实体写法，比较时才解码。
        self._capture_text_data(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self._capture_text_data(f"&#{name};")

    def _capture_text_data(self, data: str) -> None:
        if self._heading_level is not None and not any(
            "mw-editsection" in classes for _, classes in self._elem_stack
        ):
            self._heading_text.append(data)
        if self._in_audio():
            return
        if self._capture_kind is not None:
            self._capture_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if tag in HEADING_TAGS and self._heading_level is not None:
            self._push_heading(self._heading_level, "".join(self._heading_text))
            self._heading_level = None
            self._heading_text = []

        if self._audio_stack and self._audio_stack[-1] == tag:
            self._audio_stack.pop()

        # 唯一一次元素栈弹出：弹出到匹配元素（含未闭合子元素）。
        self._pop_element(tag)

        # 捕获边界：捕获元素被弹出（栈深度低于其起始深度）即结束捕获。
        if self._capture_kind is not None and len(self._elem_stack) < self._capture_elem_depth:
            self._finish_capture()

        # 关闭作用域帧。
        if tag in SCOPE_TAGS:
            if len(self._blocks) > 1 and self._blocks[-1].tag_name == tag:
                self._blocks.pop()

    def _pop_element(self, tag: str) -> None:
        """弹出到最近的匹配元素（含未闭合子元素），避免元素栈泄漏。"""
        for index in range(len(self._elem_stack) - 1, -1, -1):
            if self._elem_stack[index][0] == tag:
                del self._elem_stack[index:]
                return

    def close(self) -> None:
        # 先触发底层缓冲解析，再把未闭合的捕获按“截断/畸形 markup”落成残片证据。
        super().close()
        if self._capture_kind is not None:
            self._finish_capture(truncated=True)
            self.result.warnings.append("truncated-capture")

    # ------------------------------------------------------------------
    def _finish_capture(self, truncated: bool = False) -> None:
        text = "".join(self._capture_text)
        kind = self._capture_kind
        self._capture_kind = None
        self._capture_text = []
        if kind == "qualifier":
            # 原 qualifier 完整保存（含实体与边界空白）；仅用规范化值判空。
            if _normalize_ipa(text):
                self._frame.qualifiers.append(text)
            self._capture_classes = ()
            self._capture_inner_classes = []
            return
        if kind == "ipa" and self._ipa_snapshot is not None:
            frame, qualifiers, path = self._ipa_snapshot
            self._ipa_snapshot = None
            self._emit_observation(text, frame, qualifiers, path, truncated=truncated)
        self._capture_classes = ()
        self._capture_inner_classes = []

    def _emit_observation(
        self,
        raw_text: str,
        frame: _BlockFrame,
        qualifiers: tuple[str, ...],
        path: tuple[str, ...],
        truncated: bool = False,
    ) -> None:
        # 原值完整保存：不做 strip；只对“比较用”的规范化值去边界空白。
        raw_ipa = raw_text
        normalized = _normalize_ipa(raw_ipa)
        empty = normalized == ""
        notation = classify_notation(normalized)
        complete = is_complete_ipa(normalized) and not truncated

        # 从标题栈推导 Etymology / POS / 词形角色；推导不出就留 None（不猜）。
        # 比较 heading 一律用实体解码后的文本，不拿 raw entity 当英文标签。
        etymology = next(
            (
                text
                for level, text in reversed(self._heading_stack)
                if unescape(text).lower().startswith("etymology")
            ),
            None,
        )
        pos = next(
            (
                text
                for level, text in reversed(self._heading_stack)
                if unescape(text).lower() in POS_HEADINGS
            ),
            None,
        )
        form = next(
            (
                text
                for level, text in reversed(self._heading_stack)
                if any(hint in unescape(text).lower() for hint, _ in ROLE_HINTS)
            ),
            None,
        )
        # 只使用 IPA 起始时的快照 qualifiers，不借用同一帧中其后出现的标签，
        # 更不借用相邻音频的标签。扫描全部角色提示（非首个命中即停）；比较前解码实体。
        # qualifiers 字段保留原值（既有契约）；口音分类内部用规范化片段匹配白名单。
        scope_text = " ".join(filter(None, list(qualifiers) + [form or ""]))
        roles = detect_roles(scope_text)
        role = roles[0] if roles else None
        accents = classify_accents(qualifiers)

        language = next((unescape(text) for level, text in self._heading_stack if level == 2), None)
        section = next(
            (
                text
                for level, text in reversed(self._heading_stack)
                if unescape(text).lower() in ("pronunciation", "etymology", "english")
            ),
            language or "",
        )

        # tags：祖先链上的 class tokens + 捕获元素自身 class + 标题文本，保留顺序去重。
        tags: list[str] = []
        for element_tag, element_classes in self._elem_stack:
            for token in element_classes:
                if token not in tags:
                    tags.append(token)
        for token in self._capture_classes:
            if token not in tags:
                tags.append(token)
        for token in self._capture_inner_classes:
            if token not in tags:
                tags.append(token)
        for token in frame.class_tokens:
            if token not in tags:
                tags.append(token)
        for _, text in self._heading_stack:
            if text:
                tag = f"heading:{text}"
                if tag not in tags:
                    tags.append(tag)

        # 语义用途/地域标签（archaic/rare/regional 等）：参与 fingerprint。
        usage_labels: list[str] = []
        unclassified_tags: list[str] = []
        for token in tags:
            low = token.lower()
            if low.startswith("heading:"):
                continue
            if is_layout_class(token):
                continue
            if low in SEMANTIC_USAGE_TOKENS:
                if token not in usage_labels:
                    usage_labels.append(token)
            else:
                # 未知限制：不猜资格，保守记为待分类；其存在/变化进入 fingerprint，
                # 供后续 task 3.2 判定；明确 layout class 已在上一步排除。
                if token not in unclassified_tags:
                    unclassified_tags.append(token)

        unresolved: list[str] = []
        if not language:
            unresolved.append("language-not-determinable")
        fragment: list[str] = []
        if truncated:
            fragment.append("truncated-capture")
            unresolved.append("truncated-markup")
        if empty:
            fragment.append("empty")
            unresolved.append("empty-ipa")
        elif not complete:
            fragment.append("incomplete-or-corrupt-ipa")
        if not pos:
            unresolved.append("pos-not-determinable")
        if not roles:
            unresolved.append("role-not-determinable")
        if not empty and notation == "unknown" and complete:
            unresolved.append("notation-unknown")
        if unclassified_tags:
            unresolved.append("unknown-restriction-classification-pending")

        applicability = Applicability(
            language=Scope.known([language]) if language else Scope.unknown("language-not-determinable"),
            entry=Scope.known([etymology]) if etymology else Scope.unknown("entry-not-determinable"),
            lexeme=Scope.unknown("lexeme-not-determinable"),
            role=Scope.known(list(roles)) if roles else Scope.unknown("role-not-determinable"),
            pos=Scope.known([pos]) if pos else Scope.unknown("pos-not-determinable"),
            sense=Scope.unknown("sense-not-determinable"),
            accent=Scope.known(list(accents)) if accents else Scope.unknown("accent-not-determinable"),
            other=Scope.known(list(qualifiers))
            if qualifiers
            else Scope.unknown("no-qualifier"),
        )

        self.result.observations.append(
            Observation(
                raw_ipa=raw_ipa,
                ipa=normalized,
                notation=notation,
                complete=complete,
                qualifiers=tuple(qualifiers),
                tags=tuple(tags),
                path=path,
                section=section,
                etymology=etymology,
                pos=pos,
                form=form,
                role=role,
                roles=roles,
                usage_labels=tuple(usage_labels),
                unclassified_tags=tuple(unclassified_tags),
                applicability=applicability,
                unresolved_reasons=tuple(unresolved),
                fragment_reasons=tuple(fragment),
            )
        )


def extract_observations(html: str, *, expected_language: str | None = None) -> ExtractionResult:
    """从正文标题推导语言；采集路径还要求唯一且一致的语言根。"""
    extractor = WiktionaryHTMLExtractor()
    extractor.feed(html)
    extractor.close()
    if expected_language is not None:
        if (extractor.language_roots != [(2, expected_language)] or
                any(o.applicability.language.values != (expected_language,)
                    for o in extractor.result.observations)):
            raise ValueError(f"expected one {expected_language} h2 language root and scoped observations")
    return extractor.result
