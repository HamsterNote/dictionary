"""Synthetic confirmation exists only in memory; sockets disabled in every test.

No inputs/authorization.json or actual granted permission is generated. The mocked
reader represents a future user confirmation and cannot be selected by CLI flags.
"""
from contextlib import contextmanager
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest import mock

import refresh_wiktionary_pronunciations as cli
from wiktionary_per_word import authorization as gate
from wiktionary_per_word.collector import Collector
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache
from wiktionary_per_word.http_adapter import FakeClock, HttpAdapter, RunBudget, RequestKind, BudgetPaused
from wiktionary_per_word.ledger import BatchAuthorization, BatchLedger, ResumeRejected, WordStatus
from test_wiktionary_per_word_support import (
    ScriptedTransport, english_html, fixed_now, plain_response, text_payload, tocdata_payload,
)

UA = "HamsterDictionaryPronunciationCollector/0.1 (+https://github.com/HamsterNote/dictionary/issues)"


class StrictGateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repo = self.root / "dictionary"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=OfflineFixture",
                        "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty",
                        "-m", "synthetic fixture"], check=True)
        self.commit = gate._git(self.repo, "rev-parse", "HEAD")
        self.batch = self.root / "ham37-fixture"
        (self.batch / "inputs").mkdir(parents=True)
        (self.batch / "inputs/heads.txt").write_text("read\nnote\n", encoding="utf-8")
        self.args = cli.build_parser().parse_args([
            "--workspace-root", str(self.root), "--batch-root", "ham37-fixture",
            "--execution-commit", self.commit,
            "--heads-file", "ham37-fixture/inputs/heads.txt",
            "--authorization-file", "ham37-fixture/inputs/authorization.json",
            "--checkpoint", "ham37-fixture/state/checkpoint.json",
            "--cache-dir", "ham37-fixture/cache", "--user-agent", UA,
            "--budget-heads", "100", "--budget-decompressed-mib", "20",
            "--budget-requests", "600", "--interval-seconds", "5", "--max-retries", "2",
        ])
        self.binding = gate.build_binding(self.args, repo=self.repo)
        # Never serialized to an authorization file. Explicitly confined to unittest.
        self.envelope = {"schemaVersion": 1, "granted": True, "synthetic": False,
                         "source": "user-confirmation", "confirmation": "IN-MEMORY TEST FIXTURE ONLY",
                         "binding": deepcopy(self.binding)}
        for target in ("socket.socket.connect", "socket.socket.connect_ex", "socket.create_connection"):
            patcher = mock.patch(target, side_effect=AssertionError("socket forbidden"))
            patcher.start()
            self.addCleanup(patcher.stop)

    @contextmanager
    def confirmation(self):
        real = gate.read_json
        path = self.batch / "inputs/authorization.json"
        def reader(candidate):
            return deepcopy(self.envelope) if candidate == path else real(candidate)
        with mock.patch.object(gate, "read_json", side_effect=reader):
            yield
        self.assertFalse(path.exists())

    def snapshot(self):
        return {str(p.relative_to(self.root)): ("link", os.readlink(p)) if p.is_symlink()
                else ("dir",) if p.is_dir() else ("file", p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.root.rglob("*")}

    def refused_without_effects(self, *, confirmed=True):
        before = self.snapshot()
        # Check filesystem mutators as well as the resulting bytes/file set.
        with mock.patch.object(cli, "_build_urllib_transport", side_effect=AssertionError("transport built")), \
             mock.patch.object(Path, "mkdir", side_effect=AssertionError("mkdir on rejection")), \
             mock.patch.object(gate, "_atomic_json", side_effect=AssertionError("registry write on rejection")):
            if confirmed:
                with self.confirmation(), self.assertRaises(gate.GateRejected):
                    with gate.authorized_session(self.args, repo=self.repo):
                        self.fail("rejected contract entered session")
            else:
                with self.assertRaises(gate.GateRejected):
                    with gate.authorized_session(self.args, repo=self.repo):
                        self.fail("missing user grant entered session")
        self.assertEqual(before, self.snapshot())

    def make_checkpoint(self):
        self.batch.joinpath("state").mkdir(exist_ok=True)
        return BatchLedger.create(
            batch_id="first-round", authorization=BatchAuthorization(
                100, 20 * 1048576, True, "IN-MEMORY TEST FIXTURE ONLY", requests=600),
            path=self.batch / "state/checkpoint.json", created_at=fixed_now()())

    def initial_session(self):
        with self.confirmation(), gate.authorized_session(self.args, repo=self.repo):
            return self.make_checkpoint()

    def test_missing_confirmation_zero_network_zero_writes(self):
        self.refused_without_effects(confirmed=False)

    def test_unavailable_lock_support_refuses_without_effects(self):
        with mock.patch.object(gate, "fcntl", None):
            self.refused_without_effects()

    def test_exact_binding_mock_confirmation_read_only(self):
        before = self.snapshot()
        with self.confirmation():
            self.assertEqual(gate.preflight(self.args, repo=self.repo), self.binding)
        self.assertEqual(before, self.snapshot())

    def test_mutated_confirmation_fields_refuse(self):
        changes = [
            ("headsSha256", "0" * 64), ("userAgent", UA + " changed"),
            ("executionCommit", "1" * 40), ("limits", {"distinctHeads": 100}),
            ("paths", {"cache": "dictionary/src/data"}), ("calls", {"optionalRequests": 1}),
            ("accounting", {}), ("headCount", True), ("extra", "unbound"),
        ]
        for key, value in changes:
            with self.subTest(key=key):
                self.envelope["binding"] = deepcopy(self.binding)
                self.envelope["binding"][key] = value
                self.refused_without_effects()

    def test_strict_grant_types_and_source_refuse(self):
        for key, value in [("granted", "true"), ("granted", False), ("synthetic", True),
                           ("synthetic", 0), ("source", "agent"), ("confirmation", ""),
                           ("schemaVersion", True)]:
            with self.subTest(key=key, value=value):
                original = deepcopy(self.envelope)
                self.envelope[key] = value
                self.refused_without_effects()
                self.envelope = original

    def test_missing_and_altered_invocation_refuse(self):
        changes = [("user_agent", UA + " synthetic"), ("user_agent", UA + " changed"),
                   ("budget_requests", None), ("budget_requests", 601), ("budget_requests", 599),
                   ("budget_heads", 99), ("budget_decompressed_mib", 19),
                   ("budget_decompressed_mib", float("nan")), ("execution_commit", "1" * 40),
                   ("cache_dir", "dictionary/src/data"), ("cache_dir", "ham37-fixture/../cache"),
                   ("checkpoint", "/tmp/checkpoint.json"), ("interval_seconds", 0),
                   ("output", "dictionary/src/data/overwrite.json"),
                   ("endpoint", "https://other.invalid"), ("max_retries", 3)]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                old = getattr(self.args, key)
                setattr(self.args, key, value)
                self.refused_without_effects()
                setattr(self.args, key, old)

    def test_changed_heads_duplicates_and_101st_refuse(self):
        path = self.batch / "inputs/heads.txt"
        for text in ("note\nread\n", "read\nread\n", " read\n", "\n".join(f"w{i}" for i in range(101))):
            with self.subTest(text=text[:20]):
                path.write_text(text)
                self.refused_without_effects()

    def test_dirty_execution_tree_refuses(self):
        (self.repo / "changed.py").write_text("# uncommitted\n")
        self.refused_without_effects()

    def test_cache_symlink_and_hardlink_refuse(self):
        outside = self.root / "outside"
        outside.mkdir()
        cache = self.batch / "cache"
        cache.symlink_to(outside, target_is_directory=True)
        self.refused_without_effects()
        cache.unlink()
        cache.mkdir()
        (cache / ("0" * 64 + ".body")).symlink_to(outside / "missing")
        self.refused_without_effects()
        (cache / ("0" * 64 + ".body")).unlink()
        target = outside / "target"
        target.write_bytes(b"immutable")
        os.link(target, cache / ("0" * 64 + ".body"))
        self.refused_without_effects()

    def test_orphan_registry_or_checkpoint_or_cache_refuse(self):
        self.make_checkpoint()
        self.refused_without_effects()
        (self.batch / "state/checkpoint.json").unlink()
        (self.batch / "state/authorization-registry.json").write_text("{}")
        self.refused_without_effects()
        (self.batch / "state/authorization-registry.json").unlink()
        (self.batch / "cache").mkdir()
        (self.batch / "cache" / ("0" * 64 + ".body")).write_bytes(b"orphan")
        self.refused_without_effects()

    def test_bad_ledger_and_unsettled_inflight_refuse_without_resume_writes(self):
        ledger = self.initial_session()
        cp = self.batch / "state/checkpoint.json"
        reg = self.batch / "state/authorization-registry.json"
        original_cp, original_reg = cp.read_bytes(), reg.read_bytes()
        for mutation in ("broken-json", "inflight", "count", "cap", "pause", "version"):
            with self.subTest(mutation=mutation):
                value = json.loads(original_cp)
                if mutation == "broken-json":
                    cp.write_bytes(b"{broken")
                else:
                    if mutation == "inflight":
                        value["activeRequest"] = {"settled": False, "uncertain": True}
                    elif mutation == "count":
                        value["budget"]["request_count"] = -1
                    elif mutation == "cap":
                        value["budget"]["max_requests"] = 601
                    elif mutation == "pause":
                        value["pauseReason"] = "consumption-uncertain"
                    else:
                        value["schemaVersion"] = "unknown"
                    cp.write_text(json.dumps(value))
                registry = json.loads(original_reg)
                registry["checkpointSha256"] = gate.digest(cp.read_bytes())
                reg.write_text(json.dumps(registry))
                self.refused_without_effects()
        cp.write_bytes(original_cp)
        reg.write_bytes(original_reg)

    def test_registry_rollback_and_confirmation_replacement_refuse(self):
        self.initial_session()
        self.envelope["confirmation"] += " replaced"
        self.refused_without_effects()
        self.envelope["confirmation"] = "IN-MEMORY TEST FIXTURE ONLY"
        cp = self.batch / "state/checkpoint.json"
        cp.write_bytes(cp.read_bytes() + b" ")
        self.refused_without_effects()

    def test_bootstrap_contention_cannot_create_state_or_lock(self):
        fd = os.open(self.batch, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.refused_without_effects()
        finally:
            os.close(fd)
        self.assertFalse((self.batch / "state").exists())

    def test_duplicate_json_keys_refuse(self):
        path = self.root / "duplicate-fixture.json"
        path.write_text('{"schemaVersion":1,"schemaVersion":2}')
        before = self.snapshot()
        with self.assertRaises(gate.GateRejected):
            gate.read_json(path)
        self.assertEqual(before, self.snapshot())

    def test_registry_cas_refuses_replacement_during_session(self):
        with self.confirmation(), self.assertRaisesRegex(gate.GateRejected, "registry changed"):
            with gate.authorized_session(self.args, repo=self.repo):
                self.make_checkpoint()
                path = self.batch / "state/authorization-registry.json"
                registry = gate.read_json(path)
                registry["revision"] += 1
                path.write_text(json.dumps(registry))
        self.refused_without_effects()

    def test_registry_active_after_crash_and_busy_lock_refuse(self):
        with self.confirmation(), self.assertRaisesRegex(RuntimeError, "crash"):
            with gate.authorized_session(self.args, repo=self.repo):
                self.make_checkpoint()
                raise RuntimeError("crash")
        self.refused_without_effects()

    def test_existing_lock_content_unchanged_on_contention(self):
        self.initial_session()
        lock = self.batch / "state/authorization.lock"
        with lock.open("rb") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = self.snapshot()
            with self.confirmation(), self.assertRaises(gate.GateRejected):
                with gate.authorized_session(self.args, repo=self.repo):
                    self.fail("concurrent writer entered")
            self.assertEqual(before, self.snapshot())

    def test_mock_binding_through_http_cache_to_candidate_report_and_resume(self):
        transport = ScriptedTransport([
            plain_response(tocdata_payload([{"level": "2", "line": "English", "number": "3"}])),
            plain_response(text_payload(english_html())),
        ])
        with self.confirmation(), gate.authorized_session(self.args, repo=self.repo):
            ledger = self.make_checkpoint()
            adapter = HttpAdapter(transport=transport, budget=ledger.budget, clock=FakeClock(),
                                  user_agent=UA, interval_seconds=5, max_retries=2)
            Collector(ledger=ledger, adapter=adapter, cache=ResponseCache(self.batch / "cache"),
                      evidence_ledger=EvidenceLedger(), now=fixed_now()).run_batch(["read"])
            report = self.batch / "reports/candidates.json"
            candidates = cli.run_offline_reparse(cache_dir=self.batch / "cache",
                                                current_path=None, output_path=report)
            self.assertTrue(candidates)
            self.assertTrue(report.exists())
            self.assertEqual(ledger.budget.request_count, 2)
            self.assertGreater(ledger.budget.decompressed_bytes, 0)
        self.assertEqual(len(transport.calls), 2)
        self.assertIn("section=3", transport.calls[1][0])
        with self.confirmation(), gate.authorized_session(self.args, repo=self.repo):
            restored = BatchLedger.load(self.batch / "state/checkpoint.json")
            restored.resume()
            self.assertEqual(restored.budget.request_count, 2)
            self.assertEqual(restored.budget.max_requests, 600)
            self.assertEqual(restored.budget.distinct_heads_started, 1)
        self.assertEqual(gate.read_json(self.batch / "state/authorization-registry.json")["revision"], 2)

    def test_request_cap_survives_reload_and_stops_retry_and_next_head(self):
        ledger = self.make_checkpoint()
        ledger.budget.request_count = 599
        ledger.budget.requests_by_kind = {"toc": 599}
        ledger.checkpoint.request_seq = 599
        ledger.persist()
        restored = BatchLedger.load(self.batch / "state/checkpoint.json")
        restored.resume()
        transport = ScriptedTransport([plain_response(b'{"error":{"code":"maxlag"}}')])
        adapter = HttpAdapter(transport=transport, budget=restored.budget, clock=FakeClock(),
                              user_agent=UA, interval_seconds=5)
        Collector(ledger=restored, adapter=adapter, cache=ResponseCache(),
                  evidence_ledger=EvidenceLedger(), now=fixed_now()).run_batch(["read", "note"])
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(restored.budget.request_count, 600)
        self.assertNotIn("note", restored.checkpoint.words)
        self.assertEqual(restored.checkpoint.pause_reason, "request-budget-exhausted")
        with self.assertRaises(ResumeRejected):
            BatchLedger.load(self.batch / "state/checkpoint.json").resume()
        budget = RunBudget(max_requests=1)
        budget.begin_attempt(RequestKind.TOC)
        with self.assertRaises(BudgetPaused):
            budget.begin_attempt(RequestKind.MAIN)
        self.assertEqual(budget.request_count, 1)

    def test_resume_first_dispatch_waits_full_serial_interval(self):
        ledger = self.make_checkpoint()
        ledger.budget.request_count = 1
        ledger.budget.requests_by_kind = {"toc": 1}
        ledger.checkpoint.request_seq = 1
        ledger.persist()
        restored = BatchLedger.load(self.batch / "state/checkpoint.json")
        restored.resume()
        clock = FakeClock()
        transport = ScriptedTransport([plain_response(b'{"error":{"code":"missingtitle"}}')])
        adapter = HttpAdapter(transport=transport, budget=restored.budget, clock=clock,
                              user_agent=UA, interval_seconds=5)
        Collector(ledger=restored, adapter=adapter, cache=ResponseCache(),
                  evidence_ledger=EvidenceLedger(), now=fixed_now()).run_batch(["note"])
        self.assertEqual(clock.sleeps, [5])
        self.assertEqual(restored.budget.request_count, 2)

    def test_last_toc_attempt_cannot_dispatch_main(self):
        ledger = self.make_checkpoint()
        ledger.budget.request_count = 599
        ledger.budget.requests_by_kind = {"toc": 599}
        ledger.checkpoint.request_seq = 599
        transport = ScriptedTransport([
            plain_response(tocdata_payload([{"level": "2", "line": "English", "number": "3"}])),
        ])
        adapter = HttpAdapter(transport=transport, budget=ledger.budget, clock=FakeClock(),
                              user_agent=UA, interval_seconds=5)
        Collector(ledger=ledger, adapter=adapter, cache=ResponseCache(),
                  evidence_ledger=EvidenceLedger(), now=fixed_now()).run_batch(["read", "note"])
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(ledger.budget.request_count, 600)
        self.assertNotIn("note", ledger.checkpoint.words)
        self.assertEqual(ledger.checkpoint.pause_reason, "request-budget-exhausted")

    def test_run_apply_has_no_real_transport_bypass(self):
        before = self.snapshot()
        with mock.patch.object(cli, "_build_urllib_transport", side_effect=AssertionError("real transport")):
            with self.assertRaisesRegex(cli.CliError, "NO-GO"):
                cli.run_apply(None, now=fixed_now())
        self.assertEqual(before, self.snapshot())


if __name__ == "__main__":
    unittest.main()
