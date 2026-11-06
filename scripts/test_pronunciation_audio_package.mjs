import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'reports/pronunciation-audio');
mkdirSync(output, { recursive: true });
const pack = spawnSync(
  'npm',
  ['pack', '--ignore-scripts', '--json', '--pack-destination', output],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (pack.status !== 0) throw new Error(pack.stdout + pack.stderr);
const [packResult] = JSON.parse(pack.stdout);
const tarball = join(output, packResult.filename);
const packagedPaths = new Set(packResult.files.map((file) => file.path));
for (const path of [
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/WIKTIONARY-PRONUNCIATION-AUDIO.md',
  'LICENSES/CC-BY-3.0.txt',
  'LICENSES/CC-BY-SA-3.0.txt',
  'dist/pronunciation-audio.js',
  'dist/pronunciation-audio/index.d.ts',
  'dist/pronunciation-audio/browser.js',
  'dist/pronunciation-audio/browser.d.ts',
]) {
  assert.ok(packagedPaths.has(path), `tarball missing ${path}`);
}

function dependencyClosure(entry) {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/gu)) {
      visit(resolve(dirname(path), match[1]));
    }
  }
  visit(entry);
  return seen;
}

for (const entry of ['dist/index.js', 'dist/pronunciation-audio.js']) {
  const files = dependencyClosure(join(root, entry));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /new Audio|new Worker|kokoro-js|92 MB/iu,
      `${entry} pulls browser/model code via ${file}`,
    );
  }
}

const smoke = join(output, 'smoke');
rmSync(smoke, { recursive: true, force: true });
mkdirSync(smoke, { recursive: true });
writeFileSync(
  join(smoke, 'package.json'),
  JSON.stringify({
    name: 'pronunciation-audio-smoke',
    private: true,
    type: 'module',
  }) + '\n',
);
const install = spawnSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarball,
    'react@19.2.3',
    'react-dom@19.2.3',
  ],
  { cwd: smoke, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
if (install.status !== 0) throw new Error(install.stdout + install.stderr);
const script = `
  import assert from 'node:assert/strict';
  import { pronunciationAudioManifest, resolvePronunciationAudio } from '@hamster-note/dictionary/pronunciation-audio';
  import { createPronunciationBrowserController } from '@hamster-note/dictionary/pronunciation-audio/browser';
  import { DictionaryContent } from '@hamster-note/dictionary';
  assert.equal(pronunciationAudioManifest.entries.length, 5);
  const entry = pronunciationAudioManifest.entries[0];
  assert.equal(resolvePronunciationAudio(pronunciationAudioManifest, {
    word: entry.word, language: 'en', phonetic: entry.phonetic,
  }).status, 'available');
  assert.equal(typeof createPronunciationBrowserController, 'function');
  assert.equal(typeof DictionaryContent, 'function');
  assert.equal(typeof globalThis.Worker, 'undefined');
  console.log(JSON.stringify({ entries: 5, subpathImports: 'ok', rootImport: 'ok' }));
`;
const imported = spawnSync('node', ['--input-type=module', '--eval', script], {
  cwd: smoke,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (imported.status !== 0) throw new Error(imported.stdout + imported.stderr);
const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex');
writeFileSync(join(output, 'tarball-sha256.txt'), `${sha256}  ${packResult.filename}\n`);
console.log(imported.stdout.trim());
console.log(`test_pronunciation_audio_package: OK (${packResult.filename}; sha256 ${sha256})`);
rmSync(smoke, { recursive: true, force: true });
