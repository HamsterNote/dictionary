# ECDICT English pronunciation audit

This directory contains a reproducible audit of the ten English vocabulary packs. Run:

```bash
yarn audit:pronunciations
yarn test:pronunciation-audit
```

## Scope and accounting

The audit reads `ecdict-core.tsv` plus `bnc`, `cet4`, `cet6`, `gk`, `gre`, `ielts`, `ky`, `toefl`, and `zk`. It verifies each generated header against ECDICT commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b` and source SHA-256 `1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`. The inflection files are intentionally excluded.

Every unique headword appears exactly once under `missing`, `notationFlag`, `unresolved`, `variants`, or `verifiedErrors`. The `overlap` section records the distribution of pack memberships and every non-zero pairwise intersection; pack memberships are also retained in reviewed records. The source TSVs remain untouched, and file hashes make replacement or regeneration visible.

The current pinned snapshot contains 66,016 pack rows and 46,803 unique headwords. Of those unique headwords, 9,051 have only missing pronunciations, 33,962 carry a legacy-notation flag, 3,786 remain non-empty and unresolved, one is an explicitly preserved variant, and three have verified corrections. Counting pack occurrences rather than unique headwords, 9,237 rows have missing pronunciations.

The categories do not promise semantic correctness. `notationFlag` is a mechanical flag for legacy ECDICT notation. `unresolved` means no human verdict was made. `pendingSignals` records suspicious backslash, caret, Cyrillic `є`, and `(?@)` families for later word-by-word review; it is not a patch list. Missing pronunciations are reported but never guessed.

## Verified patches

| Headword        | ECDICT or prior patch                          | Shipped correction | Evidence retrieved 2026-09-06                                                                                                                                               |
| --------------- | ---------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curiosity`     | `.kjuәri'ɒsiti`; prior patch `/.kjuәri'ɒsəti/` | `/ˌkjʊəriˈɒsəti/`  | [Oxford](https://www.oxfordlearnersdictionaries.com/definition/english/curiosity), [Dictionary API / Wiktionary](https://api.dictionaryapi.dev/api/v2/entries/en/curiosity) |
| `god`           | `^ɔd`                                          | `/ɡɒd/`            | [Oxford](https://www.oxfordlearnersdictionaries.com/definition/english/god_1), [Dictionary API / Wiktionary](https://api.dictionaryapi.dev/api/v2/entries/en/god)           |
| `pronunciation` | `prәu.nʌnsi'eiʃәn`                             | `/prəˌnʌnsiˈeɪʃn/` | [Oxford](https://www.oxfordlearnersdictionaries.com/definition/english/pronunciation), [Merriam-Webster](https://www.merriam-webster.com/dictionary/pronunciation)          |

`either` remains unchanged as a documented legitimate variant: Oxford lists both `/ˈaɪðə(r)/` and `/ˈiːðə(r)/` at [its entry](https://www.oxfordlearnersdictionaries.com/definition/english/either_1).

The citations do not use one identical transcription system. The shipped `curiosity` patch follows Oxford's UK `/ˌkjʊəriˈɒsəti/`, whose `/kjʊə.r/` sequence is also represented by the Wiktionary-derived API result; Oxford separately lists US `/ˌkjʊriˈɑːsəti/` with `/kjʊr/`. The shipped `pronunciation` patch follows Oxford's IPA, including final `/ʃn/`. Merriam-Webster independently corroborates standard initial `prə-` and labels the `/aʊ/` alternative nonstandard, but its `shən` ending is proprietary respelling rather than exact agreement with Oxford's IPA treatment of the final syllable.

## Evidence and licensing boundary

The audit stores short factual claims and links, not downloaded dictionary datasets. Oxford and Merriam-Webster are used only for manual, per-word corroboration; their content is proprietary and must not be bulk copied. Dictionary API responses identify Wiktionary-derived text under CC BY-SA 3.0. ECDICT is distributed under MIT, but its phonetic column was assembled from mixed sources without per-row provenance; see `THIRD_PARTY_NOTICES.md`. These patches are independent factual transcriptions, not a claim that the remaining entries are correct or that ECDICT has a complete commercial-rights chain.
