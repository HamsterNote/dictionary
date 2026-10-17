import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const packed = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  encoding: 'utf8',
});
assert.equal(packed.status, 0, packed.stderr);
const files = JSON.parse(packed.stdout)[0].files.map((file) => file.path);
for (const file of [
  'dist/pronunciation-overlay.js',
  'dist/pronunciation-overlay/index.d.ts',
  'LICENSES/CC-BY-SA-4.0.txt',
  'LICENSES/WIKTIONARY-PRONUNCIATION-OVERLAY.md',
  'THIRD_PARTY_NOTICES.md',
])
  assert.ok(files.includes(file), `Missing distribution file: ${file}`);
assert.ok(
  !files.some((file) => /candidate|checkpoint|synthetic|fixture|evidence\/logs/u.test(file)),
);
const api = await import('../dist/pronunciation-overlay.js');
for (const name of [
  'createPronunciationQuery',
  'resolveEntry',
  'DictionaryPronunciationOverlay',
  'readLegacyState',
  'submitScopedCorrection',
])
  assert.equal(typeof api[name], 'function');
const notice = readFileSync('LICENSES/CC-BY-SA-4.0.txt', 'utf8');
assert.match(notice, /Attribution-ShareAlike 4.0 International/u);
console.log(
  `Distribution: ${files.length} files; overlay exports and independent license present; no candidate/checkpoint/test assets`,
);
