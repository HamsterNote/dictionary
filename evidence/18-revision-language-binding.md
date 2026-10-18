# Offline TOC Revision and MAIN Language Binding

## Scope

Coordinator comment `01a14e7c-67be-76f1-9360-d721db8f636b` requires the remaining
revision/language defect to be fixed offline before any second-batch request.
Commit 941fd9b6 is superseded for execution. The intervening confirmation for that
old binding is not applied to this new code/call plan. No new real authorization
JSON is created, no real apply is run and no Wiktionary requests are dispatched.
The first-round checkpoint, evidence, cache and counters are preserved.

## Changes and Boundaries

- TOC requests `prop=tocdata|revid` in the same parse operation. The response must
  supply a positive integer revision (bool, string, missing and nonpositive values
  are rejected before MAIN dispatch).
- MAIN uses `oldid=<TOC revid>` and the selected English `section=<index>` with
  `prop=text|revid`. It sends neither `page` nor `redirects`. All MAIN retries retain
  this oldid/index. The returned revid must equal TOC exactly. Out-of-range sections
  and unavailable oldids become FAILED, not successful/no-reading or missing-head
  conclusions. No extra validation/auxiliary request is added.
- Before FOUND, the expanded HTML must have exactly one h2 root, English. Foreign,
  missing, extra/duplicate roots, h1 roots and IPA outside the verified root fail.
  Nested headline markup/entities and edit links are parsed structurally. Generic
  HTML extraction derives language from the actual h2; a rootless observation has
  unknown language, never assumed English. Collector repeats the root check during
  pending-cache recovery before evidence or terminal success.
- `oldid` freezes page revision selection, **not templates/modules**. The same
  revision can expand differently later; language validation is a second gate,
  not a claim of historically reproducible expansion. Immutable raw responses and
  semantic fingerprints remain necessary.
- Extractor version is /3. Old checkpoints cannot silently resume on the changed
  parser. Authorization equality, budget, locks, registry, uncertainty refusal and
  service-pause recovery rules are not relaxed. The canonical TOC/MAIN call templates
  are changed to match the actual URL builders; tests compare them field by field.

## Regression Evidence

Twelve new tests in `scripts/test_wiktionary_per_word_revision.py` exercise:

1. A fake server moves English after TOC (real-cache `in` shape, number=2/index=5).
   Live page revision 202 would return German `/x/`; the production collector instead
   requests oldid=201/index=5, verifies English revision 201, persists evidence/cache
   and generates candidates through the normal cache reparser. Two dispatches only;
   `/x/` does not become a candidate.
2. MAIN revision differs from TOC: FAILED, no evidence/candidate input, two attempts
   and both response bodies charged, no active request left.
3. German body at the matching revision: same fail-closed result.
4. Missing/ambiguous/wrong-level/wrong-case language roots: same rejection.
5. IPA before the later English root cannot acquire English scope.
6. Missing/invalid TOC revision: FAILED after one TOC dispatch, no MAIN dispatch.
7. Missing/invalid oldid cannot build a MAIN URL.
8. Invalid section indices cannot build a MAIN URL.
9. Server `nosuchsection` for out-of-range section: FAILED, not MISSING/EXTRACTED.
10. Server `nosuchrevid`: snapshot failure, not a missing head.
11. Direct generic extraction labels German as German and rootless IPA as unknown.
12. English headline with nested markup/entities/edit link passes end to end.

Existing fake fixtures now carry matching TOC and MAIN revisions. Their transport
scripts, request journaling, retries, CLI/resume and cache fsync tests remain active;
no production fallback for legacy revision-less TOC is introduced.

## Real Cache Audit

```sh
python3 -B dictionary/scripts/audit_wiktionary_toc_cache.py \
  --cache-dir ham37-first-round-v1/cache \
  --heads-file ham37-first-round-v1/inputs/heads.txt \
  --output ham37-second-round-revision-freeze/toc-sections.json
```

Exit 0: 100/100 English sections, zero dispatch/new requests, original batch file
hashes/mtimes unchanged. All 100 old TOCs lack revid; the updated audit emits null
MAIN URLs/parameters rather than generating unbound executable page/index URLs.
The earlier /2 audit remains historical evidence only. Fresh authorized TOC must
provide both revision and index before any real MAIN operation.

## Proposed Second Batch (Not Authorized)

Same ordered 100-head file, SHA256
`aabdfceeda0cca922790c57fadddd13f7a50a321f35371ecbdf932cb1793b6f8`.
Same UA: `HamsterDictionaryPronunciationCollector/0.1 (+https://github.com/HamsterNote/dictionary/issues)`.
Sole endpoint: `https://en.wiktionary.org/w/api.php`; fresh TOC/revid then
revision-bound English MAIN. Normally at most 200 requests, hard cap 600 dispatch
attempts / 100 heads / 20,971,520 ALL decoded bytes across recovery. Serial interval
5 seconds, timeout 30 seconds, 2 shared retries per operation, backoff 5/10 seconds,
Retry-After respected, no HTTP redirects or auxiliary requests.

At 200 dispatches, intervals alone require 995 seconds; approximately 19-25 minutes
is still a planning estimate using the prior TOC run, with no measured MAIN latency
or size and no guarantee of finishing before limits. Retries can extend runtime.
Previous TOC decoded bytes were 1,688,166; a reliable total byte prediction is not
available. Encoded network response bytes are measured separately without their
own independent hard cap; requests count every dispatch including known-zero
failures, decoded bytes include TOC/MAIN/errors/retries. No 50% saving is claimed.

Root stays `ham37-second-round-v1/`: inputs heads/authorization, state checkpoint/
registry/lock, content-addressed cache, execution.log, four reports and existing
atomic temporary prefixes. Only heads.txt is prepared; no grant/state/cache/report
is created in that root. The full frozen commit/canonical/output are delivered in
the final comment and attachments, after committing this evidence.

Any limit pauses; the 101st head cannot start. Same-batch counters do not reset.
Uncertain consumption still prevents automatic recovery and needs explicit manual
disposition. Advisory flock constrains only cooperating writers; concurrent changes
to HEAD/authorization/checkpoint inputs during execution remain prohibited, with
HEAD/authorization rechecked on exit. Runtime revocation is not supported.

**This proposal is not authorization. No real request may be made before new user
confirmation of the new execution commit and complete canonical binding.** Group
11 publication, group 12 long-term budget and group 13 migration remain unchecked
and unexecuted. No src/data or formal manifest/publication data is modified.

## Verification

- `python3 -B scripts/run_pronunciation_python_tests.py`: 332 tests, exit 0; sockets
  disabled by the runner, including fake HTTP revision and language cases.
- `node scripts/test_pronunciation_overlay.mjs`: seven Node entries plus the Python
  child exit 0.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exit 0; 55 src/data,
  57 full-baseline and 19 legacy-baseline file sets and SHA256 unchanged.
- Real-cache audit above: exit 0; zero requests, original files unchanged.
- `git diff --check`: exit 0.

Task 5.2 keeps its check with this added regression evidence. No further task is
checked and no real MAIN success is claimed.
