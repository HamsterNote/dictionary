# Conditional execution gate, frozen before user confirmation

2026-10-17. Supersedes report 09's unconditional-NO-GO limitation. The trigger
explicitly authorized implementing a conditional guard, not real collection.
No actual authorization input was created and no real Wiktionary request was sent.
Tasks 10-12 remain unchecked. Source data and original manifests are unchanged.

## Entry contract

Both `main(--apply)` and direct `run_apply(args, now=...)` enter
`authorized_session` with fresh invocation parameters. The executable repository
root comes from the script location, not a CLI option. The old `ApplyConfig`
permit-like object was removed. Direct calls reject dictionaries/grant objects;
there is no public transport injection, synthetic permission or bypass flag.
Mutually exclusive CLI modes prevent an invocation from mixing describe/check
with apply. Only an exact externally supplied user-confirmation envelope can
pass; missing/mismatched input and agent-labeled sources remain NO-GO.

All request configuration and output paths come from the verified binding. The
same clean current HEAD must match executionCommit. After read-only preflight,
bootstrap flock, repeated preflight, exact heads rehash and persistent lock,
the registry writes its active marker. Only then can the runner create/load its
bound checkpoint/cache and construct the transport with the bound 30s timeout.
The approved exact heads are held as an immutable tuple, so a file changed during
execution cannot substitute unapproved heads. Binding is checked again on exit;
change or interruption leaves the registry active and blocks subsequent runs.

Collector uses the shared persistent budget (heads, ALL decoded bytes, dispatch
attempts). A normal resume skips terminal heads and preserves all counters. The
runner writes the fixed candidate JSON from complete cache responses, returns
the budget summary, and appends it to the bound execution.log only after passing
the gate. A paused run returns nonzero. Shell redirection is not needed and must
not be used to create batch logs before authorization checks.

ResponseCache has a read-only load mode used by preflight. Corrupt response data
therefore rejects before state/registry writes or transport construction. The
read-only cache also refuses put calls. No frontend or publication code changed.

## Verification

- `python3 -B scripts/run_pronunciation_python_tests.py`: exit 0, 284 tests;
  connect/connect_ex/create_connection disabled. The authorization module has
  28 test methods with multiple negative subcases.
- `node scripts/test_pronunciation_overlay.mjs`: exit 0; seven Node assert/SSR
  entries and the Python suite passed. Original 19 hashes checked before/after.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exit 0;
  exact 55-file src/data set, full 57-file baseline and original 19-file baseline
  all unchanged. Hash lists are the existing frozen lists, not regenerated data.
- `git diff --check`: exit 0.

Negative subcases now exercise **all three** paths: authorized_session,
run_apply, and CLI main. They require nonzero CLI return, no transport factory,
no mkdir/registry write, identical file/directory set, bytes and mtimes. Coverage
includes no authorization, changed hash/UA/calls/budgets/paths/commit, synthetic UA,
agent source, bad ledger/cache, in-flight, crash registry and lock contention.

The positive fixture mocks confirmation reads only in memory, patches the
transport factory to fake HTTP and the adapter clock to FakeClock, and disables
sockets. CLI performs dynamic English section 3 TOC + MAIN, handles a missing
second head, and produces candidate JSON/log with three cumulative attempts.
Direct run_apply resumes that same batch: no additional HTTP, identical request,
byte and head counters, candidate report retained, registry revision increments.
A mutation fixture changes the head file in the fake factory: only the original
approved heads are dispatched, final binding check rejects, registry stays active.
No on-disk inputs/authorization.json is used by these tests.

Node 24.15.0 / Python 3.14.4. Python 3.12 is not installed and remains untested.

## Freeze and remaining external inputs

The final execution commit, full --describe-binding output, canonical binding
digest and read-only invocation are delivered as issue attachments after commit,
avoiding a self-referential hash. No code is edited after that freeze. A future
valid user confirmation can be consumed on that same commit without enabling it
through another code change. Any later review fix requires a new freeze/binding.

User confirmation and independent gate review are still outstanding. There is no
actual granted input. The Issues URL is a syntactically accepted public UA contact
but this agent has no evidence that someone monitors it; the user must confirm
that fact or supply a different public contact before final authorization.

The source=user-confirmation marker and confirmation reference are structural
validation, not cryptographic proof of authorship. Input origin must be established
by the operator against the user's actual confirmation; agents must not write or
edit grants. A local filesystem/process owner able to forge JSON or monkeypatch
Python is outside this gate's trust boundary. The independent review should assess
this explicit boundary; this implementation does not claim to authenticate a human
solely from unsigned JSON. There is no grant-producing command.
