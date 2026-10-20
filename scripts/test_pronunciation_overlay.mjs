import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = join(
  root,
  'openspec/changes/archive/2026-10-20-correct-dictionary-pronunciations/evidence',
);
// 归档目录只读：--record-evidence 的产物写到稳定输出目录，不回写已归档 change。
const outputDirectory = join(root, 'reports/pronunciation-overlay');
const record = process.argv.includes('--record-evidence');
const acceptance = process.argv.includes('--acceptance');
const guard = fileURLToPath(new URL('./offline-network-guard.cjs', import.meta.url));
const env = {
  ...process.env,
  COREPACK_ENABLE_STRICT: '0',
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${guard}`.trim(),
};
const commands = [
  ...[
    'contracts',
    'identity',
    'classification',
    'scope_review',
    'resolution',
    'publication',
    'renderer',
  ].map((name) => ['node', [`scripts/test_pronunciation_${name}.mjs`]]),
  ['python3', ['scripts/run_pronunciation_python_tests.py']],
];
if (acceptance)
  commands.push(
    ...[
      'test:dictionary-data',
      'test:dictionary-corrections',
      'test:pronunciation-audit',
      'test:inflections',
      'test:phonetics',
      'typecheck',
      'build:types',
      'build:lib',
      'build:demo',
    ].map((name) => ['pnpm', ['run', name]]),
    ['node', ['scripts/check_pronunciation_distribution.mjs']],
  );
// 第 13 组权威层豁免：这三个文件由权威层与投影一致性校验守护
// （scripts/check_pronunciation_immutable_baseline.py 同一豁免集），
// 其余冻结文件照旧逐字节校验。
const GROUP13_AUTHORITY_FILES = new Set([
  'src/data/SYSTEM_CORRECTIONS.md',
  'src/data/dictionarySystemCorrections.json',
  'src/data/dictionarySystemPronunciationRules.json',
]);
function verifyBaseline() {
  const rows = readFileSync(join(evidence, 'baseline-sha256.tsv'), 'utf8').trim().split('\n');
  let checked = 0;
  for (const row of rows) {
    const columns = row.trim().split(/\s+/u);
    const expected = columns[0];
    const path = columns.at(-1);
    if (!/^[a-f0-9]{64}$/u.test(expected)) continue;
    if (GROUP13_AUTHORITY_FILES.has(path)) continue;
    const actual = createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex');
    if (actual !== expected) throw new Error(`Immutable baseline changed: ${path}`);
    checked++;
  }
  if (checked === 0) throw new Error('Missing immutable hash baseline');
  return checked;
}
const before = verifyBaseline();
const results = [];
if (record) mkdirSync(join(outputDirectory, 'logs'), { recursive: true });
for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const name = args.at(-1).replace(/[^a-zA-Z0-9_-]/gu, '-');
  if (record)
    writeFileSync(
      join(outputDirectory, 'logs', `ham37-${name}.log`),
      `${result.stdout ?? ''}${result.stderr ?? ''}\nExit code: ${result.status}\n`,
    );
  results.push({ command: [command, ...args].join(' '), exitCode: result.status });
  console.log(`${[command, ...args].join(' ')} => ${result.status}`);
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr, result.error ?? '');
    process.exitCode = 1;
    break;
  }
}
const after = verifyBaseline();
if (record)
  writeFileSync(
    join(outputDirectory, 'ham37-test-results.json'),
    JSON.stringify({ results, immutableFilesBefore: before, immutableFilesAfter: after }, null, 2) +
      '\n',
  );
console.log(`Immutable SHA256 baseline: ${after} files unchanged`);
