# First-round authorization and execution blocker

Task 10.1 is complete. Member confirmation `01a14d84-29f0-7f31-8d55-c5e16de8e279` explicitly authorizes the first round; coordinator instruction `01a14d84-ac0a-70e1-8b31-aa10a50d6cb2` requests serialization and execution. No publishing or long-term budget authorization is implied.

- Execution commit: `777b2454b552fb8d702198cb2ca78a4e0c0b261a`.
- Canonical binding SHA256: `d29534124a55754abb682f4c8684736da78fa81000cad00b72112d271cafa1bf`.
- Ordered 100-head file SHA256: `aabdfceeda0cca922790c57fadddd13f7a50a321f35371ecbdf932cb1793b6f8`.
- UA: `HamsterDictionaryPronunciationCollector/0.1 (+https://github.com/HamsterNote/dictionary/issues)`.
- Authorized ceilings: 100 distinct heads, 600 attempts, 20,971,520 ALL decoded bytes; serial 5 seconds, 2 retries per operation, 5/10-second backoff, longer Retry-After honored. Exact endpoint/calls/path binding is in the attached `evidence.json`.

`ham37-first-round-v1/inputs/authorization.json` was serialized from that member confirmation as expressly instructed. The exact bound CLI with `--check-authorization` returned exit 0 while HEAD matched the execution commit and the tree was clean. The full command and returned binding are in the attached `evidence.json`; this file is not an execution grant.

## Blocker

The current instruction says to pause and report on HTTP 403/429/timeout. Frozen `scripts/wiktionary_per_word/http_adapter.py:781-817` retries 429, then raises TransportError; 403 also raises TransportError. `collector.py:124-127` finishes the word FAILED without pausing; run_batch continues the next head.

A socket-disabled, memory-only fake HTTP probe on heads note/read reproduced:

| Synthetic status | Dispatches | Processed heads | Batch pause |
| --- | ---: | --- | --- |
| 403 | 2 | note, read | null |
| 429 | 6 | note, read | null |

The probe asserts those observations and exits 0; this proves the mismatch, not correct stop behavior. Its complete runnable `python3 -B -c` command and output are included in the attached `evidence.json`. No request reached Wiktionary, no network reachability test was made and no real `--apply` was invoked (exit code is therefore null).

Actual requests / network bytes / decoded bytes are 0 / 0 / 0. There is no real checkpoint, ledger, candidate, source/license observation or recovery to audit. Tasks 10.2-10.4 remain unchecked; the four reports document non-execution only. The original authorization is not treated as approval of a changed execution version. Correct the denial pause path and freeze/rebind the resulting version before execution.

## Verification and scope

- `--check-authorization`: exit 0 before documentation edits, approved clean HEAD.
- Offline denial probe: exit 0, sockets forbidden, in-memory synthetic ledger/cache only.
- `python3 -B scripts/check_pronunciation_immutable_baseline.py`: exit 0; src/data 55, full baseline 57 and legacy baseline 19 files unchanged.
- `git diff --check`: exit 0 after documentation edits (see delivery verification).

Only tasks/evidence documentation changes in the repository this turn; these uncommitted records make the working tree dirty after the successful preflight. No production collector code or formal data was changed, no second preflight/apply is claimed, no PR base change or merge occurred. The four report files are preparation artifacts outside the repository, delivered as issue attachments. Groups 11 and 12 remain unauthorized.
