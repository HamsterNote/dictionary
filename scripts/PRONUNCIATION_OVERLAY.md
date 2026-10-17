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
Real collection remains explicitly disabled in the Python `--apply` entry until
strict collection authorization is implemented and separately authorized. Nothing
here enables groups 10–12 or changes the existing dump generators.

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
