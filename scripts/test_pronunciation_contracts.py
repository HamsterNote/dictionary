#!/usr/bin/env python3
"""音标叠加层 JSON 合同的 Python 读取侧离线测试。

验证：
- Python 合同能读取 TS 侧定义的同一 JSON 形状；
- schema 版本常量与 ``src/pronunciation-overlay/contracts.ts`` 一致；
- 合法文档集通过，unknown-as-all / 缺许可 / 坏引用 / schema 错误 / 重复 ID 被拒；
- JSON 往返（dumps/loads）与规范化稳定。

不联网、不采集、不发布；仅使用合成夹具。
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_PATH = REPO_ROOT / "scripts" / "wiktionary_per_word" / "contracts.py"
TS_CONTRACTS_PATH = REPO_ROOT / "src" / "pronunciation-overlay" / "contracts.ts"


def load_contracts():
    spec = importlib.util.spec_from_file_location("pronunciation_contracts", CONTRACTS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载合同模块：{CONTRACTS_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


contracts = load_contracts()

ENTRY_ID = "ent_11111111-2222-3333-4444-555555555555"
LEXEME_ID = "lex_11111111-2222-3333-4444-555555555555"
EVIDENCE_ID = "ev-synthetic-1"
OBSERVATION_ID = "obs-synthetic-1"
RULE_ID = "rule-synthetic-1"
APPROVAL_ID = "apr-synthetic-1"


def known(values):
    return {"kind": "known", "values": list(values)}


def unknown(reason):
    return {"kind": "unknown", "reason": reason}


def scope_for(entry_id):
    return {
        "language": known(["en"]),
        "entry": known([entry_id]),
        "lexeme": known([LEXEME_ID]),
        "role": known(["base"]),
        "pos": unknown("未注明词性"),
        "sense": unknown("未注明词义"),
        "accent": known(["RP"]),
        "other": unknown("未注明其他条件"),
    }


def make_evidence():
    return {
        "schema": contracts.SCHEMA["evidence"],
        "evidenceId": EVIDENCE_ID,
        "sourceSite": "wiktionary",
        "language": "en",
        "pageUrl": "https://en.wiktionary.org/wiki/read",
        "historyUrl": "https://en.wiktionary.org/w/index.php?title=read&action=history",
        "revision": "100",
        "extractedAt": "2026-10-08T00:00:00Z",
        "requestVersion": "req/1",
        "renderVersion": "render/1",
        "extractorVersion": "extractor/1",
        "tagRuleVersion": "tags/1",
        "responseContentHash": "sha256:synthetic",
        "ipaSemanticFingerprint": "fp-synthetic",
        "license": {
            "spdx": "CC-BY-SA-4.0",
            "url": "https://creativecommons.org/licenses/by-sa/4.0/",
            "attribution": "https://en.wiktionary.org/w/index.php?title=read&action=history",
            "shareAlike": True,
            "changeNotice": "derived pronunciation overlay, synthetic fixture",
        },
        "synthetic": True,
    }


def make_observation():
    return {
        "schema": contracts.SCHEMA["observation"],
        "observationId": OBSERVATION_ID,
        "evidenceId": EVIDENCE_ID,
        "language": "en",
        "sourceSpelling": "read",
        "rawIpa": "/SYNTH-IPA-A/",
        "normalizedIpa": "/SYNTH-IPA-A/",
        "notation": "phonemic",
        "completeness": "complete",
        "rawTags": ["IPA", "UK"],
        "rawQualifiers": ["RP"],
        "structuralPath": ["English", "Pronunciation", "IPA"],
        "applicability": scope_for(ENTRY_ID),
        "synthetic": True,
    }


def make_rule():
    return {
        "schema": contracts.SCHEMA["rule"],
        "ruleId": RULE_ID,
        "origin": "system",
        "target": {"kind": "entry", "entryId": ENTRY_ID},
        "operations": [
            {"field": "phonetic", "op": "set", "value": "/SYNTH-IPA-A/", "observationRefs": [OBSERVATION_ID]}
        ],
        "conditions": scope_for(ENTRY_ID),
        "evidenceRefs": [EVIDENCE_ID],
        "createdAt": "2026-10-08T00:00:00Z",
        "reviewStatus": "active",
    }


def make_resolved():
    return {
        "schema": contracts.SCHEMA["resolved"],
        "entryId": ENTRY_ID,
        "conditions": scope_for(ENTRY_ID),
        "defaultReadingRefs": [OBSERVATION_ID],
        "supplementalReadingRefs": [],
        "retainedReadingRefs": [],
        "fieldProvenance": [{"field": "phonetic", "source": "qualified-source", "ref": OBSERVATION_ID}],
        "unresolvedReasons": [],
        "excludedReasons": [],
        "reviewStatus": "active",
    }


def make_manifest():
    return {
        "schema": contracts.SCHEMA["manifest"],
        "manifestVersion": "manifest/1",
        "identitySchemaVersion": contracts.SCHEMA["identity"],
        "evidenceSchemaVersion": contracts.SCHEMA["evidence"],
        "observationSchemaVersion": contracts.SCHEMA["observation"],
        "ruleSchemaVersion": contracts.SCHEMA["rule"],
        "resolvedSchemaVersion": contracts.SCHEMA["resolved"],
        "candidateHash": "candidate-synthetic-1",
        "previousManifestVersion": "manifest/0",
        "assets": [
            {"path": "src/data/overlay.json", "sha256": "sha256:synthetic", "bytes": 10, "licenseSpdx": "CC-BY-SA-4.0"}
        ],
        "perEntryResultVersions": {ENTRY_ID: "resolved/1"},
        "compatibleProjection": [{"entryId": ENTRY_ID, "legacyWord": "read", "phonetic": "SYNTH-IPA-A", "notation": "phonemic"}],
        "licenseAssets": [
            {
                "spdx": "CC-BY-SA-4.0",
                "url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "noticePath": "LICENSES/WIKTIONARY.txt",
                "scope": "wiktionary-derived",
            },
            {
                "spdx": "MIT",
                "url": "https://opensource.org/license/mit",
                "noticePath": "THIRD_PARTY_NOTICES.md",
                "scope": "application",
            },
        ],
        "approvalId": APPROVAL_ID,
    }


def make_approval():
    return {
        "schema": contracts.SCHEMA["approval"],
        "approvalId": APPROVAL_ID,
        "candidateHash": "candidate-synthetic-1",
        "baseManifestVersion": "manifest/0",
        "identitySchemaVersion": contracts.SCHEMA["identity"],
        "evidenceSchemaVersion": contracts.SCHEMA["evidence"],
        "observationSchemaVersion": contracts.SCHEMA["observation"],
        "ruleSchemaVersion": contracts.SCHEMA["rule"],
        "resolvedSchemaVersion": contracts.SCHEMA["resolved"],
        "includedHeads": ["read"],
        "excludedHeads": [],
        "approvedBy": "synthetic-tester",
        "approvedAt": "2026-10-08T00:00:00Z",
        "action": "approve-batch",
    }


def make_checkpoint():
    return {
        "schema": contracts.SCHEMA["checkpoint"],
        "batchId": "batch-synthetic-1",
        "schemaVersions": {"overlay": contracts.SCHEMA["overlay"], "extractor": "extractor/1", "tagRule": "tags/1"},
        "approvedBudget": {"maxDistinctHeads": 100, "maxDecompressedBytes": 20971520, "authorized": True},
        "queue": ["read"],
        "headStates": {"read": "reported"},
        "startedDistinctHeads": ["read"],
        "counts": {"requests": 1, "retries": 0, "auxiliaryRequests": 1, "decompressedBytes": 1024, "networkBytes": 512},
        "lastCompletionEvidence": EVIDENCE_ID,
    }


def make_display():
    return {
        "schema": contracts.SCHEMA["display"],
        "entryId": ENTRY_ID,
        "role": "base",
        "word": "read",
        "originalIpa": "/SYNTH-IPA-A/",
        "notation": "phonemic",
        "accent": {"class": "unspecified", "label": "未注明口音", "unspecified": True},
        "usage": [],
        "tier": "default",
        "reviewStatus": "active",
        "origin": "qualified-source",
        "attribution": {
            "pageUrl": "https://en.wiktionary.org/wiki/read",
            "historyUrl": "https://en.wiktionary.org/w/index.php?title=read&action=history",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            "licenseSpdx": "CC-BY-SA-4.0",
            "changeNotice": "derived pronunciation overlay, synthetic fixture",
        },
        "synthetic": True,
    }


def make_document_set():
    return {
        "identityEntryIds": [ENTRY_ID],
        "identityLexemeIds": [LEXEME_ID],
        "evidence": [make_evidence()],
        "observations": [make_observation()],
        "rules": [make_rule()],
        "resolved": [make_resolved()],
        "manifest": make_manifest(),
        "approvals": [make_approval()],
        "checkpoints": [make_checkpoint()],
        "displays": [make_display()],
    }


class PronunciationContractsTest(unittest.TestCase):
    def test_schema_constants_match_typescript(self) -> None:
        self.assertTrue(TS_CONTRACTS_PATH.exists(), "缺少 contracts.ts")
        parsed = contracts.parse_schema_constants_from_typescript(
            TS_CONTRACTS_PATH.read_text(encoding="utf-8")
        )
        self.assertEqual(parsed, contracts.SCHEMA)
        self.assertEqual(parsed["identity"], "pronunciation-identity/1")

    def test_valid_document_set_passes(self) -> None:
        self.assertEqual(contracts.validate_document_set(make_document_set()), [])

    def test_rejects_unknown_as_all(self) -> None:
        document = make_document_set()
        document["observations"][0]["applicability"]["language"] = {"kind": "all"}
        issues = contracts.validate_document_set(document)
        self.assertTrue(issues)
        self.assertTrue(any("scope-unknown-as-all" in issue for issue in issues))
        # unknown 缺原因也被拒。
        document2 = make_document_set()
        document2["observations"][0]["applicability"]["sense"] = {"kind": "unknown"}
        self.assertTrue(contracts.validate_document_set(document2))
        # explicit-all 缺证据也被拒。
        document3 = make_document_set()
        document3["rules"][0]["conditions"]["accent"] = {"kind": "explicit-all", "evidence": []}
        self.assertTrue(contracts.validate_document_set(document3))

    def test_rejects_missing_license(self) -> None:
        document = make_document_set()
        document["evidence"][0]["license"]["spdx"] = "MIT"
        issues = contracts.validate_document_set(document)
        self.assertTrue(any("license-spdx" in issue for issue in issues))
        # manifest 缺 Wiktionary 许可资产。
        document2 = make_document_set()
        document2["manifest"]["licenseAssets"] = [document2["manifest"]["licenseAssets"][1]]
        self.assertTrue(contracts.validate_document_set(document2))

    def test_rejects_dangling_references(self) -> None:
        bad_evidence = make_document_set()
        bad_evidence["observations"][0]["evidenceId"] = "ev-missing"
        self.assertTrue(contracts.validate_document_set(bad_evidence))

        bad_reading = make_document_set()
        bad_reading["resolved"][0]["defaultReadingRefs"] = ["obs-missing"]
        self.assertTrue(contracts.validate_document_set(bad_reading))

        bad_target = make_document_set()
        bad_target["rules"][0]["target"]["entryId"] = "ent-missing"
        self.assertTrue(contracts.validate_document_set(bad_target))

        bad_per_entry = make_document_set()
        bad_per_entry["manifest"]["perEntryResultVersions"] = {"ent-missing": "r1"}
        self.assertTrue(contracts.validate_document_set(bad_per_entry))

    def test_rejects_schema_mismatch_and_duplicates(self) -> None:
        bad_schema = make_document_set()
        bad_schema["evidence"][0]["schema"] = "wrong/0"
        self.assertTrue(any("schema-version" in issue for issue in contracts.validate_document_set(bad_schema)))

        duplicate = make_document_set()
        duplicate["evidence"].append(json.loads(json.dumps(duplicate["evidence"][0])))
        self.assertTrue(any("duplicate-id" in issue for issue in contracts.validate_document_set(duplicate)))

    def test_rejects_approval_mismatch(self) -> None:
        document = make_document_set()
        document["manifest"]["candidateHash"] = "candidate-other"
        self.assertTrue(any("approval-mismatch" in issue for issue in contracts.validate_document_set(document)))

    def test_json_round_trip_is_stable(self) -> None:
        document = make_document_set()
        serialized = contracts.canonical_json(document)
        restored = json.loads(serialized)
        self.assertEqual(contracts.canonical_json(restored), serialized)
        self.assertEqual(contracts.validate_document_set(restored), [])
        fingerprint = contracts.document_fingerprint(document)
        self.assertEqual(fingerprint, contracts.document_fingerprint(restored))

    def test_scope_dimensions_include_entry_and_lexeme(self) -> None:
        self.assertIn("entry", contracts.SCOPE_DIMENSIONS)
        self.assertIn("lexeme", contracts.SCOPE_DIMENSIONS)
        self.assertEqual(len(contracts.SCOPE_DIMENSIONS), 8)

    def test_empty_observation_allowed(self) -> None:
        document = make_document_set()
        document["observations"][0]["rawIpa"] = ""
        document["observations"][0]["normalizedIpa"] = ""
        document["observations"][0]["completeness"] = "empty"
        self.assertEqual(contracts.validate_document_set(document), [])

    def test_rule_operation_set_empty_rejected_and_suppress_ok(self) -> None:
        set_empty = make_document_set()
        set_empty["rules"][0]["operations"] = [{"field": "phonetic", "op": "set", "value": ""}]
        issues = contracts.validate_document_set(set_empty)
        self.assertTrue(any("rule-op-set-empty" in issue for issue in issues))

        suppress = make_document_set()
        suppress["rules"][0]["operations"] = [{"field": "phonetic", "op": "suppress"}]
        self.assertEqual(contracts.validate_document_set(suppress), [])

        clear_with_value = make_document_set()
        clear_with_value["rules"][0]["operations"] = [{"field": "phonetic", "op": "clear", "value": "/x/"}]
        self.assertTrue(any("rule-op-value-not-allowed" in issue for issue in contracts.validate_document_set(clear_with_value)))

    def test_required_document_lists_not_defaulted(self) -> None:
        missing = make_document_set()
        del missing["evidence"]
        self.assertTrue(any("document-list-required" in issue for issue in contracts.validate_document_set(missing)))

        null_list = make_document_set()
        null_list["evidence"] = None
        self.assertTrue(any("document-list-required" in issue for issue in contracts.validate_document_set(null_list)))

        # 任意 null/primitive 不得抛异常。
        try:
            issues = contracts.validate_document_set(
                {"identityEntryIds": [1], "evidence": [None], "observations": 5, "rules": None, "resolved": {}, "approvals": "x", "checkpoints": 0, "manifest": 42}
            )
        except Exception as error:  # noqa: BLE001
            self.fail(f"不应抛异常：{error}")
        self.assertTrue(issues)

    def test_manifest_and_approval_version_constants(self) -> None:
        bad_manifest = make_document_set()
        bad_manifest["manifest"]["ruleSchemaVersion"] = "pronunciation-rule/0"
        self.assertTrue(any("schema-version" in issue for issue in contracts.validate_document_set(bad_manifest)))

        bad_approval = make_document_set()
        bad_approval["approvals"][0]["resolvedSchemaVersion"] = "pronunciation-resolved/0"
        self.assertTrue(any("schema-version" in issue for issue in contracts.validate_document_set(bad_approval)))

    def test_dangling_explicit_all_and_operation_refs(self) -> None:
        dangling_all = make_document_set()
        dangling_all["rules"][0]["conditions"]["accent"] = {"kind": "explicit-all", "evidence": ["ev-missing"]}
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(dangling_all)))

        bad_item = make_document_set()
        bad_item["rules"][0]["conditions"]["accent"] = {"kind": "explicit-all", "evidence": [123]}
        self.assertTrue(any("scope-all-evidence-item" in issue for issue in contracts.validate_document_set(bad_item)))

        bad_op_ref = make_document_set()
        bad_op_ref["rules"][0]["operations"] = [{"field": "phonetic", "op": "set", "value": "/x/", "observationRefs": ["obs-missing"]}]
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_op_ref)))

    def test_invalid_identity_id_rejected(self) -> None:
        document = make_document_set()
        document["identityEntryIds"] = ["read"]
        self.assertTrue(any("invalid-id" in issue for issue in contracts.validate_document_set(document)))
        # lexeme 身份必须是 lex_ 前缀；entry 混入 lex_ 前缀被拒。
        document2 = make_document_set()
        document2["identityEntryIds"] = [LEXEME_ID]
        self.assertTrue(any("invalid-id" in issue for issue in contracts.validate_document_set(document2)))
        document3 = make_document_set()
        document3["identityLexemeIds"] = [ENTRY_ID]
        self.assertTrue(any("invalid-id" in issue for issue in contracts.validate_document_set(document3)))

    def test_rule_created_at_unknown_keeps_valid_pending(self) -> None:
        # 旧有效规则无 timestamp：给原因 + pending-review 仍合法。
        legacy = make_document_set()
        del legacy["rules"][0]["createdAt"]
        legacy["rules"][0]["createdAtUnknownReason"] = "旧规则导入时无 timestamp"
        legacy["rules"][0]["reviewStatus"] = "pending-review"
        self.assertEqual(contracts.validate_document_set(legacy), [])

        # 无 timestamp 也无原因 → 拒。
        no_reason = make_document_set()
        del no_reason["rules"][0]["createdAt"]
        self.assertTrue(any("rule-created-at-required" in issue for issue in contracts.validate_document_set(no_reason)))

        # 无 timestamp 但仍为 active（伪造有效）→ 拒。
        fake_active = make_document_set()
        del fake_active["rules"][0]["createdAt"]
        fake_active["rules"][0]["createdAtUnknownReason"] = "未知"
        self.assertTrue(any("rule-created-at-review" in issue for issue in contracts.validate_document_set(fake_active)))

        # createdAt 已知却又声明 unknown reason → 拒。
        conflict = make_document_set()
        conflict["rules"][0]["createdAtUnknownReason"] = "不应同时出现"
        self.assertTrue(any("rule-created-at-conflict" in issue for issue in contracts.validate_document_set(conflict)))

        # 伪造“今天”的导入时间不在此合同内：createdAt 空字符串同样被拒。
        empty_created = make_document_set()
        empty_created["rules"][0]["createdAt"] = ""
        self.assertTrue(any("required-string" in issue for issue in contracts.validate_document_set(empty_created)))

    def test_optional_lists_reject_malformed(self) -> None:
        bad_lexeme_list = make_document_set()
        bad_lexeme_list["identityLexemeIds"] = "not-an-array"
        self.assertTrue(any("document-list-optional-array" in issue for issue in contracts.validate_document_set(bad_lexeme_list)))

        bad_displays = make_document_set()
        bad_displays["displays"] = {"entryId": ENTRY_ID}
        self.assertTrue(any("document-list-optional-array" in issue for issue in contracts.validate_document_set(bad_displays)))

        # null/primitive 输入不抛异常。
        try:
            issues = contracts.validate_document_set(None)
            issues += contracts.validate_document_set(42)
            issues += contracts.validate_document_set("x")
        except Exception as error:  # noqa: BLE001
            self.fail(f"不应抛异常：{error}")
        self.assertTrue(issues)

    def test_known_scope_refs_must_exist(self) -> None:
        bad_entry = make_document_set()
        bad_entry["observations"][0]["applicability"]["entry"] = known(["ent_99999999-0000-0000-0000-000000000000"])
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_entry)))

        bad_lexeme = make_document_set()
        bad_lexeme["rules"][0]["conditions"]["lexeme"] = known(["lex_99999999-0000-0000-0000-000000000000"])
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_lexeme)))

        # 合法引用（同时出现在 identityLexemeIds）通过。
        self.assertEqual(contracts.validate_document_set(make_document_set()), [])

    def test_rule_lifecycle_refs(self) -> None:
        duplicate = make_document_set()
        second = json.loads(json.dumps(duplicate["rules"][0]))
        duplicate["rules"].append(second)
        self.assertTrue(any("duplicate-id" in issue for issue in contracts.validate_document_set(duplicate)))

        dangling_supersedes = make_document_set()
        dangling_supersedes["rules"][0]["supersedesRuleId"] = "rule-missing"
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(dangling_supersedes)))

        self_ref = make_document_set()
        self_ref["rules"][0]["revokedByRuleId"] = RULE_ID
        self.assertTrue(any("self-reference" in issue for issue in contracts.validate_document_set(self_ref)))

        bad_provenance = make_document_set()
        bad_provenance["resolved"][0]["fieldProvenance"] = [{"field": "phonetic", "source": "user", "ref": "rule-missing"}]
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_provenance)))

        bad_suppression = make_document_set()
        bad_suppression["resolved"][0]["suppression"] = {"reason": "有意清空", "ruleId": "rule-missing"}
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_suppression)))

        bad_checkpoint = make_document_set()
        bad_checkpoint["checkpoints"][0]["lastCompletionEvidence"] = "ev-missing"
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_checkpoint)))

        bad_projection = make_document_set()
        bad_projection["manifest"]["compatibleProjection"] = [
            {"entryId": "ent_99999999-0000-0000-0000-000000000000", "legacyWord": "read"}
        ]
        self.assertTrue(any("dangling-reference" in issue for issue in contracts.validate_document_set(bad_projection)))


if __name__ == "__main__":
    unittest.main()
