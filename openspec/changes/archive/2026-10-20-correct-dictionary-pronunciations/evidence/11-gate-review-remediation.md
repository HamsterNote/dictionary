# Gate review remediation before a new freeze

2026-10-17. Fixes the two major findings against `3eb0a127` in the review
comment `01a14a6a-cd83-7795-92b8-8c61a8aba291`. This is offline implementation
and validation only. No actual authorization file, real request, production
apply invocation or publication was made. Tasks 10-12 remain unchecked.

## Git validation

`authorization._git` now starts with a minimal environment, using the system
executable search path and C locale. No inherited `GIT_*` variables survive;
global/system configuration is disabled, optional locks are disabled and local
fsmonitor execution is disabled. The actual checkout's `.git` entry is required.
Git-directory discovery runs in that checkout under the sanitized environment;
the command then explicitly selects its absolute git directory and work tree.
This also supports linked checkouts whose `.git` entry is a gitfile.

`StrictGateTests.test_git_environment_cannot_redirect_head_clean_or_binding`
creates two independent commits. It points GIT_DIR/WORK_TREE/INDEX_FILE/COMMON_DIR,
OBJECT_DIRECTORY/ALTERNATE_OBJECT_DIRECTORIES/NAMESPACE, CONFIG/GLOBAL/SYSTEM,
CONFIG_COUNT/KEY_0/VALUE_0/PARAMETERS and discovery variables at the other checkout.
The primitive still returns the actual HEAD and actual clean/dirty status.
An invocation using the alternate commit is refused by session, direct runner
and CLI with no transport/mkdir/registry write and unchanged file set/bytes/mtime.
`test_git_validation_supports_explicit_linked_checkout` verifies gitfile discovery
and the linked checkout's dirty status independently.

## Durable cache failure and recovery

`ResponseCache` persists before indexing. Body and metadata each use a temporary
`.cache-*.tmp` file in the cache directory, file fsync, rename, directory fsync
and exact read-back validation. Existing identical bytes are idempotent on retry;
conflicts remain immutable. The binding explicitly includes the temporary prefix.
Handled failures clean temporary files; crash leftovers are refused by preflight.

On the first cache exception, Collector persists `cache-persist-failed`, keeps
the word PAUSED/nonterminal and saves the exact already-accounted complete page
responses in checkpoint.pendingCache. Payload validation checks structure, base64,
body hashes, response ordering/count, settled consumption and paused-word identity.
The runner returns nonzero, does not dispatch another request or start another
head, and defers candidate output (`candidateCount: null`). Older reports are not
rewritten to suggest an empty successful result.

A normally sealed registry may resume this specific settled cache pause within
the existing budget. Recovery retries persistence from checkpoint bytes before
new HTTP, preserves fetchedAt/provenance and all head/byte/request counters, and
only then finishes the word and proceeds. Network uncertainty, active registries,
in-flight requests, exhausted budgets and invalid pending payloads still fail closed.
If checkpoint persistence itself fails, the exception propagates, registry stays
active and automatic restart is refused; no claim of disk-failure-proof recovery.

Regression evidence:

- `test_cache_failure_pauses_and_recovers_evidence_without_refetch`: put raises
  OSError twice; each run makes one persistence attempt and zero further dispatch.
  Word remains recoverable, next head unstarted, budgets unchanged on failed
  recovery, candidate generation forbidden. Successful recovery saves both
  responses before the next head, emits candidates, preserves word attempts=1,
  then ordinary resume skips terminal words without additional requests.
- `test_partial_cache_commit_recovers_with_api_retries`: API maxlag retry,
  successful first cache metadata and injected next metadata rename failure.
  Disk reload retains pending responses; resume reuses complete partial files,
  saves all three responses without refetch, then processes the second head.
  Retry/request counters survive. Damaged body/hash, terminal pending word and
  unsettled request variants refuse with zero writes/transport.
- `test_damaged_pending_evidence_refuses_without_effects`: missing or malformed
  pending bytes never turn a cache pause into a recovery bypass.
- Cache unit tests inject body/metadata rename failure and incorrect read-back;
  failed writes never enter the in-memory index, temporary files are cleaned,
  identical retries survive disk reload and preserve source attribution.

## Verification and limits

All required commands exited 0 (full stdout/stderr and structured results in
`logs/ham37-review-fixes.log` and `ham37-review-fixes-results.json`):

- `python3 -B scripts/run_pronunciation_python_tests.py`: 291 tests, including
  33 gate test methods and multiple subcases, with sockets disabled.
- `node scripts/test_pronunciation_overlay.mjs`: seven Node assert/SSR entries
  plus the Python suite, network guard enabled; 19 baseline hashes unchanged.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exact 55-file
  src/data set, all 57 full-baseline hashes and all 19 legacy hashes unchanged.
- `git diff --check`: clean.

Advisory flock only coordinates cooperating writers. It does not lock external
writers of Git HEAD, code, authorization or checkpoint. HEAD and authorization
are rechecked at session exit; concurrent modification of these inputs during
execution is prohibited. Mid-run revocation is not supported or added here.
Unsigned source=user-confirmation remains structural validation, not identity
authentication; the operator must establish the actual user's confirmation.
Local CAS does not defend against an owner rolling back registry and checkpoint
together. Python 3.14.4 / Node 24.15.0 tested; Python 3.12 is not installed.

The new execution SHA, canonical binding and exact describe stdout are generated
after commit and delivered externally, avoiding a self-referential commit hash.
No code edits follow that freeze. Independent directed re-review, public Issues
contact monitoring confirmation and explicit user confirmation remain outstanding.
The previous freeze/binding must not be reused for execution.
