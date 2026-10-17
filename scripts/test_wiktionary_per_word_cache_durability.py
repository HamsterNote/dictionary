"""Disk durability recovery across fresh processes; synthetic ledger/fake HTTP only."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


FIXTURE = r'''
import json
import os
from pathlib import Path
import socket
import stat
import sys
from unittest import mock

from wiktionary_per_word.collector import Collector
from wiktionary_per_word.evidence import EvidenceLedger, ResponseCache
from wiktionary_per_word.http_adapter import FakeClock, HttpAdapter
from wiktionary_per_word.ledger import BatchAuthorization, BatchLedger
from test_wiktionary_per_word_support import (
    REAL_LOOKING_UA, ScriptedTransport, english_html, fixed_now,
    plain_response, text_payload, tocdata_payload,
)

def forbidden(*args, **kwargs):
    raise AssertionError("socket forbidden in durability fixture")

socket.socket.connect = forbidden
socket.socket.connect_ex = forbidden
socket.create_connection = forbidden
root, phase = Path(sys.argv[1]), sys.argv[2]
checkpoint = root / "checkpoint.json"
if phase == "initial":
    ledger = BatchLedger.create(
        batch_id="synthetic-durability", path=checkpoint, created_at=fixed_now()(),
        authorization=BatchAuthorization(100, 20 * 1048576, True,
            "synthetic offline fixture", synthetic=True),
        allow_synthetic_authorization=True)
else:
    ledger = BatchLedger.load(checkpoint, allow_synthetic_authorization=True)
    ledger.resume()
cache = ResponseCache(root / "cache")
loaded_entries = len(cache)
responses = [
    plain_response(tocdata_payload([{"level": "2", "line": "English", "number": "3"}])),
    plain_response(text_payload(english_html())),
] if phase == "initial" else []
transport = ScriptedTransport(responses)
adapter = HttpAdapter(transport=transport, budget=ledger.budget, clock=FakeClock(),
                      user_agent=REAL_LOOKING_UA, interval_seconds=5)
cache_stat = (root / "cache").stat()
real_fsync = os.fsync
syncs = []
def fsync(fd):
    current = os.fstat(fd)
    if (stat.S_ISDIR(current.st_mode) and
            (current.st_dev, current.st_ino) == (cache_stat.st_dev, cache_stat.st_ino)):
        metadata = len(list((root / "cache").glob("*.meta.json")))
        syncs.append({"metadata": metadata,
                      "pendingMemory": ledger.checkpoint.pending_cache is not None,
                      "pendingDisk": json.loads(checkpoint.read_text())["pendingCache"] is not None})
        if metadata == 2 and phase != "recover":
            raise OSError("last metadata renamed but cache directory fsync failed")
    return real_fsync(fd)

with mock.patch("wiktionary_per_word.evidence.os.fsync", side_effect=fsync):
    report = Collector(ledger=ledger, adapter=adapter, cache=cache,
                       evidence_ledger=EvidenceLedger(), now=fixed_now()).run_batch(
                           ["read"] if phase == "recover" else ["read", "note"])
saved = BatchLedger.load(checkpoint, allow_synthetic_authorization=True)
print(json.dumps({"pid": os.getpid(), "loadedEntries": loaded_entries,
                  "syncs": syncs, "dispatches": len(transport.calls),
                  "budget": saved.budget.to_json(),
                  "status": saved.checkpoint.words["read"].status.value,
                  "attempts": saved.checkpoint.words["read"].attempts,
                  "paused": saved.checkpoint.pause_reason,
                  "pending": saved.checkpoint.pending_cache is not None,
                  "startedNote": "note" in saved.checkpoint.words,
                  "temporaryFiles": len(list((root / "cache").glob(".cache-*.tmp")))}))
'''


class CacheDurabilityProcessTests(unittest.TestCase):
    def test_last_metadata_directory_fsync_failure_survives_process_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            def run(phase):
                result = subprocess.run(
                    [sys.executable, "-B", "-c", FIXTURE, directory, phase],
                    cwd=Path(__file__).resolve().parent, check=True,
                    text=True, capture_output=True, timeout=30)
                return json.loads(result.stdout)

            first = run("initial")
            self.assertEqual(first["dispatches"], 2)
            self.assertEqual(first["loadedEntries"], 0)
            self.assertEqual(first["syncs"][-1]["metadata"], 2)
            self.assertTrue(first["pending"])
            self.assertEqual(first["status"], "paused")
            self.assertEqual(first["paused"], "cache-persist-failed")
            self.assertFalse(first["startedNote"])
            failed_resume = run("retry-fail")
            recovered = run("recover")
            self.assertEqual(len({first["pid"], failed_resume["pid"], recovered["pid"]}), 3)
            for phase in (failed_resume, recovered):
                self.assertEqual(phase["loadedEntries"], 2)
                self.assertEqual(phase["dispatches"], 0)
                self.assertEqual(phase["budget"], first["budget"])
                self.assertEqual(phase["attempts"], 1)
                self.assertFalse(phase["startedNote"])
                self.assertEqual(phase["temporaryFiles"], 0)
                self.assertTrue(phase["syncs"])
                self.assertTrue(all(s["pendingMemory"] and s["pendingDisk"] for s in phase["syncs"]))
            self.assertEqual(failed_resume["status"], "paused")
            self.assertTrue(failed_resume["pending"])
            self.assertEqual(failed_resume["paused"], "cache-persist-failed")
            # Both body/metadata files of both loaded entries must be confirmed.
            self.assertEqual(len(recovered["syncs"]), 4)
            self.assertTrue(all(s["metadata"] == 2 for s in recovered["syncs"]))
            self.assertEqual(recovered["status"], "extracted")
            self.assertIsNone(recovered["paused"])
            self.assertFalse(recovered["pending"])
            print("Cache durability process evidence: " + json.dumps({
                "distinctProcesses": 3, "initialDispatches": first["dispatches"],
                "restartDispatches": [failed_resume["dispatches"], recovered["dispatches"]],
                "recoveryCacheDirectoryFsyncs": len(recovered["syncs"]),
                "pendingRetainedDuringEveryRecoveryFsync": True,
                "failedRecoveryStatus": failed_resume["status"],
                "finalStatus": recovered["status"], "finalPending": recovered["pending"],
                "sameBudgetAcrossAllProcesses": True,
            }, sort_keys=True))


if __name__ == "__main__":
    unittest.main()
