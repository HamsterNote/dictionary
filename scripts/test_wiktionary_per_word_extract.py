#!/usr/bin/env python3
"""Action API 选择与 HTML 提取离线 unittest：tasks 5.2 与 5.3。"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_wiktionary_per_word_support import (  # noqa: E402
    SYNTHETIC_UA,
    ScriptedTransport,
    english_html,
    plain_response,
    text_payload,
    tocdata_payload,
)

from wiktionary_per_word.action_api import (  # noqa: E402
    ActionApiError,
    PageStatus,
    build_parse_text_url,
    fetch_english_page,
    optional_compare_available,
    select_english_section,
)
from wiktionary_per_word.html_extract import extract_observations, is_complete_ipa  # noqa: E402
from wiktionary_per_word.http_adapter import HttpAdapter, RequestKind, RunBudget  # noqa: E402


def build_adapter(responses) -> HttpAdapter:
    return HttpAdapter(
        transport=ScriptedTransport(responses),
        budget=RunBudget(max_decompressed_bytes=1024 * 1024),
        user_agent=SYNTHETIC_UA,
        allow_synthetic_user_agent=True,
        interval_seconds=0.0,
    )


MULTI_LANG_SECTIONS = [
    {"tocLevel": 1, "hLevel": 2, "line": "German", "number": "1", "index": "1", "anchor": "German"},
    {"tocLevel": 1, "hLevel": 2, "line": "English", "number": "2", "index": "2", "anchor": "English"},
    {"tocLevel": 1, "hLevel": 2, "line": "French", "number": "3", "index": "3", "anchor": "French"},
]


class SelectEnglishSectionTest(unittest.TestCase):
    def test_real_toc_fields_use_index_not_number_or_toc_level(self) -> None:
        section = {"tocLevel": 1, "hLevel": 2, "line": "English", "number": "2",
                   "index": "9", "fromTitle": "as", "codepointOffset": 489,
                   "anchor": "English"}
        index, _ = select_english_section({"parse": {"tocdata": {"sections": [section]}}})
        self.assertEqual(index, "9")
        # The relative TOC nesting field never overrides the actual heading level.
        index, _ = select_english_section({"parse": {"tocdata": {"sections": [
            {**section, "tocLevel": 2, "hLevel": 3}]}}})
        self.assertIsNone(index)

    def test_legacy_schema_and_bad_indices_fail_structurally(self) -> None:
        section = {"line": "English", "hLevel": 2, "number": "2", "index": "9"}
        for malformed in (
            {"line": "English", "level": "2", "number": "2", "index": "9"},
            {**section, "hLevel": "2"}, {**section, "hLevel": True},
            *({**section, "index": value} for value in (None, 9, True, "", "0", "2.1", " 9")),
        ):
            with self.subTest(section=malformed), self.assertRaises(ActionApiError):
                select_english_section({"parse": {"tocdata": {"sections": [malformed]}}})

    def test_missing_sections_and_duplicate_english_fail_structurally(self) -> None:
        with self.assertRaises(ActionApiError):
            select_english_section({"parse": {"tocdata": {}}})
        section = {"line": "English", "hLevel": 2, "index": "9"}
        with self.assertRaises(ActionApiError):
            select_english_section({"parse": {"tocdata": {"sections": [section, section]}}})

    def test_line_is_exact_language_heading_not_html_or_case_folded(self) -> None:
        for line in ("english", "Old English", "<b>English</b>", " English "):
            with self.subTest(line=line):
                index, _ = select_english_section({"parse": {"tocdata": {"sections": [
                    {"line": line, "hLevel": 2, "index": "9"}]}}})
                self.assertIsNone(index)

    def test_english_not_at_index_one(self) -> None:
        number, sections = select_english_section(
            {"parse": {"tocdata": {"sections": MULTI_LANG_SECTIONS}}}
        )
        self.assertEqual(number, "2")
        self.assertEqual(len(sections), 3)

    def test_missing_english_returns_none(self) -> None:
        number, _ = select_english_section(
            {"parse": {"tocdata": {"sections": [MULTI_LANG_SECTIONS[0]]}}}
        )
        self.assertIsNone(number)

    def test_ignore_english_at_wrong_level(self) -> None:
        sections = [{"tocLevel": 1, "hLevel": 3, "line": "English", "number": "5", "index": "5"}]
        number, _ = select_english_section({"parse": {"tocdata": {"sections": sections}}})
        self.assertIsNone(number)

    def test_parse_text_url_uses_selected_section(self) -> None:
        url = build_parse_text_url(12345, "3")
        self.assertIn("section=3", url)
        self.assertNotIn("section=1", url)


class FetchEnglishPageTest(unittest.TestCase):
    def test_real_as_toc_fetches_index_nine_and_explicit_revision(self) -> None:
        from urllib.parse import parse_qs, urlparse
        sections = [{"tocLevel": 1, "hLevel": 2, "line": "English",
                     "number": "2", "index": "9", "fromTitle": "as"}]
        adapter = build_adapter([plain_response(tocdata_payload(sections, revid=999)),
                                 plain_response(text_payload(english_html(), revid=999))])
        page = fetch_english_page(adapter, "as")
        self.assertEqual(page.english_section_index, "9")
        self.assertEqual(page.revid, 999)
        query = parse_qs(urlparse(adapter._transport.calls[1][0]).query)
        self.assertEqual(query, {"action": ["parse"], "oldid": ["999"], "section": ["9"],
                                 "prop": ["text|revid"], "format": ["json"]})
        self.assertEqual(len(adapter._transport.calls), 2)

    def test_missing_or_invalid_requested_revision_is_not_success(self) -> None:
        import json
        for value in (None, True, "999", 0, -1):
            with self.subTest(revid=value):
                adapter = build_adapter([plain_response(tocdata_payload(MULTI_LANG_SECTIONS)),
                    plain_response(json.dumps({"parse": {"text": {"*": english_html()},
                                                        "revid": value}}).encode())])
                with self.assertRaises(ActionApiError):
                    fetch_english_page(adapter, "read")
                self.assertEqual(len(adapter._transport.calls), 2)

    def test_selects_english_section_and_fetches_html(self) -> None:
        adapter = build_adapter(
            [
                plain_response(tocdata_payload(MULTI_LANG_SECTIONS, revid=999)),
                plain_response(text_payload(english_html(), revid=999)),
            ]
        )
        page = fetch_english_page(adapter, "read")
        self.assertEqual(page.status, PageStatus.FOUND)
        self.assertEqual(page.english_section_index, "2")
        self.assertEqual(page.revid, 999)
        self.assertIn('class="IPA"', page.html or "")
        # 第二个请求 URL 必须是选中的 section，而不是写死 1。
        second_url = adapter._transport.calls[1][0]
        self.assertIn("section=2", second_url)

    def test_missing_page_is_status_not_cleared_result(self) -> None:
        adapter = build_adapter([plain_response(b'{"error": {"code": "missingtitle"}}')])
        page = fetch_english_page(adapter, "nonexistent")
        self.assertEqual(page.status, PageStatus.MISSING)
        self.assertIsNone(page.html)
        self.assertTrue(any("missingtitle" in w for w in page.warnings))

    def test_no_english_section_status(self) -> None:
        adapter = build_adapter(
            [plain_response(tocdata_payload([MULTI_LANG_SECTIONS[0]]))]
        )
        page = fetch_english_page(adapter, "nur")
        self.assertEqual(page.status, PageStatus.NO_ENGLISH)
        self.assertIsNone(page.html)

    def test_optional_compare_unavailable_does_not_block(self) -> None:
        available, reason = optional_compare_available(None)
        self.assertFalse(available)
        self.assertIsNotNone(reason)

    def test_templates_not_expanded(self) -> None:
        # 展开结果由官方给出；主线不自行展开模板。
        adapter = build_adapter(
            [
                plain_response(tocdata_payload(MULTI_LANG_SECTIONS)),
                plain_response(text_payload(english_html())),
            ]
        )
        page = fetch_english_page(adapter, "read")
        self.assertNotIn("{{", page.html or "")


class HtmlExtractionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.result = extract_observations(english_html())

    def test_keeps_all_observations(self) -> None:
        # 两个 Etymology、多个 IPA，片段也保留。
        self.assertGreaterEqual(len(self.result.observations), 4)

    def test_multiple_etymologies_and_paths(self) -> None:
        etymologies = {observation.etymology for observation in self.result.observations}
        self.assertIn("Etymology 1", etymologies)
        self.assertIn("Etymology 2", etymologies)
        first = self.result.observations[0]
        self.assertEqual(first.path, ("English", "Etymology 1", "Pronunciation"))

    def test_audio_neighbor_does_not_lend_qualifier(self) -> None:
        # 第一条 IPA 与音频同 li，但不得借用音频标签。
        first = self.result.observations[0]
        self.assertEqual(first.qualifiers, ())
        self.assertEqual(first.ipa, "/ri\u02d0d/")

    def test_parent_qualifier_is_captured(self) -> None:
        second = self.result.observations[1]
        self.assertIn("(General American)", second.qualifiers)

    def test_fragment_is_preserved_but_not_complete(self) -> None:
        fragment = next(o for o in self.result.observations if not o.complete)
        self.assertFalse(fragment.complete)
        self.assertIn("incomplete-or-corrupt-ipa", fragment.fragment_reasons)

    def test_missing_pos_and_role_are_not_guessed(self) -> None:
        observation = self.result.observations[0]
        self.assertIsNone(observation.pos)
        self.assertIsNone(observation.role)
        self.assertIn("pos-not-determinable", observation.unresolved_reasons)
        self.assertIn("role-not-determinable", observation.unresolved_reasons)

    def test_original_tags_and_notation_preserved(self) -> None:
        observation = self.result.observations[0]
        self.assertEqual(observation.notation, "phonemic")
        self.assertIn("IPA", observation.tags)
        self.assertIn("heading:Pronunciation", observation.tags)

    def test_explicit_pos_heading_detected(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h3 id="Verb">Verb</h3>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA">/r\u026ad/</span></li></ul>'
        )
        result = extract_observations(html)
        self.assertEqual(result.observations[0].pos, "Verb")


class ParserRecoveryTest(unittest.TestCase):
    """复核发现的解析缺口逐项回归：5.3。"""

    def test_nested_same_tag_li_is_not_popped(self) -> None:
        # 合法 nested li（中间隔 ul）不得被同级隐式闭合误弹，父级 qualifier 继承。
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="qualifier-content">(US)</span>'
            '<ul><li><span class="IPA">/n\u025bst/</span></li></ul>'
            "</li></ul>"
        )
        result = extract_observations(html)
        self.assertEqual(len(result.observations), 1)
        observation = result.observations[0]
        self.assertEqual(observation.ipa, "/n\u025bst/")
        self.assertIn("(US)", observation.qualifiers)

    def test_unclosed_sibling_li_implicit_close(self) -> None:
        # 同一 ul 下未闭合的同级 li：第二个 li 隐式闭合第一个，且不继承其 qualifier。
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul>'
            '<li><span class="qualifier-content">(US)</span><span class="IPA">/e\u026a/</span>'
            '<li><span class="IPA">/\u0251\u02d0/</span>'
            "</ul>"
        )
        result = extract_observations(html)
        self.assertEqual(len(result.observations), 2)
        self.assertIn("(US)", result.observations[0].qualifiers)
        # 兄弟 li 的 qualifier 不得污染第二个观测。
        self.assertEqual(result.observations[1].qualifiers, ())

    def test_sibling_qualifier_does_not_leak(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul>'
            '<li><span class="qualifier-content">(US)</span><span class="IPA">/e\u026a/</span></li>'
            '<li><span class="IPA">/\u0251\u02d0/</span></li>'
            "</ul>"
        )
        result = extract_observations(html)
        self.assertEqual(result.observations[1].qualifiers, ())

    def test_audio_neighbor_accent_not_borrowed(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="audio">(GA)</span><span class="IPA">/x/</span></li></ul>'
        )
        observation = extract_observations(html).observations[0]
        self.assertEqual(observation.qualifiers, ())

    def test_void_audio_link_does_not_suppress_later_ipa(self) -> None:
        # void 元素 <link href=.ogg> 不得把音频抑制深度卡死，后续 qualifier/IPA 仍可捕获。
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><link href="//x/read.ogg">'
            '<span class="qualifier-content">(US)</span>'
            '<span class="IPA">/x/</span></li></ul>'
        )
        observations = extract_observations(html).observations
        self.assertEqual(len(observations), 1)
        self.assertIn("(US)", observations[0].qualifiers)

    def test_empty_ipa_span_preserved_as_evidence_only(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA"></span></li></ul>'
        )
        result = extract_observations(html)
        self.assertEqual(len(result.observations), 1)
        observation = result.observations[0]
        self.assertEqual(observation.raw_ipa, "")
        self.assertFalse(observation.complete)
        self.assertEqual(observation.notation, "unknown")
        self.assertIn("empty-ipa", observation.unresolved_reasons)
        self.assertIn("empty", observation.fragment_reasons)

    def test_raw_ipa_keeps_boundary_whitespace(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA"> /x/ </span></li></ul>'
        )
        observation = extract_observations(html).observations[0]
        self.assertEqual(observation.raw_ipa, " /x/ ")
        self.assertEqual(observation.ipa, "/x/")

    def test_raw_preserves_entity_while_ipa_decodes(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA">/ri&#720;d/</span></li></ul>'
        )
        observation = extract_observations(html).observations[0]
        self.assertEqual(observation.raw_ipa, "/ri&#720;d/")
        self.assertEqual(observation.ipa, "/ri\u02d0d/")

    def test_control_character_ipa_not_complete(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA">/x\u0000/</span></li></ul>'
        )
        observation = extract_observations(html).observations[0]
        self.assertFalse(observation.complete)
        self.assertIn("incomplete-or-corrupt-ipa", observation.fragment_reasons)

    def test_two_roles_not_first_match(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h3 id="Verb">Verb</h3>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="qualifier-content">past tense and past participle</span>'
            '<span class="IPA">/r\u025bd/</span></li></ul>'
        )
        observation = extract_observations(html).observations[0]
        self.assertEqual(set(observation.roles), {"past", "past-participle"})
        self.assertEqual(
            set(observation.applicability.role.values), {"past", "past-participle"}
        )

    def test_applicability_has_eight_dimensions_including_lexeme(self) -> None:
        observation = extract_observations(english_html()).observations[0]
        keys = set(observation.applicability.to_json())
        self.assertEqual(
            keys,
            {
                "language",
                "entry",
                "lexeme",
                "role",
                "pos",
                "sense",
                "accent",
                "other",
            },
        )
        self.assertTrue(observation.applicability.lexeme.is_unknown)

    def test_usage_labels_and_tags_preserved(self) -> None:
        html = (
            '<h2 id="English">English</h2>'
            '<h4 id="Pronunciation">Pronunciation</h4>'
            '<ul><li><span class="IPA archaic">/x/</span></li></ul>'
        )
        observation = extract_observations(html).observations[0]
        self.assertIn("archaic", observation.tags)
        self.assertIn("archaic", observation.usage_labels)

    def test_root_qualifier_not_leaked_across_sibling_containers(self) -> None:
        # gap1：div 为作用域边界，qualifier 不得泄漏到兄弟 div。
        html = (
            '<div><span class="qualifier-content">GA</span>'
            '<ul><li><span class="IPA">/x/</span></li></ul></div>'
            '<div><ul><li><span class="IPA">/y/</span></li></ul></div>'
        )
        observations = extract_observations(html).observations
        self.assertEqual(len(observations), 2)
        self.assertIn("GA", observations[0].qualifiers)
        self.assertEqual(observations[1].qualifiers, ())

    def test_adjacent_ipa_does_not_inherit_neighbor_usage(self) -> None:
        # gap2：相邻 IPA span 的 class（archaic）不得污染后一个 IPA。
        html = '<li><span class="IPA archaic">/x/</span><span class="IPA">/y/</span></li>'
        observations = extract_observations(html).observations
        self.assertEqual(observations[0].usage_labels, ("archaic",))
        self.assertEqual(observations[1].usage_labels, ())
        self.assertIn("archaic", observations[0].tags)
        self.assertNotIn("archaic", observations[1].tags)

    def test_corrupt_or_multi_ipa_not_complete(self) -> None:
        # gap3：损坏 delimiter / 多 IPA / 空内容不得 complete。
        for bad in ("/x]/", "/x/ /y/", "/ /", "[]", "//", "[x]/", "/x/"):
            if bad == "/x/":
                self.assertTrue(is_complete_ipa(bad))
            else:
                self.assertFalse(is_complete_ipa(bad), bad)

    def test_qualifier_raw_preserved_only_normalized_for_compare(self) -> None:
        # gap5：qualifier 原值保留（含边界空白），仅比较时 normalize。
        html = '<li><span class="qualifier-content"> GA </span><span class="IPA">/x/</span></li>'
        observation = extract_observations(html).observations[0]
        self.assertEqual(observation.qualifiers, (" GA ",))

    def test_nested_span_capture_finishes_at_own_boundary(self) -> None:
        # gap6：捕获在自身元素闭合时结束，重复 pop 不得弹掉同 tag 祖先。
        html = '<li><span class="IPA">/a<span class="IPA">/b/</span></span></li>'
        observations = extract_observations(html).observations
        self.assertEqual([o.ipa for o in observations], ["/a/b/"])

    def test_void_inside_ipa_does_not_leak_capture(self) -> None:
        # gap6：void <br> 不入栈、不计捕获边界，捕获仍在 IPA span 边界结束。
        html = '<li><span class="IPA">/a<br>/b/</span></li>'
        result = extract_observations(html)
        self.assertEqual([o.ipa for o in result.observations], ["/a/b/"])

    def test_nested_same_tag_div_inherits_qualifier(self) -> None:
        # 本轮 gap1：div 可合法同名嵌套，不得被同名 start 误弹；x/y 均继承 GA。
        html = (
            '<div><span class="qualifier">GA</span>'
            '<div><span class="IPA">/x/</span></div>'
            '<span class="IPA">/y/</span></div>'
        )
        observations = extract_observations(html).observations
        self.assertEqual([o.ipa for o in observations], ["/x/", "/y/"])
        self.assertEqual(observations[0].qualifiers, ("GA",))
        self.assertEqual(observations[1].qualifiers, ("GA",))

    def test_inner_semantic_element_tags_preserved(self) -> None:
        # 本轮 gap2：capture 内部语义元素 tag 需保留，不污染相邻 IPA。
        html = '<span class="IPA"><span class="archaic">/x/</span></span><span class="IPA">/y/</span>'
        observations = extract_observations(html).observations
        self.assertIn("archaic", observations[0].tags)
        self.assertEqual(observations[0].usage_labels, ("archaic",))
        self.assertNotIn("archaic", observations[1].tags)
        self.assertEqual(observations[1].usage_labels, ())

    def test_unterminated_ipa_at_eof_is_fragment(self) -> None:
        # 本轮 gap3：EOF 未闭合的 IPA 须保留 raw 残片 + truncation reason；
        # 即使出现闭定界符，capture 未闭合也不得当完整成功。
        result = extract_observations('<span class="IPA">/x')
        self.assertEqual(len(result.observations), 1)
        observation = result.observations[0]
        self.assertEqual(observation.raw_ipa, "/x")
        self.assertFalse(observation.complete)
        self.assertIn("truncated-capture", observation.fragment_reasons)
        self.assertIn("truncated-capture", result.warnings)
        # 有闭定界符但 markup 未闭合：仍不算完整。
        result2 = extract_observations('<span class="IPA">/x/')
        self.assertFalse(result2.observations[0].complete)
        self.assertIn("truncated-capture", result2.observations[0].fragment_reasons)

    def test_unknown_restriction_class_recorded_not_guessed(self) -> None:
        # 本轮 gap4：未知限制 class 保守记录待分类，明确 layout class 排除。
        unknown = extract_observations(
            '<div class="nonstandard-new"><span class="IPA">/x/</span></div>'
        ).observations[0]
        self.assertIn("nonstandard-new", unknown.unclassified_tags)
        self.assertIn("unknown-restriction-classification-pending", unknown.unresolved_reasons)
        layout = extract_observations(
            '<div class="mw-parser-output"><span class="IPA">/x/</span></div>'
        ).observations[0]
        self.assertEqual(layout.unclassified_tags, ())
        self.assertEqual(layout.usage_labels, ())


if __name__ == "__main__":
    unittest.main()
