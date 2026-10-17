# Offline Pronunciation Overlay Tools

Run `COREPACK_ENABLE_STRICT=0 pnpm run test:pronunciation-overlay` for the Node
assert/Vite SSR and standard-library Python suite. The runner blocks outbound
network connections. Add `--record-evidence --acceptance` to the Node script to
record logs, check the 19 immutable baseline hashes, run existing regressions and
build the library, declarations and demo.

`python3 scripts/test_pronunciation_ui.py` is an additional browser check using an
already installed Python Playwright and Chromium. It serves an isolated synthetic
fixture on localhost, denies other HTTP destinations, and closes the service on
completion. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing browser.

## Candidate Review

`node scripts/review_pronunciation_candidate.mjs --input current-input.json
--candidate candidate.json --report report.md` freezes the current input as JSON
and a corresponding Markdown report. Input contains `batchId`,
`baseManifestVersion`, identity/source/rule/projection `versions` and one
`attempts` row per attempted word, including failures and no-change results.
Each row includes current/proposed snapshots, status, same-scope reasons, unknown
dimensions, retained manual values, complete source/license evidence,
`legacyState` and `scopeResolutions`. The review tool recomputes known v1 blocks.
Neither report generation nor scope confirmation approves publication.

With `--approval approval.json --baseline manifest-version`, the same entry
checks an externally supplied explicit approval against freshly generated
candidate content, fixed include/exclude lists, versions and baseline. It rejects
synthetic approvals. It never generates approval records or publishes.

## Publication Module

`pronunciation_publication.mjs` exports review/approval validation and filesystem
snapshot functions. Callers must obtain a separate explicit batch approval before
calling `publishCandidate`; implementation/apply permission is insufficient.
`rollbackSnapshot` requires a separate action bound to the exact target manifest
hash and current baseline. There is no autoapprove or scheduled publication path.

The candidate hash covers substantive input, including scopes, corrections,
projection, evidence and all necessary versions. Generated report formatting is
outside that identity. A baseline change requires regeneration and new approval.
Manifests, assets, candidate and approval history are immutable. Cooperating writers
use an exclusive publication lock; an abandoned lock fails closed and needs operator
inspection. Assets are validated before a fsynced atomic pointer replacement.
Consumers load one complete snapshot; excluded, blocked and no-change words retain
their previous references. Runtime manual corrections remain outside the snapshot.

Synthetic publication tests require both an explicit test option and a temporary
root carrying `.synthetic-test-root`; the normal approval validator rejects their
records. These test records and candidate/cache/checkpoint files are not packaged.
Python `--apply` and `run_apply` share a conditional authorization guard. They
remain NO-GO without an exact user confirmation bound to the running clean commit.
The code being executable does not grant collection. Groups 10–12 still need
their separate permissions; existing dump generators are unchanged.

## Collection Confirmation Gate

`refresh_wiktionary_pronunciations.py --describe-binding` derives a read-only JSON
contract from explicit workspace/batch roots, full clean HEAD, heads-file bytes,
UA, fixed TOC/MAIN calls, budgets and the output whitelist. `--budget-requests`
is mandatory for binding (maximum 600 attempts across all resumes). Use `python3
-B` for read-only commands. Paths must be workspace-relative with no leading `./`.
Only the reviewed five-second interval, two retries, 30-second timeout, 5/10-second
backoff and Wiktionary endpoint are supported. HTTP redirects and auxiliary
requests are forbidden. Limits are at most 100 heads and 20 MiB ALL decoded bytes.

`--check-authorization` additionally reads the externally supplied
`<batch>/inputs/authorization.json`. Its exact envelope keys are `schemaVersion: 1`,
`granted: true`, `synthetic: false`, `source: "user-confirmation"`, a nonempty
`confirmation` pointing to the user's explicit confirmation, and `binding` equal
to the complete derived contract. Agents must not create or edit this input or
turn a proposal into a grant. There is no grant-writing CLI. JSON is an external
confirmation record, not a cryptographic proof of the author's identity; the
operator must establish that it came from the user. A check passing never runs HTTP.

Preflight rejects missing/mismatched confirmation, changed/duplicate/oversized
lists, synthetic UA, changed calls/budgets/paths/version, dirty code, symlinks,
hardlinks, unexpected files, orphan state/cache, damaged or rolled-back checkpoint,
budget/uncertain paused state and unsettled in-flight requests before any output write. Cache
integrity checks are read-only. Git reads
use a minimal environment (no inherited Git selectors/configuration), explicitly
select the actual checkout, disable global/system config and optional index locks.
Bootstrap flock uses the existing batch directory;
the persistent `state/authorization.lock` is never replaced or unlinked. A second
read-only preflight under flock precedes registry creation. Registry CAS binds the
confirmation, contract and checkpoint digest. Its write-ahead `active` phase means
an interrupted session fails closed; a complete session atomically seals the new
checkpoint hash and increments the revision. Deleting/recreating state to reset
consumption is not a recovery operation. Cooperating processes must use this gate;
local filesystem owners can modify JSON and are outside its trust boundary.

Advisory flock only coordinates writers that honor it. It does not lock external
writers of Git HEAD, source files, authorization or checkpoint inputs. HEAD and
authorization are checked again at session exit, not before every dispatch.
Concurrent modification of these inputs during execution is prohibited. Mid-run
revocation is not supported. Local CAS does not detect an owner rolling back both
registry and checkpoint together.

The fake-HTTP tests mock confirmation reads in memory and disable sockets. They
exercise the same binding/registry protocol through collector/cache/candidate
generation. No actual authorization input is emitted. Request cap is persisted in
both authorization and budget; the strict gate requires explicit fields in saved
state, while older offline ledger fixtures retain their default for compatibility.
CLI and direct calls both enter `authorized_session` using fresh invocation
parameters; neither accepts a prevalidated config, a permit object, a synthetic
flag, or a transport injection parameter. Ledger, adapter and fixed candidate JSON
output paths come only from the verified binding. Transport construction happens
after preflight and lock acquisition. The exact approved head bytes are hashed
again before state writes and held in memory, so a subsequent file edit cannot
introduce an unapproved dispatch; end-of-session binding recheck then fails closed.
The collector writes the bound checkpoint
and complete response cache; candidate reparse writes `reports/candidates.json`.
The budget summary is printed to stdout and appended internally to `execution.log`
after authorization. Do not redirect shell output to the batch log before the
guard: shell redirection would create a file even when authorization is refused.
Paused batches return nonzero and cannot resume around their limits.

Cache body and metadata writes use same-directory `.cache-*.tmp` files, fsync,
rename, directory fsync and exact read-back verification before in-memory indexing.
Identical partial writes can be retried; conflicting content is rejected. Temporary
files are removed on handled failures; leftovers after a crash fail closed at the
path gate. A cache write failure immediately persists `cache-persist-failed` and
the already-accounted complete responses in `checkpoint.pendingCache`. The word
stays paused and nonterminal, no further head/request is dispatched, and candidate
generation is deferred (`candidateCount: null`; any older report is not updated).
A normally sealed session may resume this specific settled pause within its bound
budgets: it retries cache writes from checkpoint bytes before any new request,
without charging or fetching the page again. Unsettled requests, exhausted budgets,
invalid pending payloads and interrupted/active registries still refuse recovery.

The execution commit can now be frozen before confirmation; providing the valid
external input then allows execution on that same commit without editing code.
Any code change invalidates that binding and requires a new confirmation.

## Host Integration

The opt-in package subpath `@hamster-note/dictionary/pronunciation-overlay`
exports identity, resolution, review, scoped correction/storage, v1 protection,
query and renderer APIs. The existing default query/callback/v1 contracts remain
available. `createPronunciationQuery` accepts a validated published snapshot and
the consumer's current v1 read state and fingerprint-bound resolutions; rebuild it
when either changes. It returns all entries and readings without choosing a first
entry for the old single-value contract. A lossy legacy projection requires explicit
verification bound to the manifest version. Host-owned phonetic values are retained.
After scope confirmation, a current v1 phonetic patch must also be represented by
an active same-origin scoped rule with its exact value (including suppression).
Otherwise the query and publication tools keep the word protected. Confirmation
alone cannot drop the old patch; creating or migrating persisted rules still needs
the corresponding explicit operation.

`DictionaryContent.pronunciationOverlay` inserts an opt-in renderer. The component
also checks its actual current controlled/local v1 state; SSR with unread local
storage fails closed. `pronunciationCandidates` can supply a read-only comparison
while blocked. New scoped corrections use their own callback and v2 storage key.
The renderer never writes v1 or plays a specific IPA; word-level audio remains in
the existing parent component. Source/history/license/change notices remain readable
in the renderer and DTO. License files are distributed under `LICENSES/` separately
from the MIT application and existing ECDICT/dump notices.
