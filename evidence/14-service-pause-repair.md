# Service pause repair and remaining execution blockers

The prior authorization/non-execution records were committed first as `b2163b4`; its working tree was clean before this repair. This change does not issue requests, produce a new user grant, change binding fields, modify budget arithmetic or edit the authorization gate.

## Implemented behavior

- HTTP 403/407/451: read/account the bounded error response once, then persist a nonterminal PAUSED word with `http-<status>`; no later head dispatch.
- HTTP 429 and all 5xx: retain the existing per-operation retry quota/backoff; after exhaustion, persist `http-<status>-retries-exhausted` and PAUSED, never FAILED.
- Proven known-zero transport retry exhaustion: pause nonterminal with `transport-known-zero-exhausted`. This explicit existing evidence type retains bounded retries; generic OSError is not relabeled known-zero.
- Generic transport/OSError/timeout or uncertain body read: preserve known bytes and uncertain activeRequest, persist PAUSED and stop. Consumption uncertainty remains non-resumable under the original contract.
- HTTP 400/404/410/414: finish only that word FAILED and continue. Missing-title API responses retain MISSING behavior.
- BatchLedger.resume clears only the new recoverable service pause reasons, after its existing request-cap/in-flight checks. Persist failure restores the in-memory pause. Counts, operation records and old attempts remain; a resumed word gets a new charged word attempt, not another distinct-head slot. Budget/uncertainty pauses remain blocked.
- A budget, decoding or journal pause while reading a denial response takes precedence and preserves the nonterminal word; no partial body is admitted as a source.

The small ledger resume change is necessary to restore service-paused words; it does not alter any ceiling or consumption accounting. Authorization and transport construction checks are untouched.

## Regression evidence

`python3 -B -m unittest test_wiktionary_per_word_service_pause` (from scripts): 12 methods, exit 0. Cases include 403/407/451, exhausted 429/500/502/503/504/599, explicit known-zero failure, generic DNS/refusal/timeout/OSError, partial read timeout, title errors, a MAIN denial after successful TOC, cap dominance, pending/in-flight consistency and resume persistence failure. Sockets are disabled in every method.

Disk-checkpoint tests prove completed error responses leave no active request/pending cache; after reload and explicit ledger resume the same head is retried, old head/request/retry/byte counts are retained and new responses charged. Uncertain failures retain an uncertain settled request record and cannot resume. These are synthetic observations, not real collection or a successful CLI resume.

Final required commands and exit codes are delivered with this record:

- `python3 -B scripts/run_pronunciation_python_tests.py`: 306 tests, exit 0.
- `node scripts/test_pronunciation_overlay.mjs`: all 7 Node entries and its Python child; result is in the attached freeze verification (do not infer a pass solely from this document).
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exit 0; src/data 55, full baseline 57 and legacy 19 files/sha256 unchanged.
- `git diff --check`: exit 0 before freeze.

The initial full checks failed because node_modules/vite was absent. `yarn install --offline --frozen-lockfile --ignore-scripts --non-interactive` restored dependencies from the local cache, exit 0; yarn.lock SHA256 remains `49538e0ac4d278a05391c28382702289fda752e134860bdd49105a8643b8ec8c`. No online install was used.

## Explicit remaining blockers (not ready for 10.2)

1. `authorization.py:260` permits only null/cache-persist-failed pause reasons. A socket-disabled actual run_apply fixture with confirmation mocked only in memory proves the first 403 now pauses correctly (one dispatch), but a second session is rejected before transport construction: `NO-GO: invalid ledger: checkpoint cannot safely resume within this binding`. The rejection changes no files. The trigger explicitly says not to change the authorization gate; adding only the settled service-pause reasons to this whitelist requires clarification of that scope. A concrete unapplied diff and full reproduction command/output are attached to the issue.
2. The trigger asks OSError/timeout recovery, while the preexisting contract and the unchanged gate forbid resuming uncertain consumption. Generic OSError/timeouts cannot be proven zero consumption. The implementation preserves fail closed; allowing uncertain consumption to resume would require an explicit settlement contract, not silently clearing counters or in-flight evidence. A clarification is pending.

The frozen repair is an offline review artifact, not permission or readiness to run. The former execution grant for 777b2454 does not match the new commit and has not been changed or replaced. Real collector requests/network bytes/decoded bytes remain 0/0/0, and no real apply is invoked. Task 10.1 records the historical initial confirmation; a valid new-version confirmation is still required before execution. Tasks 10.2-10.4 and groups 11-12 remain incomplete. No formal data or manifest is changed, no release or merge is performed, and no PR base is changed.
