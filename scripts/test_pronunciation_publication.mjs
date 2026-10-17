import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import { makeFixture } from './pronunciation_test_fixture.mjs';
import {
  buildCandidate,
  candidateMarkdown,
  contentHash,
  verifyApproval,
  publishCandidate,
  readPublishedSnapshot,
  rollbackSnapshot,
  loadPublishedWord,
  rediffCandidate,
} from './pronunciation_publication.mjs';

const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true, ws: false },
});
const root = mkdtempSync(join(tmpdir(), 'synthetic-pronunciation-publication-'));
try {
  writeFileSync(join(root, '.synthetic-test-root'), 'synthetic-only');
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const identity = await server.ssrLoadModule('/src/pronunciation-overlay/identity.ts');
  const { createPronunciationQuery } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/query.ts',
  );
  const f = makeFixture(contracts, identity);
  const parsed = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from wiktionary_per_word.html_extract import extract_observations
from wiktionary_per_word.offline_reparse import build_source_evidence
from wiktionary_per_word.contract_adapter import evidence_to_contract, observation_to_contract
html = '<h2 id="English">English</h2><h3 id="Pronunciation">Pronunciation</h3><ul><li><span class="qualifier-content">US</span><span class="IPA">/x/</span></li></ul>'
observations = extract_observations(html).observations
evidence = build_source_evidence(word='read', page_url='https://en.wiktionary.org/wiki/read', history_url='https://en.wiktionary.org/w/index.php?title=read&action=history', revid=1, fetched_at='2026-10-17T00:00:00Z', body=html.encode(), observations=observations, change_note='Synthetic pipeline fixture')
e = evidence_to_contract(evidence, synthetic=True)
o = observation_to_contract(observations[0], observation_id='synthetic:observation', evidence_id=e['evidenceId'], source_spelling='read', synthetic=True)
print(json.dumps({'evidence':e, 'observation':o}))
`,
    ],
    { cwd: new URL('.', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(parsed.status, 0, parsed.stderr);
  const extracted = JSON.parse(parsed.stdout);
  const { buildReadingPlan } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/classification.ts',
  );
  const { resolveEntry } = await server.ssrLoadModule('/src/pronunciation-overlay/resolve.ts');
  assert.equal(
    buildReadingPlan([extracted.observation]).defaults.length,
    0,
    'parser unknown identity cannot be silently certified',
  );
  // A separate, explicit synthetic identity/scope confirmation supplies what the parser cannot infer.
  const mapped = { ...extracted.observation, applicability: f.scope() };
  const resolved = resolveEntry({
    entryId: f.entryId,
    scope: f.scope(),
    legacyFields: {},
    previousReadings: [],
    observations: [mapped],
    evidence: [extracted.evidence],
    rules: [],
  });
  assert.equal(resolved.readings[0].tier, 'default');
  f.documents.evidence = [extracted.evidence];
  f.documents.observations = [mapped];
  f.evidence = extracted.evidence;
  const row = (word, overrides = {}) => ({
    word,
    status: 'added',
    current: null,
    proposed: structuredClone(f.snapshot),
    legacyState: { status: 'ready', user: {}, system: {} },
    scopeResolutions: [],
    scopeReasons: ['synthetic full eight-dimensional scope'],
    unknownDimensions: [],
    manualRetained: [],
    evidence: [f.evidence],
    ...overrides,
  });
  const versions = {
    identity: 'identity/1',
    source: 'source/1',
    rule: 'rule/1',
    projection: 'projection/1',
  };
  const candidate = buildCandidate({
    batchId: 'synthetic-batch',
    baseManifestVersion: 'empty',
    versions,
    attempts: [
      row('read'),
      row('excluded'),
      row('blocked', { unknownDimensions: ['role'] }),
      row('legacy-blocked', {
        legacyState: { status: 'ready', user: { 'legacy-blocked': { phonetic: '' } }, system: {} },
      }),
      row('failed', { status: 'failed', proposed: null }),
      row('unchanged', { status: 'no-change' }),
      row('constructor', { status: 'no-change' }),
    ],
  });
  function approvalFor(candidate, excludedHeads = ['excluded']) {
    const includedHeads = candidate.attempts
      .map((row) => row.word)
      .filter((word) => !excludedHeads.includes(word));
    return {
      approvalId: `synthetic:${candidate.candidateHash}`,
      batchId: candidate.batchId,
      candidateHash: candidate.candidateHash,
      baseManifestVersion: candidate.baseManifestVersion,
      versions: candidate.versions,
      includedHeads,
      excludedHeads,
      selectionHash: contentHash({ includedHeads, excludedHeads }),
      approvedBy: 'synthetic-tester',
      approvedAt: '2026-10-17T00:00:00Z',
      action: 'approve-batch',
      explicitConfirmation: true,
      synthetic: true,
    };
  }
  const approval = approvalFor(candidate);
  const reviewInput = join(root, 'review-input.json');
  const reviewCandidate = join(root, 'review-candidate.json');
  const reviewReport = join(root, 'review-report.md');
  const reviewApproval = join(root, 'review-approval.json');
  writeFileSync(reviewInput, JSON.stringify(candidate));
  writeFileSync(reviewApproval, JSON.stringify(approval));
  const review = (extra = []) =>
    spawnSync(
      process.execPath,
      [
        'scripts/review_pronunciation_candidate.mjs',
        '--input',
        reviewInput,
        '--candidate',
        reviewCandidate,
        '--report',
        reviewReport,
        ...extra,
      ],
      { encoding: 'utf8' },
    );
  assert.equal(review().status, 0);
  assert.equal(
    JSON.parse(readFileSync(reviewCandidate, 'utf8')).candidateHash,
    candidate.candidateHash,
  );
  assert.equal(
    review(['--approval', reviewApproval, '--baseline', 'empty']).status,
    2,
    'real review entry rejects test approvals',
  );
  assert.throws(() =>
    verifyApproval(candidate, { ...approval, action: 'confirm-scope' }, 'empty', {
      synthetic: true,
    }),
  );
  assert.throws(() => verifyApproval(candidate, approval, 'empty'), /synthetic/u);
  assert.equal(verifyApproval(candidate, approval, 'empty', { synthetic: true }), true);
  assert.match(candidateMarkdown(candidate), /failed/u);
  assert.match(candidateMarkdown(candidate), /候选，未发布/u);
  assert.match(candidateMarkdown(candidate), /作者|history/u);
  // Layout changes have no part in the candidate hash or approval identity.
  const report = candidateMarkdown(candidate).replace(/\n/g, '\n\n');
  assert.ok(report.length > candidateMarkdown(candidate).length);
  assert.equal(verifyApproval(candidate, approval, 'empty', { synthetic: true }), true);
  for (const change of [
    (value) => {
      value.attempts[0].proposed.documents.displays[0].originalIpa = '/changed/';
    },
    (value) => {
      value.attempts[0].proposed.documents.observations[0].applicability.role =
        contracts.knownScope(['past']);
    },
    (value) => {
      value.attempts[0].manualRetained = ['changed-scope-resolution'];
    },
    (value) => {
      value.versions.rule = 'rule/2';
    },
  ]) {
    const changed = structuredClone(candidate);
    change(changed);
    assert.throws(
      () => verifyApproval(changed, approval, 'empty', { synthetic: true }),
      /changed/u,
    );
  }
  assert.throws(() =>
    verifyApproval(
      candidate,
      { ...approval, includedHeads: [], excludedHeads: candidate.attempts.map((row) => row.word) },
      'empty',
      { synthetic: true },
    ),
  );
  assert.throws(() =>
    publishCandidate(
      root,
      candidate,
      { ...approval, explicitConfirmation: false },
      { synthetic: true },
    ),
  );
  assert.equal(existsSync(join(root, 'current.json')), false);
  assert.throws(
    () =>
      publishCandidate(root, candidate, approval, {
        synthetic: true,
        beforeCommit() {
          throw new Error('synthetic crash');
        },
      }),
    /crash/u,
  );
  assert.equal(existsSync(join(root, 'current.json')), false);
  const first = publishCandidate(root, candidate, approval, { synthetic: true });
  assert.deepEqual(Object.keys(first.snapshot.words), ['read']);
  assert.equal(readPublishedSnapshot(root).manifestVersion, candidate.candidateHash);
  const loaded = loadPublishedWord(root, 'read');
  const guarded = createPronunciationQuery(loaded, {
    legacy: { status: 'ready', user: { read: { phonetic: '' } }, system: {} },
    resolutions: [],
  });
  assert.deepEqual(guarded.getEntryById(f.entryId).readings, []);
  assert.equal(loadPublishedWord(root, 'excluded'), undefined);
  assert.equal(loadPublishedWord(root, 'constructor'), undefined);
  const oldPointer = readFileSync(join(root, 'current.json'), 'utf8');
  const second = rediffCandidate(candidate, {
    baseManifestVersion: candidate.candidateHash,
    versions,
    attempts: [row('read', { status: 'replaced', current: loaded })],
  });
  assert.throws(() => publishCandidate(root, second, approval, { synthetic: true }));
  const nextApproval = approvalFor(second, []);
  const wrongCurrent = buildCandidate({
    ...second,
    attempts: [row('read', { status: 'replaced', current: null })],
  });
  assert.throws(
    () => publishCandidate(root, wrongCurrent, approvalFor(wrongCurrent, []), { synthetic: true }),
    /official baseline/u,
  );
  // Hash, reference, license, projection and identity failures leave the old pointer intact.
  for (const damage of [
    (asset) => {
      asset.documents.observations[0].evidenceId = 'missing';
    },
    (asset) => {
      asset.documents.evidence[0].license = { spdx: 'MIT' };
    },
    (asset) => {
      asset.documents.manifest.assets[0].sha256 = '0'.repeat(64);
    },
    (asset) => {
      asset.documents.manifest.compatibleProjection[0].entryId =
        'ent_ffffffff-0000-4000-8000-000000000001';
    },
    (asset) => {
      asset.identity.byId[f.entryId].status = 'retired';
    },
    (asset) => {
      delete asset.files['NOTICE.txt'];
    },
  ]) {
    const broken = structuredClone(second);
    damage(broken.attempts[0].proposed);
    const rebuilt = buildCandidate(broken);
    assert.throws(() =>
      publishCandidate(root, rebuilt, approvalFor(rebuilt, []), { synthetic: true }),
    );
    assert.equal(readFileSync(join(root, 'current.json'), 'utf8'), oldPointer);
  }
  writeFileSync(join(root, '.publication.lock'), 'busy');
  assert.throws(() => publishCandidate(root, second, nextApproval, { synthetic: true }), /EEXIST/u);
  rmSync(join(root, '.publication.lock'));
  const secondPublished = publishCandidate(root, second, nextApproval, { synthetic: true });
  assert.notEqual(secondPublished.manifestHash, first.manifestHash);
  for (const retainedStatus of ['no-change', 'unresolved']) {
    const retained = buildCandidate({
      batchId: `synthetic-${retainedStatus}`,
      baseManifestVersion: second.candidateHash,
      versions,
      attempts: [row('read', { current: loadPublishedWord(root, 'read'), status: retainedStatus })],
    });
    const retainedApproval = approvalFor(retained, retainedStatus === 'unresolved' ? ['read'] : []);
    const kept = publishCandidate(root, retained, retainedApproval, { synthetic: true });
    assert.deepEqual(kept.snapshot.words.read, secondPublished.snapshot.words.read);
    rollbackSnapshot(
      root,
      secondPublished.manifestHash,
      {
        action: 'rollback-manifest',
        explicitConfirmation: true,
        targetManifestHash: secondPublished.manifestHash,
        currentManifestVersion: retained.candidateHash,
        approvedBy: 'synthetic-tester',
        approvedAt: '2026-10-17T00:00:00Z',
        synthetic: true,
      },
      { synthetic: true },
    );
  }
  writeFileSync(join(root, 'runtime-corrections-v2.json'), '{"new-user-correction":true}');
  const historyBefore = readdirSync(join(root, 'history'));
  const rollback = {
    action: 'rollback-manifest',
    explicitConfirmation: true,
    targetManifestHash: first.manifestHash,
    currentManifestVersion: second.candidateHash,
    approvedBy: 'synthetic-tester',
    approvedAt: '2026-10-17T00:00:00Z',
    synthetic: true,
  };
  assert.throws(() =>
    rollbackSnapshot(
      root,
      first.manifestHash,
      { ...rollback, targetManifestHash: 'wrong' },
      { synthetic: true },
    ),
  );
  rollbackSnapshot(root, first.manifestHash, rollback, { synthetic: true });
  assert.equal(readPublishedSnapshot(root).manifestVersion, candidate.candidateHash);
  assert.equal(
    readFileSync(join(root, 'runtime-corrections-v2.json'), 'utf8'),
    '{"new-user-correction":true}',
  );
  assert.ok(historyBefore.every((path) => existsSync(join(root, 'history', path))));
  assert.throws(() =>
    verifyApproval(second, nextApproval, 'different-baseline', { synthetic: true }),
  );
  console.log(
    'test_pronunciation_publication: OK (isolated synthetic publication, faults, approval binding, rollback)',
  );
} finally {
  await server.close();
  rmSync(root, { recursive: true, force: true });
}
