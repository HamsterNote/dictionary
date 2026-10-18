# CLI service-pause recovery: final offline acceptance

The coordinator resolved both prior scope questions in comment `01a14d97-58ef-7f07-8a02-31517e89b52a`: allow only the new recoverable service pause reasons in read-only preflight; preserve uncertainty as non-resumable. This closes the implementation blockers recorded in `14-service-pause-repair.md`.

## Scope

`authorization.py` changes only its HTTP/transport service-pause reason whitelist, using the existing `RECOVERABLE_SERVICE_PAUSES`. The binding equality, confirmation provenance, registry/CAS, request/byte/head ceilings, list membership, retry cap, request sequence and active/in-flight checks remain identical. No budget or uncertainty reason is included. The previous adapter/collector/ledger pause implementation is unchanged.

`PRONUNCIATION_OVERLAY.md` now states the operational consequence: generic DNS/connection OSError or timeout preserves uncertain consumption, stops dispatch and cannot automatically resume even after the fault disappears. The operator must ask the user whether to authorize a new batch or explicitly dispose of unsettled consumption. The current implementation does neither, never clears uncertainty and never resets or deletes state to continue.

## Complete CLI Evidence

Seven new methods in `test_wiktionary_per_word_authorization.py` use `cli.main` / `run_apply`, with confirmation reads mocked only in memory, sockets disabled and fake HTTP/clock. No grant file is emitted.

| Synthetic status | First CLI requests | Resume requests | Total requests | Total encoded/decoded bytes | Heads before/after | Candidate count |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| 403 | 1 | 3 | 4 | 942 / 942 | 1 / 2 | 3 |
| 429 exhausted | 3 | 3 | 6 | 954 / 954 | 1 / 2 | 3 |
| 503 exhausted | 3 | 3 | 6 | 954 / 954 | 1 / 2 | 3 |

For each positive case the first CLI invocation exits 2 and seals an idle registry plus a settled, nonterminal PAUSED word, with no pending cache or active request. The second CLI invocation exits 0, retries the same word (word attempts becomes 2 without another head slot), finishes it EXTRACTED, then processes the next word. Previous request/retry/byte/head totals are retained and new responses are charged. Cache reparse creates a candidate report and registry revision becomes 2 with the final checkpoint digest.

The read-only resume preflight is bracketed by byte/mtime/fileset snapshots and forbidden mkdir, checkpoint persistence and atomic registry writes: zero writes and zero new transport construction. Each transport factory asserts two successful preflights (initial and locked) and an active registry before construction. On resume it also asserts the prior cumulative budget is still intact.

Negative tests refuse every existing budget/uncertainty pause and unknown/non-whitelisted reason through all entry points without file mutation or transport construction. The same allowlisted service reason cannot bypass an active or uncertain request, an in-flight word, or exhausted requests/bytes. Complete CLI generic OSError and timeout cases dispatch once, preserve PAUSED plus uncertain activeRequest, then reject resume without effects. The whitelist and existing hard-pause set are asserted disjoint.

## Verification

- `python3 -B -m unittest test_wiktionary_per_word_authorization` from scripts: 41 methods, exit 0.
- `python3 -B scripts/run_pronunciation_python_tests.py`: 313 tests, exit 0. Output includes the three synthetic CLI observations above.
- `node scripts/test_pronunciation_overlay.mjs`: exact final output and exit code delivered with the freeze verification artifact.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exit 0; src/data 55, full baseline 57, legacy baseline 19 files and SHA256 unchanged.
- `git diff --check`: exit 0 before freeze; staged and clean-tree checks are included in the freeze record.

No new task checkbox is claimed by this repair. The real 100-head list, UA/contact, calls, budgets and paths are unchanged; only executionCommit will differ in the final binding. Old first-round grants do not authorize the new version, and no new authorization is generated in this offline turn. Actual collection requests/network/decoded bytes remain 0/0/0; no real apply, checkpoint, response cache, publish, PR base change or merge occurs. The only next execution prerequisite is explicit user confirmation of the final frozen binding. Groups 11 and 12 remain independently unauthorized.
