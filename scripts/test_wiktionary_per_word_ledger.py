#!/usr/bin/env python3
"""持久账本 / checkpoint / 状态机离线 unittest：tasks 6.2 与 6.3。

覆盖：distinct 预扣、失败/缺页/无合格计额、同词重试不加 distinct、第 100 词
可开始且第 101 不启、bytes 触限暂停不补请求、40 词/8 MiB 恢复不 reset、
触限暂停不可绕过、in-flight 消费不确定 fail closed、版本改变拒恢复、
synthetic 授权被拒、原子持久化。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wiktionary_per_word.ledger import (  # noqa: E402
    AuthorizationError,
    BatchAuthorization,
    BatchCheckpoint,
    BatchLedger,
    ResumeRejected,
    VersionMismatch,
    WordStatus,
)

NOW = "2026-01-01T00:00:00Z"


def authorization(heads: int = 100, mib: float = 20.0, *, synthetic: bool = False) -> BatchAuthorization:
    return BatchAuthorization(
        distinct_heads=heads,
        decompressed_bytes=int(mib * 1024 * 1024),
        granted=True,
        source="unit-test-grant",
        synthetic=synthetic,
    )


class LedgerBudgetTest(unittest.TestCase):
    def test_distinct_preclaimed_and_persisted_before_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = BatchLedger.create(
                batch_id="b1",
                authorization=authorization(heads=2, mib=1),
                path=path,
                created_at=NOW,
                allow_synthetic_authorization=True,
            )
            ledger.start_word("alpha")
            self.assertEqual(ledger.budget.distinct_heads_started, 1)
            persisted = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["budget"]["distinct_heads_started"], 1)
            self.assertEqual(
                persisted["words"]["alpha"]["status"], WordStatus.IN_FLIGHT.value
            )

    def test_failure_missing_no_qualified_all_count(self) -> None:
        ledger = BatchLedger.create(
            batch_id="b2",
            authorization=authorization(heads=10),
            created_at=NOW,
            allow_synthetic_authorization=True,
        )
        for head, status in (
            ("fail", WordStatus.FAILED),
            ("miss", WordStatus.MISSING),
            ("none", WordStatus.NO_QUALIFIED),
        ):
            ledger.start_word(head)
            ledger.finish_word(head, status)
        self.assertEqual(ledger.budget.distinct_heads_started, 3)
        self.assertEqual(ledger.processed_distinct_heads(), 3)

    def test_retry_same_word_does_not_add_distinct(self) -> None:
        ledger = BatchLedger.create(
            batch_id="b3",
            authorization=authorization(heads=5),
            created_at=NOW,
            allow_synthetic_authorization=True,
        )
        ledger.start_word("read")
        ledger.finish_word("read", WordStatus.FAILED)
        ledger.start_word("read")
        self.assertEqual(ledger.budget.distinct_heads_started, 1)
        self.assertEqual(ledger.checkpoint.words["read"].attempts, 2)

    def test_hundredth_allowed_but_101st_not_started(self) -> None:
        ledger = BatchLedger.create(
            batch_id="b4",
            authorization=authorization(heads=100),
            created_at=NOW,
            allow_synthetic_authorization=True,
        )
        for index in range(100):
            head = f"word{index:03d}"
            ledger.start_word(head)
            ledger.finish_word(head, WordStatus.EXTRACTED)
        self.assertEqual(ledger.budget.distinct_heads_started, 100)
        with self.assertRaises(ResumeRejected):
            ledger.start_word("word100")
        self.assertNotIn("word100", ledger.checkpoint.words)
        self.assertEqual(ledger.checkpoint.pause_reason, "distinct-head-budget")

    def test_byte_budget_precheck_pauses(self) -> None:
        ledger = BatchLedger.create(
            batch_id="b5",
            authorization=authorization(heads=100, mib=1),
            created_at=NOW,
            allow_synthetic_authorization=True,
        )
        ledger.budget.decompressed_bytes = ledger.budget.max_decompressed_bytes
        with self.assertRaises(ResumeRejected):
            ledger.assert_can_request()
        self.assertEqual(ledger.checkpoint.pause_reason, "decompressed-budget-exhausted")

    def test_synthetic_authorization_rejected_by_real_entry(self) -> None:
        with self.assertRaises(AuthorizationError):
            BatchLedger.create(
                batch_id="b6",
                authorization=authorization(synthetic=True),
                created_at=NOW,
                allow_synthetic_authorization=False,
            )

    def test_ungranted_authorization_rejected(self) -> None:
        bad = BatchAuthorization(
            distinct_heads=100, decompressed_bytes=1024, granted=False, source="x"
        )
        with self.assertRaises(AuthorizationError):
            BatchLedger.create(
                batch_id="b7", authorization=bad, created_at=NOW, allow_synthetic_authorization=True
            )


class ResumeTest(unittest.TestCase):
    def test_resume_40_words_8mib_continues_without_reset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = BatchLedger.create(
                batch_id="batch-a",
                authorization=authorization(heads=100, mib=20),
                path=path,
                created_at=NOW,
                allow_synthetic_authorization=True,
            )
            for index in range(40):
                head = f"w{index:03d}"
                ledger.start_word(head)
                ledger.finish_word(head, WordStatus.EXTRACTED)
            ledger.budget.decompressed_bytes = 8 * 1024 * 1024
            ledger.persist()

            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            reloaded.resume()
            self.assertEqual(reloaded.budget.distinct_heads_started, 40)
            self.assertEqual(reloaded.budget.decompressed_bytes, 8 * 1024 * 1024)
            # 从原累计继续：第 41 个词可开始。
            reloaded.start_word("w040")
            self.assertEqual(reloaded.budget.distinct_heads_started, 41)

    def test_budget_pause_resume_is_rejected(self) -> None:
        ledger = BatchLedger.create(
            batch_id="batch-b",
            authorization=authorization(),
            created_at=NOW,
            allow_synthetic_authorization=True,
        )
        ledger.mark_paused("decompressed-budget-exhausted", "used all")
        with self.assertRaises(ResumeRejected):
            ledger.resume()

    def test_inflight_uncertain_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = BatchLedger.create(
                batch_id="batch-c",
                authorization=authorization(),
                path=path,
                created_at=NOW,
                allow_synthetic_authorization=True,
            )
            ledger.start_word("inflight")  # 保持 IN_FLIGHT
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()
            self.assertEqual(reloaded.checkpoint.pause_reason, "consumption-uncertain")

    def test_version_mismatch_rejected_not_reset(self) -> None:
        payload = {
            "batchId": "batch-d",
            "authorization": {
                "distinctHeads": 100,
                "decompressedBytes": 1024,
                "granted": True,
                "source": "x",
            },
            "budget": {"maxDecompressedBytes": 1024, "maxDistinctHeads": 100},
            "words": {},
            "schemaVersion": "schema/9",
            "extractorVersion": "extractor/9",
            "tagRuleVersion": "tags/9",
            "pauseReason": None,
            "pauseDetail": None,
            "createdAt": NOW,
            "updatedAt": NOW,
        }
        with self.assertRaises(VersionMismatch):
            BatchCheckpoint.from_json(payload)

    def test_atomic_persist_leaves_no_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = BatchLedger.create(
                batch_id="batch-e",
                authorization=authorization(),
                path=path,
                created_at=NOW,
                allow_synthetic_authorization=True,
            )
            ledger.start_word("x")
            self.assertTrue(path.exists())
            leftovers = list(Path(directory).glob("*.tmp"))
            self.assertEqual(leftovers, [])
            # 持久化内容为合法 JSON。
            json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
