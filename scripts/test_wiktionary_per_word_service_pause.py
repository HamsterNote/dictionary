"""Synthetic service failures: durable nonterminal pauses and charged resume."""

import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from test_wiktionary_per_word_support import (
    REAL_LOOKING_UA, ScriptedTransport, english_html, fixed_now,
    plain_response, text_payload, tocdata_payload,
)
from wiktionary_per_word.collector import Collector
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache
from wiktionary_per_word.http_adapter import (
    FakeClock, HttpAdapter, KnownZeroTransportError,
)
from wiktionary_per_word.ledger import (
    BatchAuthorization, BatchLedger, ResumeRejected, TERMINAL_STATUSES, WordStatus,
)


class ServicePauseTest(unittest.TestCase):
    def setUp(self):
        for target in ("socket.socket.connect", "socket.socket.connect_ex",
                       "socket.create_connection"):
            guard = patch(target, side_effect=AssertionError("offline test forbids sockets"))
            guard.start()
            self.addCleanup(guard.stop)

    def ledger(self, path):
        return BatchLedger.create(
            batch_id="synthetic-service-pause", path=path, created_at=fixed_now()(),
            authorization=BatchAuthorization(
                100, 20 * 1048576, True, "synthetic offline fixture", synthetic=True,
            ), allow_synthetic_authorization=True,
        )

    def collector(self, ledger, transport):
        return Collector(
            ledger=ledger,
            adapter=HttpAdapter(
                transport=transport, budget=ledger.budget, user_agent=REAL_LOOKING_UA,
                clock=FakeClock(), interval_seconds=5, max_retries=2,
            ),
            cache=ResponseCache(), evidence_ledger=EvidenceLedger(), now=fixed_now(),
        )

    def assert_paused(self, ledger, path, reason, requests, body_bytes, retries, errors=None):
        payload = json.loads(path.read_text())
        self.assertEqual(payload["pauseReason"], reason)
        self.assertEqual(payload["words"]["note"]["status"], "paused")
        self.assertNotIn(ledger.checkpoint.words["note"].status, TERMINAL_STATUSES)
        self.assertNotIn("read", payload["words"])
        self.assertIsNone(payload["pendingCache"])
        self.assertEqual(payload["budget"]["distinct_heads_started"], 1)
        self.assertEqual(payload["budget"]["request_count"], requests)
        self.assertEqual(payload["budget"]["network_bytes"], body_bytes)
        self.assertEqual(payload["budget"]["decompressed_bytes"], body_bytes)
        self.assertEqual(payload["budget"]["retry_count"], retries)
        self.assertEqual(payload["budget"]["error_count"], requests if errors is None else errors)
        return payload

    def assert_charged_resume(self, path, budget_before):
        ledger = BatchLedger.load(path, allow_synthetic_authorization=True)
        self.assertEqual(ledger.budget.to_json(), budget_before)
        ledger.resume()
        self.assertFalse(ledger.paused)
        self.assertEqual(ledger.budget.to_json(), budget_before)
        toc = tocdata_payload([{"line": "English", "level": "2", "number": "3"}])
        main = text_payload(english_html())
        script = ScriptedTransport([plain_response(toc), plain_response(main)])
        report = self.collector(ledger, script).run_batch(["note"])
        self.assertIsNone(report.paused_reason)
        self.assertEqual(report.processed, ["note"])
        self.assertEqual(len(script.calls), 2)
        self.assertIn("page=note", script.calls[0][0])
        self.assertEqual(ledger.checkpoint.words["note"].status, WordStatus.EXTRACTED)
        self.assertEqual(ledger.checkpoint.words["note"].attempts, 2)
        self.assertEqual(ledger.budget.distinct_heads_started, 1)
        self.assertEqual(ledger.budget.request_count, budget_before["request_count"] + 2)
        self.assertEqual(ledger.budget.retry_count, budget_before["retry_count"])
        self.assertEqual(ledger.budget.network_bytes,
                         budget_before["network_bytes"] + len(toc) + len(main))
        self.assertEqual(ledger.budget.decompressed_bytes,
                         budget_before["decompressed_bytes"] + len(toc) + len(main))
        reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
        self.assertIsNone(reloaded.checkpoint.active_request)
        self.assertIsNone(reloaded.checkpoint.pending_cache)

    def exercise_http(self, statuses):
        for status in statuses:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "checkpoint.json"
                ledger = self.ledger(path)
                attempts = 1 if status in (403, 407, 451) else 3
                reason = f"http-{status}" + ("" if attempts == 1 else "-retries-exhausted")
                responses = [plain_response(b"denied", status=status)
                             for _ in range(attempts)]
                sentinel = plain_response(b"must not dispatch")
                script = ScriptedTransport(responses + [sentinel])
                collector = self.collector(ledger, script)
                report = collector.run_batch(["note", "read"])
                self.assertEqual(report.paused_reason, reason)
                self.assertEqual(len(script.calls), attempts)
                self.assertEqual(script.responses, [sentinel])
                self.assertTrue(all(response.closed for response in responses))
                payload = self.assert_paused(
                    ledger, path, reason, attempts, 6 * attempts, attempts - 1,
                )
                self.assertIsNone(payload["activeRequest"])
                collector.run_batch(["note", "read"])
                self.assertEqual(len(script.calls), attempts)
                self.assert_charged_resume(path, payload["budget"])

    def test_403_407_451_first_response_pauses_then_resume_is_charged(self):
        self.exercise_http((403, 407, 451))

    def test_429_retry_exhaustion_pauses_then_resume_is_charged(self):
        self.exercise_http((429,))

    def test_5xx_retry_exhaustion_pauses_then_resume_is_charged(self):
        self.exercise_http((500, 502, 503, 504, 599))

    def test_known_zero_exhaustion_pauses_and_resume_is_charged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            calls = []

            def refused(url, headers):
                calls.append(url)
                raise KnownZeroTransportError("synthetic proven zero consumption")

            report = self.collector(ledger, refused).run_batch(["note", "read"])
            self.assertEqual(len(calls), 3)
            self.assertEqual(report.paused_reason, "transport-known-zero-exhausted")
            payload = self.assert_paused(
                ledger, path, "transport-known-zero-exhausted", 3, 0, 2,
            )
            self.assertIsNone(payload["activeRequest"])
            self.assert_charged_resume(path, payload["budget"])

    def test_oserror_and_timeout_pause_nonterminal_and_uncertain_resume_fails_closed(self):
        for error in (ConnectionRefusedError("refused"), socket.gaierror("DNS"),
                      TimeoutError("timed out"), OSError("unknown")):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "checkpoint.json"
                ledger = self.ledger(path)
                calls = []

                def broken(url, headers):
                    calls.append(url)
                    raise error

                collector = self.collector(ledger, broken)
                report = collector.run_batch(["note", "read"])
                self.assertEqual(len(calls), 1)
                self.assertEqual(report.paused_reason, "consumption-uncertain")
                payload = self.assert_paused(ledger, path, "consumption-uncertain", 1, 0, 0)
                self.assertTrue(payload["activeRequest"]["settled"])
                self.assertTrue(payload["activeRequest"]["uncertain"])
                self.assertEqual(payload["activeRequest"]["head"], "note")
                collector.run_batch(["note", "read"])
                self.assertEqual(len(calls), 1)
                reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
                with self.assertRaises(ResumeRejected):
                    reloaded.resume()
                self.assertEqual(reloaded.budget.to_json(), payload["budget"])

    def test_uncertain_read_retains_known_bytes_and_word_for_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            response = plain_response(b"known")
            original = response.reader

            def read(size):
                chunk = original(size)
                if not chunk:
                    raise TimeoutError("synthetic read timeout")
                return chunk

            response.reader = read
            script = ScriptedTransport([response])
            report = self.collector(ledger, script).run_batch(["note", "read"])
            self.assertEqual(report.paused_reason, "consumption-uncertain")
            self.assertEqual(len(script.calls), 1)
            payload = self.assert_paused(ledger, path, "consumption-uncertain", 1, 5, 0, errors=0)
            self.assertTrue(payload["activeRequest"]["uncertain"])

    def test_title_errors_fail_word_and_continue(self):
        for status in (400, 404, 410, 414):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "checkpoint.json"
                ledger = self.ledger(path)
                script = ScriptedTransport([
                    plain_response(b"title-error", status=status),
                    plain_response(b'{"error":{"code":"missingtitle"}}'),
                ])
                report = self.collector(ledger, script).run_batch(["note", "read"])
                self.assertEqual(len(script.calls), 2)
                self.assertIsNone(report.paused_reason)
                self.assertEqual(ledger.checkpoint.words["note"].status, WordStatus.FAILED)
                self.assertEqual(ledger.checkpoint.words["read"].status, WordStatus.MISSING)
                self.assertIsNone(ledger.checkpoint.active_request)

    def test_main_rejection_keeps_toc_cost_and_resumes_the_same_word(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            toc = tocdata_payload([{"line": "English", "level": "2", "number": "3"}])
            script = ScriptedTransport([
                plain_response(toc), plain_response(b"denied", status=403),
            ])
            report = self.collector(ledger, script).run_batch(["note", "read"])
            self.assertEqual(report.paused_reason, "http-403")
            self.assertEqual(len(script.calls), 2)
            payload = self.assert_paused(
                ledger, path, "http-403", 2, len(toc) + 6, 0, errors=1,
            )
            self.assertIsNone(payload["activeRequest"])
            self.assert_charged_resume(path, payload["budget"])

    def test_request_cap_still_prevents_service_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            ledger.budget.max_requests = ledger.checkpoint.authorization.requests = 1
            script = ScriptedTransport([plain_response(b"denied", status=403)])
            self.collector(ledger, script).run_batch(["note", "read"])
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()
            self.assertEqual(reloaded.checkpoint.pause_reason, "http-403")

    def test_denial_body_limit_preserves_stricter_pause_and_nonterminal_word(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            ledger.budget.max_decompressed_bytes = ledger.checkpoint.authorization.decompressed_bytes = 3
            script = ScriptedTransport([plain_response(b"denied", status=403)])
            report = self.collector(ledger, script).run_batch(["note", "read"])
            self.assertEqual(report.paused_reason, "decompressed-budget-exhausted")
            self.assertEqual(len(script.calls), 1)
            self.assertEqual(ledger.checkpoint.words["note"].status, WordStatus.PAUSED)
            self.assertNotIn("read", ledger.checkpoint.words)
            self.assertIsNone(ledger.checkpoint.pending_cache)
            self.assertIsNotNone(ledger.checkpoint.active_request)
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with self.assertRaises(ResumeRejected):
                reloaded.resume()

    def test_resume_persist_failure_preserves_pause(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            script = ScriptedTransport([plain_response(b"denied", status=403)])
            self.collector(ledger, script).run_batch(["note", "read"])
            reloaded = BatchLedger.load(path, allow_synthetic_authorization=True)
            with patch.object(reloaded, "persist", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    reloaded.resume()
            self.assertEqual(reloaded.checkpoint.pause_reason, "http-403")
            self.assertFalse(reloaded.resumable)
            with self.assertRaises(ResumeRejected):
                reloaded.assert_can_request()

    def test_resume_cannot_clear_service_pause_with_uncleared_request(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            ledger = self.ledger(path)
            ledger.start_word("note")
            ledger.checkpoint.words["note"].status = WordStatus.PAUSED
            ledger.mark_paused("http-403")
            ledger.checkpoint.active_request = {"head": "note", "settled": False}
            ledger.persist()
            with self.assertRaises(ResumeRejected):
                ledger.resume()
            self.assertEqual(ledger.checkpoint.pause_reason, "consumption-uncertain")


if __name__ == "__main__":
    unittest.main()
