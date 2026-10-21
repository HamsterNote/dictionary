# Offline real-TOC repair and second-batch preparation

## Scope and Approval

Coordinator instruction `01a14e6c-4d44-7225-8648-02f8d65132f0` authorizes offline parser repair, real-cache replay, incorporation of the product-manager planning proposal and a new freeze. It does not grant second-batch collection, authority migration implementation or publication. No real collector request, authorization file creation, or real apply invocation occurred in this repair turn. Existing tests exercise fake CLI paths with sockets disabled.

## Repair

`action_api.select_english_section` now selects the exact `English` title and integer `hLevel == 2`, returning `index`, not display `number`. `tocLevel` is a relative nesting level and is not used as hLevel. Missing/malformed line/hLevel, bad indices, missing sections or duplicate English roots fail structurally instead of silently becoming no-English. Synthetic fixtures now use actual `tocLevel`/`hLevel`/`index` fields. The in-memory PageFetch field is renamed `english_section_index`; offline TOC fingerprints use the same selector.

The adjacent MAIN assumption was also corrected: reading `parse.revid` requires requesting `prop=text|revid` explicitly. The URL builder and canonical calls now agree; a missing/nonpositive/noninteger revision is not a successful fetch. The existing JSON `parse.text["*"]` format remains supported; no formatversion switch or additional operation is introduced. Binding equality, budget, registry, uncertain-consumption and pause checks are unchanged. Extractor version is incremented to `wiktionary-per-word/extractor/2`, so the old checkpoint cannot be upgraded/reset to continue.

Seven new regression methods cover actual `as` schema, index versus number, tocLevel versus hLevel, malformed/legacy schema refusal, exact language heading, ambiguous English roots, complete fake TOC-to-MAIN parameter selection/revision validation, and the binding-to-URL parameter agreement. Existing fake HTTP/collector/CLI/persistence/operation-retry fixtures were mechanically updated to the real TOC field names; they are not a compatibility fallback in production.

## All 100 Real Cached TOCs

```sh
python3 -B dictionary/scripts/audit_wiktionary_toc_cache.py \
  --cache-dir ham37-first-round-v1/cache \
  --heads-file ham37-first-round-v1/inputs/heads.txt \
  --output ham37-second-round-freeze/toc-sections.json
```

Exit 0: 100/100 English sections resolved, 35 display numbers differ from indices, dispatches 0, new requests 0, revisionAvailableCount 0, sourceBatchUnchanged true. This command disables socket connection APIs and patches adapter fetch to fail on any call, then asserts it was never called. Cache loading verifies complete body hashes/provenance/license. Original batch files, including checkpoint/authorization/reports, are checked by SHA256 and mtime before/after; none is changed.

| Head | Title | hLevel | Display number | MAIN section index |
| --- | --- | ---: | --- | --- |
| note | English | 2 | 1 | 1 |
| read | English | 2 | 1 | 1 |
| in | English | 2 | 2 | 5 |
| as | English | 2 | 2 | 9 |

The full attached JSON lists exact per-word title/index, cached source/hash/time/license and projected MAIN parameters (`parse`, exact page, selected section, `text|revid`, JSON, redirects=1). These are cached-view parameters for review; fresh authorized TOC may select a different current index. The report is not a dispatch list or grant.

Correction to the coordinator's handoff: the existing TOCs do not contain revision IDs. They have complete licensed provenance and response hashes, with source/history attribution derivable from the head; no revision is invented. This turn cannot produce IPA observations from TOC alone.

## Second-Batch Decision and Proposed Limits

The old cache is reusable as offline evidence, not as a live MAIN-only seed. The existing CLI/contract supports TOC then MAIN, with no imported-TOC mode. Against a live title, an old index without a bound revision can point at changed content. Implementing a new cache-seeded protocol would need additional input hashes, oldid/index semantics and gate tests; this repair does not add a bypass.

The proposed independent root is `ham37-second-round-v1`, containing only a byte-identical copy of `inputs/heads.txt`. No old state/cache, no authorization JSON, and no state/cache/output files are created there. Original `ham37-first-round-v1` remains consumed/paused, with all prior counts preserved. A future explicit new grant must bind the new execution commit, paths, revised MAIN call and proposed budget. The gate's historical logical `batchId` label remains `first-round`; independent identity is the complete canonical binding including isolated batch paths and registry. No old grant matches this new binding.

- Same 100 exact heads and ordering: SHA256 `aabdfceeda0cca922790c57fadddd13f7a50a321f35371ecbdf932cb1793b6f8`.
- Same UA/contact: `HamsterDictionaryPronunciationCollector/0.1 (+https://github.com/HamsterNote/dictionary/issues)`.
- Sole endpoint `https://en.wiktionary.org/w/api.php`; fresh TOC parse/tocdata, then English hLevel=2 `index` parse/text|revid. No auxiliary requests or HTTP redirects.
- Normally at most 200 requests (100 TOC + 100 MAIN), hard cap 600 attempts across all resumes; 100 distinct heads, 20,971,520 ALL decoded body bytes. These are proposed new limits, not reuse of remaining old quotas.
- Serial 5-second interval, timeout 30 seconds, two shared retries per operation, backoff 5/10 seconds, Retry-After respected. Existing settled-service-pause recovery and uncertain-consumption refusal remain unchanged; uncertainty still requires manual disposition, never automatic counter reset.
- At 200 dispatches, intervals alone require at least 995 seconds (16m35s). About 19-25 minutes is a planning estimate based on first-batch TOC latency; MAIN latency/bytes remain unmeasured, so this is not a guaranteed completion window. Retries/Retry-After can extend it; limits or rejection can stop earlier.
- First-batch TOC decoded bytes were 1,688,166. MAIN was never fetched, so neither total decoded/network bytes nor a 50% saving can honestly be predicted. ALL decoded bytes cap at 20 MiB; encoded network bytes are measured separately and have no independent encoded-byte cap in the binding.
- Prospective writes remain the new root's `state/{checkpoint.json,authorization-registry.json,authorization.lock}`, content-addressed `cache/`, `execution.log`, four reports, and the already-defined atomic temporary prefixes. The actual authorization input must come from a later specific user confirmation. No src/data/manifest/publish writes are authorized.

The final exact `--describe-binding` stdout, canonical SHA256 and invocation are delivered as freeze attachments after committing; this document does not embed its own commit hash. No code or tracked document is changed after that freeze.

## Planning Merge

Imported product-manager patch attachment `01a14e44-ece0-7476-8caf-5977527dd529`, based on 7085cc4a, after direction confirmation `01a14e5a-0cd6-7e9e-b259-02e1a80f8fdb`. Four planning files applied directly. tasks.md was reconciled manually to preserve the actual 10.x evidence and reopened/fixed 5.2, add the revised 11/12 descriptions and eight unchecked group-13 tasks. Proposal/design status text now distinguishes approved direction, consumed old grant and pending second-batch/migration operations. No system authority file, legacy JSON or overlay data was changed.

## Verification

- `python3 -B scripts/run_pronunciation_python_tests.py`: 320 tests, exit 0; socket connections forbidden by runner.
- `node scripts/test_pronunciation_overlay.mjs`: all seven Node entries plus Python child exit 0; 19 immutable legacy baselines unchanged.
- Real-cache audit command above: exit 0, 100 rows and zero requests/writes to original evidence.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exit 0; 55 src/data files, 57 full-baseline files and 19 legacy-baseline files remain byte-identical with unchanged file sets.
- `openspec validate correct-dictionary-pronunciations --strict --json`: exit 0, no issues.
- `git diff --check`: exit 0; staged diff and final clean HEAD checks are included in the freeze record.

Task 5.2 is rechecked on these offline real-schema and fake end-to-end results, not on a claimed real MAIN response. Tasks 10.2-10.4 remain historical first-batch operation/report evidence, not second-batch completion. Groups 11, 12 and 13 stay unchecked/unexecuted. The only collection action prepared is the newly bound proposal; no second-batch grant exists yet.
