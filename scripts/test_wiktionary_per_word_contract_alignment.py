#!/usr/bin/env python3
"""合同终态机械对齐：contract_adapter → contracts.py / contracts.ts 跨语言核对。

本测试只做**离线**对齐：用真实内部模型（结构提取观测、来源证据、采集检查点）
经 ``contract_adapter`` 生成合同 DTO，再用

- Python ``scripts/wiktionary_per_word/contracts.py`` 校验器，以及
- Node + Vite SSR 加载的 ``src/pronunciation-overlay/contracts.ts`` 校验器

对**同一份夹具 JSON** 交叉核对合法/非法结论一致（真正跨语言，而非只验 Python 形状）。

覆盖：8 维含 ``lexeme``、``English→en`` 等价映射、raw tags 保留、空/控制/片段/截断
completeness、来源许可、known entry/lexeme 引用、未知当全范围、坏引用、重复 ID、
primitive/malformed 输入。

零网络、零安装、零采集、零发布；仅合成夹具，不写正式结果。若 Node/Vite 不可用则
**失败**（不当作跳过通过）。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wiktionary_per_word import contracts  # noqa: E402
from wiktionary_per_word.contract_adapter import (  # noqa: E402
    checkpoint_to_contract,
    evidence_to_contract,
    language_to_contract,
    observation_to_contract,
)
from wiktionary_per_word.html_extract import extract_observations  # noqa: E402
from wiktionary_per_word.ledger import (  # noqa: E402
    BatchAuthorization,
    BatchLedger,
    WordStatus,
)
from wiktionary_per_word.offline_reparse import build_source_evidence  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

ENTRY_ID = "ent_11111111-2222-3333-4444-555555555555"
LEXEME_ID = "lex_11111111-2222-3333-4444-555555555555"
APPROVAL_ID = "apr-synthetic-1"
CANDIDATE_HASH = "candidate-synthetic-1"
BASE_MANIFEST = "manifest/0"

HTML = (
    '<h2 id="English">English</h2>'
    '<h4 id="Pronunciation">Pronunciation</h4>'
    "<ul>"
    '<li><span class="IPA">/ri\u02d0d/</span></li>'
    '<li><span class="qualifier-content">(General American)</span>'
    '<span class="IPA">/ri\u02d0d/</span></li>'
    '<li><span class="IPA archaic">/r\u025bd/</span></li>'
    '<li><span class="IPA"></span></li>'
    '<li><span class="IPA">/fr\u00e6g</li>'
    "</ul>"
)


def known(values: list[str]) -> dict[str, object]:
    return {"kind": "known", "values": list(values)}


def make_ledger() -> BatchLedger:
    return BatchLedger.create(
        batch_id="alignment-batch",
        authorization=BatchAuthorization(
            distinct_heads=100,
            decompressed_bytes=20 * 1024 * 1024,
            granted=True,
            source="unit-test-grant",
            synthetic=True,
        ),
        created_at="2026-01-01T00:00:00Z",
        allow_synthetic_authorization=True,
    )


def build_adapter_fixtures() -> dict[str, object]:
    internal_observations = extract_observations(HTML).observations
    evidence = build_source_evidence(
        word="read",
        page_url="https://en.wiktionary.org/wiki/read",
        history_url="https://en.wiktionary.org/w/index.php?title=read&action=history",
        revid=42,
        fetched_at="2026-01-01T00:00:00Z",
        body=HTML.encode("utf-8"),
        observations=internal_observations,
    )
    evidence_payload = evidence_to_contract(evidence, synthetic=True)
    evidence_id = evidence_payload["evidenceId"]

    observations = []
    for index, observation in enumerate(internal_observations):
        observations.append(
            observation_to_contract(
                observation,
                observation_id=f"obs-synthetic-{index}",
                evidence_id=evidence_id,
                source_spelling="read",
                synthetic=True,
            )
        )

    # 一条显式 known entry/lexeme 引用（引用已声明身份），用于引用完整性与 8 维核对。
    known_variant = json.loads(json.dumps(observations[0]))
    known_variant["observationId"] = "obs-synthetic-known"
    known_variant["applicability"]["entry"] = known([ENTRY_ID])
    known_variant["applicability"]["lexeme"] = known([LEXEME_ID])
    observations.append(known_variant)

    ledger = make_ledger()
    ledger.start_word("read")
    ledger.finish_word("read", WordStatus.EXTRACTED)
    checkpoint_payload = checkpoint_to_contract(
        ledger.checkpoint, last_completion_evidence=evidence_id
    )

    return {
        "internal_observations": internal_observations,
        "evidence": evidence_payload,
        "observations": observations,
        "checkpoint": checkpoint_payload,
    }


def make_manifest() -> dict[str, object]:
    return {
        "schema": contracts.SCHEMA["manifest"],
        "manifestVersion": "manifest/1",
        "identitySchemaVersion": contracts.SCHEMA["identity"],
        "evidenceSchemaVersion": contracts.SCHEMA["evidence"],
        "observationSchemaVersion": contracts.SCHEMA["observation"],
        "ruleSchemaVersion": contracts.SCHEMA["rule"],
        "resolvedSchemaVersion": contracts.SCHEMA["resolved"],
        "candidateHash": CANDIDATE_HASH,
        "previousManifestVersion": BASE_MANIFEST,
        "assets": [
            {
                "path": "src/data/overlay.json",
                "sha256": "a" * 64,
                "bytes": 10,
                "licenseSpdx": "CC-BY-SA-4.0",
            }
        ],
        "perEntryResultVersions": {ENTRY_ID: "resolved/1"},
        "compatibleProjection": [{"entryId": ENTRY_ID, "legacyWord": "read"}],
        "licenseAssets": [
            {
                "spdx": "CC-BY-SA-4.0",
                "url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "noticePath": "LICENSES/WIKTIONARY.txt",
                "scope": "wiktionary-derived",
            }
        ],
        "approvalId": APPROVAL_ID,
    }


def make_approval() -> dict[str, object]:
    return {
        "schema": contracts.SCHEMA["approval"],
        "approvalId": APPROVAL_ID,
        "candidateHash": CANDIDATE_HASH,
        "baseManifestVersion": BASE_MANIFEST,
        "identitySchemaVersion": contracts.SCHEMA["identity"],
        "evidenceSchemaVersion": contracts.SCHEMA["evidence"],
        "observationSchemaVersion": contracts.SCHEMA["observation"],
        "ruleSchemaVersion": contracts.SCHEMA["rule"],
        "resolvedSchemaVersion": contracts.SCHEMA["resolved"],
        "includedHeads": ["read"],
        "excludedHeads": [],
        "approvedBy": "synthetic-tester",
        "approvedAt": "2026-01-01T00:00:00Z",
        "action": "approve-batch",
    }


def make_document_set() -> dict[str, object]:
    fixtures = build_adapter_fixtures()
    return {
        "identityEntryIds": [ENTRY_ID],
        "identityLexemeIds": [LEXEME_ID],
        "evidence": [fixtures["evidence"]],
        "observations": fixtures["observations"],
        "rules": [],
        "resolved": [],
        "manifest": make_manifest(),
        "approvals": [make_approval()],
        "checkpoints": [fixtures["checkpoint"]],
        "displays": [],
    }


def make_fixtures() -> list[dict[str, object]]:
    valid = make_document_set()

    def clone() -> dict[str, object]:
        return json.loads(json.dumps(valid))

    fixtures: list[dict[str, object]] = [{"name": "valid", "doc": valid}]

    doc = clone()
    doc["observations"][0]["applicability"]["language"] = {"kind": "all"}
    fixtures.append({"name": "unknown-as-all", "doc": doc})

    doc = clone()
    doc["evidence"][0]["license"]["spdx"] = "MIT"
    fixtures.append({"name": "missing-license", "doc": doc})

    doc = clone()
    del doc["observations"][0]["applicability"]["lexeme"]
    fixtures.append({"name": "missing-lexeme-dimension", "doc": doc})

    doc = clone()
    doc["observations"][0]["evidenceId"] = "ev-missing"
    fixtures.append({"name": "dangling-evidence", "doc": doc})

    doc = clone()
    doc["observations"][-1]["applicability"]["entry"] = known(
        ["ent_99999999-0000-0000-0000-000000000000"]
    )
    fixtures.append({"name": "dangling-known-entry", "doc": doc})

    doc = clone()
    doc["observations"][-1]["applicability"]["lexeme"] = known(
        ["lex_99999999-0000-0000-0000-000000000000"]
    )
    fixtures.append({"name": "dangling-known-lexeme", "doc": doc})

    doc = clone()
    doc["evidence"].append(json.loads(json.dumps(doc["evidence"][0])))
    fixtures.append({"name": "duplicate-evidence-id", "doc": doc})

    doc = clone()
    doc["observations"] = 5
    fixtures.append({"name": "malformed-list", "doc": doc})

    doc = clone()
    doc["identityEntryIds"] = ["read"]
    fixtures.append({"name": "invalid-id-format", "doc": doc})

    fixtures.append({"name": "primitive-document", "doc": None})
    return fixtures


NODE_HARNESS = textwrap.dedent(
    """
    import { readFileSync } from 'node:fs';
    import { createServer } from 'vite';

    const fixtures = JSON.parse(readFileSync(process.env.ALIGNMENT_FIXTURES, 'utf8'));
    const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });
    try {
      const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
      const out = fixtures.map((item) => {
        const result = contracts.validateOverlayDocumentSet(item.doc);
        return {
          name: item.name,
          valid: result.valid,
          codes: result.issues.map((issue) => issue.code),
        };
      });
      console.log(JSON.stringify(out));
    } finally {
      await server.close();
    }
    """
)


def run_node_validation(fixtures: list[dict[str, object]]) -> dict[str, dict[str, object]]:
    with tempfile.TemporaryDirectory() as directory:
        fixture_path = Path(directory) / "alignment-fixtures.json"
        fixture_path.write_text(
            json.dumps(fixtures, ensure_ascii=False), encoding="utf-8"
        )
        environment = dict(os.environ)
        environment["ALIGNMENT_FIXTURES"] = str(fixture_path)
        result = subprocess.run(
            ["node", "--input-type=module", "-e", NODE_HARNESS],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=180,
            env=environment,
        )
    if result.returncode != 0:
        raise AssertionError(
            f"Node/Vite SSR 校验失败（退出码 {result.returncode}）：{result.stderr[-2000:]}"
        )
    try:
        parsed = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as error:
        raise AssertionError(f"无法解析 Node 输出：{error}; stdout={result.stdout[-2000:]}") from error
    return {item["name"]: item for item in parsed}


class ContractAlignmentCrossLanguageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixtures = make_fixtures()
        cls.python_valid = {
            item["name"]: (contracts.validate_document_set(item["doc"]) == [])
            for item in cls.fixtures
        }
        cls.node_result = run_node_validation(cls.fixtures)

    def test_cross_language_validity_agrees(self) -> None:
        self.assertEqual(len(self.node_result), len(self.fixtures))
        mismatches = [
            name
            for name, valid in self.python_valid.items()
            if bool(self.node_result[name]["valid"]) != bool(valid)
        ]
        self.assertEqual(mismatches, [], f"TS/Python 结论不一致：{mismatches}")

    def test_valid_document_set_passes_both(self) -> None:
        self.assertTrue(self.python_valid["valid"])
        self.assertTrue(self.node_result["valid"]["valid"])

    def test_expected_invalid_fixtures(self) -> None:
        for name in (
            "unknown-as-all",
            "missing-license",
            "missing-lexeme-dimension",
            "dangling-evidence",
            "dangling-known-entry",
            "dangling-known-lexeme",
            "duplicate-evidence-id",
            "malformed-list",
            "invalid-id-format",
            "primitive-document",
        ):
            self.assertFalse(self.python_valid[name], name)
            self.assertFalse(self.node_result[name]["valid"], name)

    def test_adapter_outputs_shape_and_language_mapping(self) -> None:
        fixtures = build_adapter_fixtures()
        self.assertEqual(language_to_contract("English"), "en")
        for observation in fixtures["observations"]:
            self.assertEqual(
                set(observation["applicability"]),
                {"language", "entry", "lexeme", "role", "pos", "sense", "accent", "other"},
            )
            self.assertEqual(observation["language"], "en")
            # 顶层与 scope 一致：language known 值同样映射为 en。
            self.assertEqual(
                observation["applicability"]["language"],
                {"kind": "known", "values": ["en"]},
            )
            issues: list[str] = []
            contracts.validate_observation(observation, "obs", issues)
            self.assertEqual(issues, [], f"observation 合同问题: {issues}")
        evidence = fixtures["evidence"]
        self.assertEqual(evidence["language"], "en")
        self.assertEqual(evidence["license"]["spdx"], "CC-BY-SA-4.0")
        self.assertTrue(evidence["license"]["shareAlike"])
        for key in (
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
            "cacheRef",
        ):
            self.assertIn(key, evidence)
        issues = []
        contracts.validate_source_evidence(evidence, "evidence", issues)
        self.assertEqual(issues, [], f"evidence 合同问题: {issues}")
        issues = []
        contracts.validate_checkpoint(fixtures["checkpoint"], "checkpoint", issues)
        self.assertEqual(issues, [], f"checkpoint 合同问题: {issues}")

    def test_raw_unknown_tags_preserved_in_contract(self) -> None:
        # HTML unknown tags metadata 在合同 rawTags 可保。
        observations = extract_observations(
            '<div class="nonstandard-new"><span class="IPA">/x/</span></div>'
        ).observations
        payload = observation_to_contract(
            observations[0],
            observation_id="obs:1",
            evidence_id="ev:1",
            source_spelling="x",
        )
        self.assertIn("nonstandard-new", payload["rawTags"])
        self.assertIn("IPA", payload["rawTags"])

    def test_empty_fragment_evidence_only_not_qualified(self) -> None:
        # 空/片段观测为 evidence-only：completeness 非 complete，不得宣称合格。
        observations = extract_observations(HTML).observations
        payloads = [
            observation_to_contract(
                observation,
                observation_id=f"obs:{index}",
                evidence_id="ev:1",
                source_spelling="read",
            )
            for index, observation in enumerate(observations)
        ]
        empties = [p for p in payloads if p["rawIpa"] == ""]
        self.assertTrue(empties)
        self.assertEqual(empties[0]["completeness"], "empty")
        self.assertEqual(empties[0]["rawIpa"], "")
        self.assertEqual(empties[0]["normalizedIpa"], "")
        self.assertNotIn("default", json.dumps(empties[0]))


if __name__ == "__main__":
    unittest.main()
