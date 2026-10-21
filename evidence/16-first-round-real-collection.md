# First-round real collection: consumed grant and parser blocker

## Authorization and Execution

Member confirmation `01a14e5a-0cd6-7e9e-b259-02e1a80f8fdb` and serialization/execution instruction `01a14e5b-0cfa-70d5-9151-e9dea3b9a1f2` authorized this run only. The agent serialized that actual confirmation, rather than inventing a grant. Initial read-only authorization preflight exited 0; the repository was clean at execution commit `7085cc4a97d9637d10dc40cc6a4ca801264f6965` and was pushed to `feat/pronunciation-overlay` without changing HEAD. PR #4 base remains main; no merge or publication occurred.

- Canonical binding SHA256: `64e4f05e78c965710a63e5c8c5b1223072972a31bd680563113e030e76f44fce`.
- Ordered heads SHA256: `aabdfceeda0cca922790c57fadddd13f7a50a321f35371ecbdf932cb1793b6f8` (100 distinct).
- UA: `HamsterDictionaryPronunciationCollector/0.1 (+https://github.com/HamsterNote/dictionary/issues)`.
- One foreground `timeout 3600 python3 -B dictionary/scripts/refresh_wiktionary_pronunciations.py --apply ...` ran to exit 2. The exact invocation is in the attached `reports/evidence.json`. The tool returned chunked waiting handles; they were collected in this turn until process exit. No detached execution, second apply, endpoint probe or auxiliary request was started.
- UTC checkpoint interval: `2026-10-18T09:34:52.632752+00:00` to `2026-10-18T09:44:29Z`. This was about 9 minutes 36 seconds, shorter than the full two-operation estimate because only TOC requests occurred.

## Actual Measurement

| Counter | Actual |
| --- | ---: |
| Dispatch attempts | 100 |
| TOC / MAIN / retries | 100 / 0 / 0 |
| Encoded response body bytes | 224,908 |
| ALL decoded response body bytes | 1,688,166 |
| Distinct heads started | 100 |
| Successful English MAIN responses | 0 |
| Candidate rows / no-change conclusions | 0 / 0 |
| Audit unresolved parser-schema words | 100 |
| Recorded transport word failures / unattempted heads | 0 / 0 |

Network accounting excludes headers/TLS/IP; decoded accounting includes all body kinds/errors/retries. These are durable budget totals, not estimates or synthetic fixture counters. Per-request encoded sizes and raw headers/status are not retained by this execution version; the report does not fabricate them. One hundred complete TOC bodies plus provenance metadata are cached, and their decoded length sum matches the ledger exactly. This TOC-only sample cannot estimate full-library IPA collection costs or accuracy.

## Blocker Found From Real Responses

All 100 responses contain an English section with `hLevel: 2`. `select_english_section` in `scripts/wiktionary_per_word/action_api.py` reads `level`, so every word was incorrectly sealed `no-qualified` / `no-english-section` and no MAIN request was made. The raw checkpoint is preserved, not rewritten to hide this error. The audit separately classifies every word as `unresolved-parser-schema`; none is reported as missing English, unchanged IPA or successful pronunciation coverage.

The response also distinguishes display `number` from parse selector `index`: for `as`, English has `number: "2"`, `index: "9"`. The current code uses `number`. Both fields must be checked against real cached structures when repairing task 5.2; no additional request was sent to investigate. Task 5.2 is reopened, not claimed complete on synthetic-only evidence.

The batch is durably paused at `distinct-head-budget`; `activeRequest` and `pendingCache` are null, operations empty, and registry phase is idle/revision 1. Authorization, binding and checkpoint registry hashes match. No 101st word, same-batch retry, new batch, parser repair, authority migration, formal manifest write or budget reset occurred. More collection requires a corrected frozen collector and explicit new execution/budget authorization. Groups 11 and 12 remain unauthorized.

## Stop/Resume Audit and Verification

No actual interruption or real resume occurred. This turn audited the real checkpoint and reran synthetic offline recovery exercises; fixture request counts are excluded from the actual totals.

1. Post-pause exact bound CLI `--check-authorization`: exit 2, `invalid ledger: checkpoint cannot safely resume within this binding`. Offline audit brackets this read-only check with batch file/hash/mtime snapshots: zero state/cache/input writes. An in-memory ledger made from the real checkpoint also rejects resume without modifying the real checkpoint.
2. Eight targeted tests below: exit 0. Cover 40-head/8-MiB cumulative recovery, budget/uncertainty refusal, 101st-head refusal, complete fake-HTTP CLI recovery for 403/429/503 and non-whitelisted pause refusal. CLI fixtures disable sockets and keep fake confirmation in memory.

```sh
cd dictionary/scripts
python3 -B -m unittest -v \
  test_wiktionary_per_word_ledger.ResumeTest.test_resume_40_words_8mib_continues_without_reset \
  test_wiktionary_per_word_ledger.ResumeTest.test_budget_pause_resume_is_rejected \
  test_wiktionary_per_word_ledger.ResumeTest.test_inflight_uncertain_fails_closed \
  test_wiktionary_per_word_ledger.LedgerBudgetTest.test_hundredth_allowed_but_101st_not_started \
  test_wiktionary_per_word_authorization.StrictGateTests.test_403_full_cli_resume_retries_word_then_continues_without_reset \
  test_wiktionary_per_word_authorization.StrictGateTests.test_429_exhaustion_full_cli_resume_without_reset \
  test_wiktionary_per_word_authorization.StrictGateTests.test_503_exhaustion_full_cli_resume_without_reset \
  test_wiktionary_per_word_authorization.StrictGateTests.test_nonwhitelisted_pauses_refuse_resume_without_effects
```

3. `python3 -B ham37-first-round-audit.py` from workspace: exit 0. Uses socket prohibition, strict cache integrity loading, canonical authorization hash and raw checkpoint hash checks, exact head membership, decoded-byte reconciliation, preflight refusal and unchanged-file assertions. Writes only the four authorized reports. The audit script is attached with the batch archive and ran before task/evidence edits changed repository cleanliness.
4. `python3 -B scripts/check_pronunciation_immutable_baseline.py` from dictionary: exit 0 before/after collection and within audit. All 55 src/data files, 57 full-baseline files and 19 legacy-baseline files retain exact paths/SHA256. Full baseline list SHA256 `59daef043765d67d505947b2e93e0c8f713195564a2e5db827e268aef29a9cfe`; legacy list SHA256 `5c276b787b38c094a4ccfe84b386f326091610271257ce3d1cf6cbbd32e38f14`.

## Deliverables and Task Accounting

The attached archive preserves the actual grant, heads, checkpoint/ledger, registry, execution log, 100 cached bodies/provenance records, audit script and `reports/{candidates.json,candidates.md,costs.json,evidence.json}`. The four reports are also separately attached. Each attempted head has source page/history/license, response hash and actual English TOC fields. Attribution is Wiktionary contributors, CC BY-SA 4.0; responses are verbatim, annotations are offline derived. No revid is invented for TOC responses lacking one.

10.1 is updated to this final grant. Tasks 10.2 (bounded real execution including durable stop), 10.3 (offline rehearsal plus actual checkpoint audit, no claimed real resume), and 10.4 (fixed complete failure/unresolved/cost report) are checked. These checks do not claim successful IPA coverage or resolve the reopened 5.2 defect. No candidate approval is requested for an empty report. The issue remains blocked pending parser repair and a newly authorized collection strategy; future authority migration is not started.
