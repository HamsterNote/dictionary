# Strict collection gate: offline implementation

2026-10-17. This supplements the historical acceptance report in `08-offline-acceptance.md`.
The implementation is now present; both real `--apply` and `run_apply` remain
unconditionally NO-GO. No actual authorization input, state, cache or requests were
created for `ham37-first-round-v1`. No tasks in groups 10-12 were checked.

## Changes

- `scripts/wiktionary_per_word/authorization.py`: exact heads-byte hash, UA,
  Action API call contract, budgets, workspace-relative whitelist and full clean
  execution HEAD binding. Strict JSON rejects duplicate keys and non-boolean
  grants. Externally supplied confirmation is read-only; no grant-writing API.
- Read-only preflight rejects missing/mismatched authorization, unsafe paths,
  symlinks/hardlinks, orphan state/cache, invalid ledger, unknown versions, paused
  state and any unsettled in-flight before mkdir/registry/checkpoint writes.
- Bootstrap flock on the existing batch directory and persistent
  `state/authorization.lock`; lock contention performs no file writes. A second
  preflight runs under lock. `state/authorization-registry.json` binds contract,
  authorization and checkpoint digests, checks CAS, increments revision and uses
  fsynced atomic replacement. Write-ahead `active` state survives crashes and
  refuses further dispatch instead of resetting counters.
- `http_adapter.py`, `ledger.py`: explicit whole-batch request cap persisted in
  authorization and budget, checked before dispatch/retry/new head, enforced
  across reload. A fresh adapter over consumed state waits a complete serial
  interval before its first dispatch. All response-body byte accounting remains
  shared across TOC/MAIN/errors/retries.
- CLI adds `--budget-requests`, `--workspace-root`, `--batch-root`,
  `--execution-commit`, `--describe-binding`, `--check-authorization`. The last two
  only read/print. Direct `run_apply` no longer constructs a transport. The
  independent NO-GO guard was retained, not conditionally bypassed.
- Tests and tool documentation updated. Older 40 heads / 8 MiB resume coverage
  now exercises the injectable collector directly, preserving its original
  assertions while closing the real-runner bypass.

## Verification

| Command | Exit | Evidence |
| --- | --- | --- |
| `python3 -B scripts/run_pronunciation_python_tests.py` | 0 | 278 tests, final source; socket connect/connect_ex/create_connection disabled |
| `node scripts/test_pronunciation_overlay.mjs` | 0 | All 7 Node assert/SSR entries and Python suite; 19-file hash check before/after. This completed at 277 tests, before the final unavailable-flock negative case; the subsequent Python run above covers 278. |
| `python3 -B scripts/check_pronunciation_immutable_baseline.py` | 0 | Exact src/data file set: 55; all 57 full-baseline hashes plus all 19 original baseline hashes unchanged |
| `git diff --check` | 0 | No whitespace errors |

`logs/ham37-strict-gate.log` and `ham37-strict-gate-results.json` record results.
Node 24.15.0; Python 3.14.4. Python 3.12 is not installed here and was not tested.
No frontend code changed; previous build/browser evidence remains in report 08.

The 22 new authorization tests include multiple subcases. Rejection tests compare
file/directory sets, bytes and mtimes, forbid mkdir/registry writes, forbid real
transport construction, and disable sockets. They cover missing grants, exact
binding mismatches, synthetic UA, cap/path/version changes, duplicates/101 heads,
dirty code, symlinks/hardlinks, orphan/corrupt state, unsettled requests, changed
confirmation, checkpoint rollback, crash-active registry and competing locks.
The successful path mocks confirmation reads **only in memory**, then uses fake
HTTP to resolve dynamic English section 3, cache complete responses, generate a
candidate JSON report and resume without clearing consumption. No actual
`inputs/authorization.json` is written. Additional tests stop MAIN after the last
allowed TOC, stop retries/new heads at 600, and enforce the resume interval.

## Immutable baseline

`collection-immutable-baseline.tsv` is copied from the already frozen proposal-v1
baseline, not recomputed from changed data. It contains all 55 src/data files and
two scripts/data files. The original 19-file baseline is preserved byte-for-byte.

- Full-baseline SHA256: `59daef043765d67d505947b2e93e0c8f713195564a2e5db827e268aef29a9cfe`.
- Original-baseline SHA256: `5c276b787b38c094a4ccfe84b386f326091610271257ce3d1cf6cbbd32e38f14`.
- No formal manifests, v1/v2 corrections, legacy generators or dump products changed.

## Remaining authorization boundary

This report grants nothing. The actual user has not confirmed the exact final
binding or the public Issues contact URL. The confirmation JSON is an external
record, not a cryptographic identity proof; its origin must be established by the
operator. Cooperating processes use POSIX flock; no unlocked fallback exists.
The local filesystem owner is outside the trust boundary and can alter files.

The final commit and complete proposed binding are delivered outside this commit
as issue attachments, avoiding a self-referential commit hash. This commit is an
offline implementation/review version, **not a runnable collection version**:
retaining the requested unconditional guard means user confirmation alone cannot
start it. Any later code activation requires a new execution commit and re-bound
confirmation. Groups 10-12 and publication authorization remain independent.
