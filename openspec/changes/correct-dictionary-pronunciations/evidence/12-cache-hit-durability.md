# Cache-hit durability after restart

2026-10-17. Addresses the remaining major in review comment
`01a14a79-4066-7b1a-8f88-fcdb580336c5` against execution version `724f9b27`.
That freeze and its binding are superseded. No actual authorization, production
apply or real Wiktionary request was made. Tasks 10-12 remain unchecked.

## Fix

Disk-backed `ResponseCache.put` now calls idempotent `_persist(existing)` even
when the entry is already indexed, including entries loaded after process restart.
Existing files must match exactly, receive a directory fsync and pass read-back
before put returns. Missing files use the existing temporary-file + file fsync +
rename + directory fsync + read-back protocol. No immutable identical file needs
rewriting merely to finish the previous directory sync. A failed sync/verification
propagates to the collector's existing durable cache pause. Pending bytes are
cleared and the word sealed only after every put succeeds.

No collector/gate weakening, recovery bypass or grant creation was added. Memory
cache behavior and read-only preflight remain unchanged. Disk hits are more
expensive because they deliberately acknowledge persistence on every put.

## Regression evidence

`CacheDurabilityProcessTests.test_last_metadata_directory_fsync_failure_survives_process_restart`
starts three distinct Python processes against one temporary on-disk synthetic
checkpoint/cache. Every process disables socket connection APIs and uses fake
HTTP; no authorization.json exists and no collection CLI apply is invoked.

1. Initial process: fake TOC and MAIN consume two attempts. The final metadata
   rename succeeds; only its following cache-directory fsync raises OSError.
   Both body/metadata pairs exist on disk. The word pauses, pending responses
   are persisted, the next head is not started, and temporary files are absent.
2. Restart with failure retained: a fresh ResponseCache loads both entries.
   Its first existing-hit directory sync raises again. Pending remains, the
   word remains paused, zero dispatch occurs and all budgets are unchanged.
3. Restart without failure: a fresh ResponseCache again loads both entries.
   Recovery performs four cache-directory fsync calls (body/metadata for TOC
   and MAIN). Before every call the test verifies both memory and disk pending
   are still present. Only after all writes/syncs/checks return does the word
   become extracted and pending clear. Zero HTTP is dispatched, all budgets
   remain equal to the first process, and word attempts remains one.

Observed summary is also printed into the full-suite log:

```json
{"distinctProcesses":3,"initialDispatches":2,"restartDispatches":[0,0],"recoveryCacheDirectoryFsyncs":4,"pendingRetainedDuringEveryRecoveryFsync":true,"failedRecoveryStatus":"paused","finalStatus":"extracted","finalPending":false,"sameBudgetAcrossAllProcesses":true}
```

`CacheTest.test_existing_disk_hit_must_confirm_persistence` covers both a live
cache hit and a reloaded hit: _persist errors propagate; damaged on-disk bodies
are rejected even when memory still contains the correct body; valid retries pass.

`StrictGateTests.test_leftover_cache_temporary_file_refuses_without_cleanup`
starts from an idle sealed fixture registry, adds a leftover cache temporary
file and exercises session/direct runner/CLI rejection. It asserts no transport,
no mkdir/registry mutation and identical file set/bytes/mtime, including the
temporary file. There is no implicit cleanup followed by collection.

## Temporary-file contract and trust boundary

The canonical `.cache-` prefix covers transient writer files inside an authorized
session. It does not grant entry with leftover `.cache-*.tmp` files: the existing
cache scan accepts only permanent 64hex body/meta names. Handled failures remove
temporary files; leftovers after interruption cause a zero-write refusal. There
is no automatic cleanup command or bypass. Safe cache-pause recovery requires no
leftovers, intact permanent files, valid settled pending bytes, an idle sealed
registry and remaining budgets. An active/interrupted registry still refuses;
removing a leftover cannot authorize resetting it or its consumption.

Advisory flock only coordinates cooperating writers. External concurrent changes
to code/HEAD/authorization/checkpoint are prohibited; HEAD and authorization are
rechecked on session exit. Mid-run revocation is not supported. Unsigned source
markers do not authenticate a user, and local CAS cannot prevent owner rollback
of registry and checkpoint together. These boundaries are unchanged.

## Required checks

All four commands exited 0; full captured output and structured results are in
`logs/ham37-cache-fsync.log` and `ham37-cache-fsync-results.json`:

- `python3 -B scripts/run_pronunciation_python_tests.py`: 294 tests, including
  34 gate methods plus the real process-restart durability regression; sockets disabled.
- `node scripts/test_pronunciation_overlay.mjs`: seven Node entries and Python
  suite passed under network guard; original 19 baseline hashes unchanged.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exact 55-file
  src/data set, full 57-file baseline and legacy 19-file SHA256 baseline unchanged.
- `git diff --check`: clean.

Python 3.14.4 and Node 24.15.0 tested; Python 3.12 is not installed. This is actual
filesystem and separate-process testing with injected fsync failure, not a power
loss experiment. No claim is made about an untested filesystem's hardware behavior.
New execution SHA and exact describe output are delivered after commit as external
attachments; code is frozen thereafter. Directed review, Issues contact monitoring
confirmation and explicit user authorization remain outstanding before 10.2.
