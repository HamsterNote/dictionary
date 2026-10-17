"""Synthetic confirmation exists only in memory; sockets disabled in every test.

No inputs/authorization.json or actual granted permission is generated. The mocked
reader represents a future user confirmation and cannot be selected by CLI flags.
"""
from contextlib import contextmanager
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
import fcntl
import json
import io
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

    def argv(self):
        result = ["--apply"]
        for key, value in vars(self.args).items():
            if key in {"apply", "offline_reparse", "describe_binding", "check_authorization"}:
                continue
            if value is not None:
                result.extend(["--" + key.replace("_", "-"), str(value)])
        return result

    def assert_rejected_entries(self):
        with self.assertRaises(gate.GateRejected):
            with gate.authorized_session(self.args, repo=self.repo):
                self.fail("rejected contract entered session")
        with self.assertRaises(cli.CliError):
            cli.run_apply(self.args, now=fixed_now())
        with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
            self.assertNotEqual(cli.main(self.argv()), 0)

    def refused_without_effects(self, *, confirmed=True):
        before = self.snapshot()
        # Check filesystem mutators as well as the resulting bytes/file set.
        with mock.patch.object(cli, "_build_urllib_transport", side_effect=AssertionError("transport built")), \
             mock.patch.object(cli, "_repository_root", return_value=self.repo), \
             mock.patch.object(Path, "mkdir", side_effect=AssertionError("mkdir on rejection")), \
             mock.patch.object(gate, "_atomic_json", side_effect=AssertionError("registry write on rejection")):
            if confirmed:
                with self.confirmation():
                    self.assert_rejected_entries()
            else:
                self.assert_rejected_entries()
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

    def test_git_environment_cannot_redirect_head_clean_or_binding(self):
        other = self.root / "other"
        subprocess.run(["git", "init", "-q", str(other)], check=True)
        subprocess.run(["git", "-C", str(other), "-c", "user.name=OfflineFixture",
                        "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty",
                        "-m", "different offline fixture"], check=True)
        other_commit = gate._git(other, "rev-parse", "HEAD")
        self.assertNotEqual(other_commit, self.commit)
        polluted = {
            "GIT_DIR": str(other / ".git"), "GIT_WORK_TREE": str(other),
            "GIT_INDEX_FILE": str(other / ".git/index"), "GIT_COMMON_DIR": str(other / ".git"),
            "GIT_OBJECT_DIRECTORY": str(other / ".git/objects"),
            "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(other / ".git/objects"),
            "GIT_NAMESPACE": "other", "GIT_CONFIG": str(other / ".git/config"),
            "GIT_CONFIG_GLOBAL": str(other / ".git/config"),
            "GIT_CONFIG_SYSTEM": str(other / ".git/config"),
            "GIT_CONFIG_NOSYSTEM": "0", "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.worktree", "GIT_CONFIG_VALUE_0": str(other),
            "GIT_CONFIG_PARAMETERS": "'core.worktree=" + str(other) + "'",
            "GIT_CEILING_DIRECTORIES": str(self.root), "GIT_IMPLICIT_WORK_TREE": "0",
        }
        before = self.snapshot()
        with mock.patch.dict(os.environ, polluted):
            self.assertEqual(gate._git(self.repo, "rev-parse", "HEAD"), self.commit)
            self.assertEqual(gate._git(self.repo, "status", "--porcelain"), "")
            self.assertEqual(gate.build_binding(self.args, repo=self.repo), self.binding)
            self.args.execution_commit = other_commit
            self.refused_without_effects()
            self.args.execution_commit = self.commit
        self.assertEqual(before, self.snapshot())
        (self.repo / "dirty.py").write_text("# actual dirty checkout\n")
        with mock.patch.dict(os.environ, polluted):
            self.assertIn("dirty.py", gate._git(self.repo, "status", "--porcelain"))
            self.refused_without_effects()

    def test_git_validation_supports_explicit_linked_checkout(self):
        linked = self.root / "linked"
        subprocess.run(["git", "-C", str(self.repo), "worktree", "add", "--detach", "-q",
                        str(linked)], check=True)
        self.assertTrue((linked / ".git").is_file())
        self.assertEqual(gate._git(linked, "rev-parse", "HEAD"), self.commit)
        (linked / "dirty.py").write_text("# linked checkout dirty\n")
        self.assertIn("dirty.py", gate._git(linked, "status", "--porcelain"))

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
            plain_response(b'{"error":{"code":"missingtitle"}}'),
        ])
        with self.confirmation(), \
             mock.patch.object(cli, "_repository_root", return_value=self.repo), \
             mock.patch.object(cli, "_build_urllib_transport", return_value=transport) as factory, \
             mock.patch.object(cli, "HttpAdapter", side_effect=lambda **kw: HttpAdapter(clock=FakeClock(), **kw)):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(cli.main(self.argv()), 0)
            first = json.loads(output.getvalue())
            self.assertEqual(first["budget"]["request_count"], 3)
            factory.assert_called_once_with(timeout=30)
            report = self.batch / "reports/candidates.json"
            self.assertTrue(json.loads(report.read_text())["candidates"])
            self.assertTrue(report.exists())
            self.assertGreater(first["budget"]["decompressed_bytes"], 0)
            second = cli.run_apply(self.args, now=fixed_now())
            self.assertEqual(first["budget"], second["budget"])
            self.assertEqual(second["processed"], [])
        self.assertEqual(len(transport.calls), 3)
        self.assertIn("section=3", transport.calls[1][0])
        restored = BatchLedger.load(self.batch / "state/checkpoint.json")
        self.assertEqual(restored.budget.request_count, 3)
        self.assertEqual(restored.budget.max_requests, 600)
        self.assertEqual(restored.budget.distinct_heads_started, 2)
        self.assertEqual(gate.read_json(self.batch / "state/authorization-registry.json")["revision"], 2)
        self.assertEqual(len((self.batch / "execution.log").read_text().splitlines()), 2)

    def test_damaged_cache_refuses_before_registry_or_transport(self):
        self.test_mock_binding_through_http_cache_to_candidate_report_and_resume()
        body = next((self.batch / "cache").glob("*.body"))
        body.write_bytes(b"damaged")
        self.refused_without_effects()

    def test_cache_failure_pauses_and_recovers_evidence_without_refetch(self):
        transport = ScriptedTransport([
            plain_response(tocdata_payload([{"level": "2", "line": "English", "number": "3"}])),
            plain_response(text_payload(english_html())),
            plain_response(b'{"error":{"code":"missingtitle"}}'),
        ])
        with self.confirmation(), \
             mock.patch.object(cli, "_repository_root", return_value=self.repo), \
             mock.patch.object(cli, "_build_urllib_transport", return_value=transport), \
             mock.patch.object(cli, "HttpAdapter", side_effect=lambda **kw: HttpAdapter(clock=FakeClock(), **kw)):
            with mock.patch.object(ResponseCache, "put", side_effect=OSError("disk full")) as put, \
                 mock.patch.object(cli, "run_offline_reparse", side_effect=AssertionError("missing evidence report")):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(cli.main(self.argv()), 2)
                self.assertEqual(put.call_count, 1)
            self.assertEqual(len(transport.calls), 2)
            checkpoint = self.batch / "state/checkpoint.json"
            saved = BatchLedger.load(checkpoint)
            budget = saved.budget.to_json()
            self.assertEqual(saved.checkpoint.words["read"].status, WordStatus.PAUSED)
            self.assertNotIn("note", saved.checkpoint.words)
            self.assertIsNone(saved.checkpoint.active_request)
            self.assertEqual(saved.checkpoint.pause_reason, "cache-persist-failed")
            self.assertFalse((self.batch / "reports/candidates.json").exists())
            self.assertEqual(gate.read_json(self.batch / "state/authorization-registry.json")["phase"], "idle")
            # Repeated failure retries persistence, never a dispatch or a skipped word.
            with mock.patch.object(ResponseCache, "put", side_effect=OSError("still full")) as put:
                again = cli.run_apply(self.args, now=fixed_now())
                self.assertEqual(again["budget"], budget)
                self.assertIsNone(again["candidateCount"])
                self.assertEqual(put.call_count, 1)
            self.assertEqual(len(transport.calls), 2)
            real_put = ResponseCache.put
            retried = []
            def record_put(cache, body, **kwargs):
                retried.append((body, kwargs))
                if len(retried) <= 2:
                    self.assertEqual(len(transport.calls), 2)
                    self.assertEqual(BatchLedger.load(checkpoint).budget.to_json(), budget)
                return real_put(cache, body, **kwargs)
            with mock.patch.object(ResponseCache, "put", record_put):
                recovered = cli.run_apply(self.args, now=fixed_now())
            self.assertEqual(len(retried), 3)
            self.assertEqual(len(transport.calls), 3)
            self.assertGreater(recovered["candidateCount"], 0)
            final = BatchLedger.load(checkpoint)
            self.assertEqual(final.checkpoint.words["read"].status, WordStatus.EXTRACTED)
            self.assertEqual(final.checkpoint.words["read"].attempts, 1)
            self.assertIsNone(final.checkpoint.pending_cache)
            self.assertIsNone(final.checkpoint.pause_reason)
            self.assertEqual(final.budget.request_count, 3)
            self.assertEqual(final.budget.distinct_heads_started, 2)
            self.assertEqual(cli.run_apply(self.args, now=fixed_now())["budget"], recovered["budget"])

    def test_damaged_pending_evidence_refuses_without_effects(self):
        # A cache pause without complete, verifiable response bytes is not resumable.
        self.initial_session()
        cp = self.batch / "state/checkpoint.json"
        reg = self.batch / "state/authorization-registry.json"
        payload = json.loads(cp.read_text())
        payload["pauseReason"] = "cache-persist-failed"
        for pending in (None, {}, {"responses": []}):
            payload["pendingCache"] = pending
            cp.write_text(json.dumps(payload))
            registry = json.loads(reg.read_text())
            registry["checkpointSha256"] = gate.digest(cp.read_bytes())
            reg.write_text(json.dumps(registry))
            self.refused_without_effects()

    def test_partial_cache_commit_recovers_with_api_retries(self):
        transport = ScriptedTransport([
            plain_response(b'{"error":{"code":"maxlag"}}'),
            plain_response(tocdata_payload([{"level": "2", "line": "English", "number": "3"}])),
            plain_response(text_payload(english_html())),
            plain_response(b'{"error":{"code":"missingtitle"}}'),
        ])
        real_replace = os.replace
        committed_metadata = []
        def fail_second_metadata(source, target):
            if str(target).endswith(".meta.json"):
                if committed_metadata:
                    raise OSError("metadata volume failure")
                committed_metadata.append(str(target))
            return real_replace(source, target)
        with self.confirmation(), \
             mock.patch.object(cli, "_repository_root", return_value=self.repo), \
             mock.patch.object(cli, "_build_urllib_transport", return_value=transport), \
             mock.patch.object(cli, "HttpAdapter", side_effect=lambda **kw: HttpAdapter(clock=FakeClock(), **kw)):
            with mock.patch("wiktionary_per_word.evidence.os.replace", side_effect=fail_second_metadata):
                first = cli.run_apply(self.args, now=fixed_now())
            self.assertEqual(first["pausedReason"], "cache-persist-failed")
            self.assertEqual(first["budget"]["request_count"], 3)
            self.assertEqual(len(transport.calls), 3)
            self.assertEqual(len(ResponseCache(self.batch / "cache", read_only=True)), 1)
            self.assertEqual(list((self.batch / "cache").glob(".cache-*.tmp")), [])
            saved = BatchLedger.load(self.batch / "state/checkpoint.json")
            self.assertEqual(len(saved.checkpoint.pending_cache["responses"]), 3)
            cp, reg = self.batch / "state/checkpoint.json", self.batch / "state/authorization-registry.json"
            cp_bytes, reg_bytes = cp.read_bytes(), reg.read_bytes()
            for corruption in ("body", "sha256", "terminal", "inflight"):
                with self.subTest(corruption=corruption):
                    payload = json.loads(cp_bytes)
                    if corruption in ("body", "sha256"):
                        payload["pendingCache"]["responses"][0][corruption] = "corrupted"
                    elif corruption == "terminal":
                        payload["words"]["read"]["status"] = "extracted"
                    else:
                        payload["activeRequest"] = {"unsettled": True}
                    cp.write_text(json.dumps(payload))
                    registry = json.loads(reg_bytes)
                    registry["checkpointSha256"] = gate.digest(cp.read_bytes())
                    reg.write_text(json.dumps(registry))
                    self.refused_without_effects()
            cp.write_bytes(cp_bytes)
            reg.write_bytes(reg_bytes)
            recovered = cli.run_apply(self.args, now=fixed_now())
            self.assertIsNone(recovered["pausedReason"])
            self.assertGreater(recovered["candidateCount"], 0)
            self.assertEqual(recovered["budget"]["request_count"], 4)
            self.assertEqual(recovered["budget"]["retry_count"], 1)
            self.assertEqual(len(transport.calls), 4)
            self.assertEqual(len(ResponseCache(self.batch / "cache", read_only=True)), 4)

    def test_changed_heads_during_run_cannot_dispatch_unapproved_head(self):
        transport = ScriptedTransport([
            plain_response(b'{"error":{"code":"missingtitle"}}'),
            plain_response(b'{"error":{"code":"missingtitle"}}'),
        ])
        def factory(**kwargs):
            (self.batch / "inputs/heads.txt").write_text("unapproved\n")
            return transport
        with self.confirmation(), \
             mock.patch.object(cli, "_repository_root", return_value=self.repo), \
             mock.patch.object(cli, "_build_urllib_transport", side_effect=factory), \
             mock.patch.object(cli, "HttpAdapter", side_effect=lambda **kw: HttpAdapter(clock=FakeClock(), **kw)):
            with self.assertRaises(cli.CliError):
                cli.run_apply(self.args, now=fixed_now())
        self.assertEqual(len(transport.calls), 2)
        self.assertTrue(all("unapproved" not in url for url, _ in transport.calls))
        self.assertEqual(gate.read_json(self.batch / "state/authorization-registry.json")["phase"], "active")
        self.refused_without_effects()

    def test_agent_sourced_confirmation_refuses_all_entries(self):
        self.envelope["source"] = "agent-generated"
        self.refused_without_effects()

    def test_conflicting_read_only_and_apply_modes_refuse_before_gate(self):
        before = self.snapshot()
        with mock.patch.object(cli, "_build_urllib_transport", side_effect=AssertionError("transport built")):
            for flag in ("--describe-binding", "--check-authorization", "--offline-reparse"):
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as rejected:
                    cli.main(self.argv() + [flag])
                self.assertEqual(rejected.exception.code, 2)
        self.assertEqual(before, self.snapshot())

    def test_read_only_cache_cannot_be_used_as_write_bypass(self):
        self.test_mock_binding_through_http_cache_to_candidate_report_and_resume()
        before = self.snapshot()
        cache = ResponseCache(self.batch / "cache", read_only=True)
        with self.assertRaises(RuntimeError):
            cache.put(b"unexpected", content_type="text/html", complete=True,
                      source_url="https://en.wiktionary.org/wiki/read", fetched_at=fixed_now()())
        self.assertEqual(before, self.snapshot())

    def test_prevalidated_binding_cannot_be_passed_as_execution_config(self):
        before = self.snapshot()
        with mock.patch.object(cli, "_build_urllib_transport", side_effect=AssertionError("real transport")):
            with self.assertRaisesRegex(cli.CliError, "NO-GO"):
                cli.run_apply({"binding": self.binding, "granted": True}, now=fixed_now())
        self.assertEqual(before, self.snapshot())

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
