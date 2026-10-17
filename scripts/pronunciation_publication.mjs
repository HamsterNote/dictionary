import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const contractRoot = fileURLToPath(new URL('.', import.meta.url));
const statuses = [
  'added',
  'replaced',
  'retained',
  'supplemental',
  'excluded-old',
  'unresolved',
  'failed',
  'missing',
  'no-qualified',
  'no-change',
];
export const PUBLICATION_VERSION = 'pronunciation-publication/1';

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('Non-JSON candidate input');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}
export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validateAsset(asset) {
  const result = spawnSync(
    process.execPath,
    [join(contractRoot, 'validate_pronunciation_snapshot.mjs')],
    {
      cwd: join(contractRoot, '..'),
      input: JSON.stringify(asset),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
    },
  );
  if (result.status !== 0)
    throw new Error(`Invalid snapshot documents: ${result.stdout || result.stderr}`);
  for (const file of asset.documents.manifest.assets) {
    const content = asset.files?.[file.path];
    if (
      typeof content !== 'string' ||
      Buffer.byteLength(content) !== file.bytes ||
      createHash('sha256').update(content).digest('hex') !== file.sha256 ||
      file.licenseSpdx !== 'CC-BY-SA-4.0'
    )
      throw new Error('Missing/corrupt licensed asset');
  }
  for (const license of asset.documents.manifest.licenseAssets) {
    if (typeof asset.files?.[license.noticePath] !== 'string')
      throw new Error('Missing license notice');
  }
}

function knownLegacyProtection(attempts) {
  const result = spawnSync(
    process.execPath,
    [join(contractRoot, 'validate_pronunciation_snapshot.mjs'), '--legacy-batch'],
    {
      cwd: join(contractRoot, '..'),
      input: JSON.stringify(attempts),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0) throw new Error(`Cannot verify legacy protection: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Every attempted head gets one row, including failures. Report layout is outside candidate identity. */
export function buildCandidate({ batchId, baseManifestVersion, versions, attempts }) {
  if (
    !batchId ||
    !baseManifestVersion ||
    !versions ||
    ['identity', 'source', 'rule', 'projection'].some((key) => !versions[key])
  )
    throw new Error('Missing version bindings');
  if (!Array.isArray(attempts) || new Set(attempts.map((row) => row.word)).size !== attempts.length)
    throw new Error('Duplicate/missing attempted heads');
  for (const row of attempts) {
    if (
      !row.word ||
      !statuses.includes(row.status) ||
      !Array.isArray(row.scopeReasons) ||
      !Array.isArray(row.unknownDimensions) ||
      !Array.isArray(row.manualRetained) ||
      !Array.isArray(row.evidence) ||
      !Object.hasOwn(row, 'current') ||
      !Object.hasOwn(row, 'proposed') ||
      !row.legacyState ||
      !['ready', 'failed'].includes(row.legacyState.status) ||
      !Array.isArray(row.scopeResolutions)
    )
      throw new Error('Incomplete report row');
    for (const evidence of row.evidence) {
      if (
        !evidence.pageUrl ||
        !evidence.historyUrl ||
        evidence.license?.spdx !== 'CC-BY-SA-4.0' ||
        evidence.license?.shareAlike !== true ||
        !evidence.license?.url ||
        !evidence.license?.changeNotice
      )
        throw new Error('Missing attribution/license');
    }
  }
  const blocked = knownLegacyProtection(attempts);
  const content = structuredClone({
    schema: PUBLICATION_VERSION,
    batchId,
    baseManifestVersion,
    versions,
    attempts: [...attempts]
      .map((row) => ({ ...row, blockedReasons: blocked[row.word] }))
      .sort((a, b) => a.word.localeCompare(b.word)),
  });
  return { ...content, candidateHash: contentHash(content) };
}

export function candidateMarkdown(candidate) {
  const inline = (value) =>
    JSON.stringify(value)
      .replace(/[|<>]/g, (char) => ({ '|': '&#124;', '<': '&lt;', '>': '&gt;' })[char])
      .replace(/\n/g, ' ');
  return (
    `候选批次 ${candidate.batchId}\n\n候选 SHA256: ${candidate.candidateHash}\n正式基线: ${candidate.baseManifestVersion}\n\n` +
    candidate.attempts
      .map(
        (row) =>
          `## ${row.word}\n\n状态: ${row.status}（候选，未发布）\n\n当前: ${inline(row.current)}\n\n拟议: ${inline(row.proposed)}\n\n同范围依据: ${inline(row.scopeReasons)}\n\n未知: ${inline(row.unknownDimensions)}\n\n人工保留: ${inline(row.manualRetained)}\n\n来源/历史/许可: ${inline(row.evidence)}\n`,
      )
      .join('\n')
  );
}

function selection(candidate, included, excluded) {
  if (
    !Array.isArray(included) ||
    !Array.isArray(excluded) ||
    new Set([...included, ...excluded]).size !== included.length + excluded.length ||
    canonicalJson([...included, ...excluded].sort()) !==
      canonicalJson(candidate.attempts.map((row) => row.word).sort())
  )
    throw new Error('Approval must fix the complete include/exclude list');
}

/** This verifies an externally supplied explicit action. There is deliberately no autoapprove API. */
export function verifyApproval(candidate, approval, baseline, { synthetic = false } = {}) {
  const { candidateHash, ...content } = candidate;
  if (contentHash(content) !== candidateHash)
    throw new Error('Candidate changed: regenerate diff and approve again');
  selection(candidate, approval.includedHeads, approval.excludedHeads);
  if (
    approval.action !== 'approve-batch' ||
    approval.explicitConfirmation !== true ||
    !approval.approvedBy?.trim() ||
    !Number.isFinite(Date.parse(approval.approvedAt)) ||
    !approval.approvalId ||
    approval.candidateHash !== candidateHash ||
    approval.baseManifestVersion !== baseline ||
    candidate.baseManifestVersion !== baseline ||
    approval.batchId !== candidate.batchId ||
    canonicalJson(approval.versions) !== canonicalJson(candidate.versions) ||
    approval.selectionHash !==
      contentHash({
        includedHeads: approval.includedHeads,
        excludedHeads: approval.excludedHeads,
      }) ||
    (approval.synthetic === true && !synthetic)
  )
    throw new Error('Approval is missing, stale, synthetic or for a different baseline/list');
  return true;
}

export function rediffCandidate(candidate, { baseManifestVersion, versions, attempts }) {
  return buildCandidate({ batchId: candidate.batchId, baseManifestVersion, versions, attempts });
}

function immutableWrite(path, bytes) {
  if (existsSync(path)) {
    if (!readFileSync(path).equals(Buffer.from(bytes)))
      throw new Error('Immutable asset collision');
    return;
  }
  const fd = openSync(path, 'wx');
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function atomicPointer(root, pointer, beforeCommit = () => {}) {
  const path = join(root, `pointer-${process.pid}-${crypto.randomUUID()}.tmp`);
  const fd = openSync(path, 'wx');
  try {
    writeFileSync(fd, canonicalJson(pointer));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  beforeCommit();
  renameSync(path, join(root, 'current.json'));
  const directory = openSync(root, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readPublishedSnapshot(root) {
  const pointer = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(pointer.manifestHash)) throw new Error('Invalid official pointer');
  const snapshot = JSON.parse(
    readFileSync(join(root, 'manifests', `${pointer.manifestHash}.json`), 'utf8'),
  );
  if (
    contentHash(snapshot) !== pointer.manifestHash ||
    snapshot.kind !== 'published-pronunciation-batch'
  )
    throw new Error('Corrupt official manifest');
  for (const value of Object.values(snapshot.words)) validateWord(root, value);
  return snapshot;
}

function validateWord(root, value) {
  if (!/^[a-f0-9]{64}$/.test(value.assetHash)) throw new Error('Invalid asset reference');
  const bytes = readFileSync(join(root, 'assets', `${value.assetHash}.json`));
  if (createHash('sha256').update(bytes).digest('hex') !== value.assetHash)
    throw new Error('Asset hash mismatch');
  const asset = JSON.parse(bytes);
  if (asset.kind !== 'published-pronunciation-snapshot')
    throw new Error('Candidate/checkpoint cannot be an official asset');
  validateAsset(asset);
  return asset;
}

/** Only tests may use synthetic approvals, and then only inside an explicitly marked isolated root. */
function checkMode(root, synthetic) {
  if (
    synthetic &&
    (!existsSync(join(root, '.synthetic-test-root')) ||
      readFileSync(join(root, '.synthetic-test-root'), 'utf8') !== 'synthetic-only')
  )
    throw new Error('Synthetic publication requires isolated test root');
}

function publicationLock(root, action) {
  mkdirSync(root, { recursive: true });
  const path = join(root, '.publication.lock');
  const fd = openSync(path, 'wx');
  try {
    return action();
  } finally {
    closeSync(fd);
    unlinkSync(path);
  }
}

export function publishCandidate(root, candidate, approval, options = {}) {
  return publicationLock(root, () => publishLocked(root, candidate, approval, options));
}
function publishLocked(root, candidate, approval, { synthetic = false, beforeCommit } = {}) {
  checkMode(root, synthetic);
  const current = existsSync(join(root, 'current.json'))
    ? readPublishedSnapshot(root)
    : { manifestVersion: 'empty', words: {} };
  verifyApproval(candidate, approval, current.manifestVersion, { synthetic });
  const words = Object.assign(Object.create(null), current.words);
  const blocked = knownLegacyProtection(candidate.attempts);
  const included = new Set(approval.includedHeads);
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'manifests'), { recursive: true });
  mkdirSync(join(root, 'history'), { recursive: true });
  for (const row of candidate.attempts) {
    const currentAsset = Object.hasOwn(current.words, row.word)
      ? validateWord(root, current.words[row.word])
      : null;
    if (canonicalJson(row.current) !== canonicalJson(currentAsset)) {
      throw new Error(
        'Reported current result differs from official baseline: regenerate diff and approve again',
      );
    }
    if (
      !included.has(row.word) ||
      row.unknownDimensions.length > 0 ||
      blocked[row.word]?.length > 0 ||
      row.blockedReasons?.length > 0 ||
      ['unresolved', 'failed', 'missing', 'no-qualified', 'no-change'].includes(row.status)
    )
      continue;
    const asset = structuredClone(row.proposed);
    if (asset?.kind !== 'published-pronunciation-snapshot')
      throw new Error('Invalid proposed snapshot');
    if (
      !asset.documents.displays?.some((display) => display.word === row.word) ||
      asset.documents.displays.some((display) => display.word !== row.word) ||
      asset.documents.observations.some((observation) => observation.sourceSpelling !== row.word)
    ) {
      throw new Error('Proposed word differs from candidate head');
    }
    const versions = asset.documents.manifest;
    asset.documents.manifest = {
      ...versions,
      manifestVersion: candidate.candidateHash,
      previousManifestVersion: current.manifestVersion,
      candidateHash: candidate.candidateHash,
      approvalId: approval.approvalId,
    };
    asset.documents.approvals = [
      {
        schema: 'pronunciation-approval/1',
        approvalId: approval.approvalId,
        candidateHash: candidate.candidateHash,
        baseManifestVersion: approval.baseManifestVersion,
        identitySchemaVersion: versions.identitySchemaVersion,
        evidenceSchemaVersion: versions.evidenceSchemaVersion,
        observationSchemaVersion: versions.observationSchemaVersion,
        ruleSchemaVersion: versions.ruleSchemaVersion,
        resolvedSchemaVersion: versions.resolvedSchemaVersion,
        includedHeads: approval.includedHeads,
        excludedHeads: approval.excludedHeads,
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        action: 'approve-batch',
      },
    ];
    validateAsset(asset);
    if (
      !synthetic &&
      (asset.documents.evidence.some((evidence) => evidence.synthetic) ||
        asset.documents.observations.some((observation) => observation.synthetic) ||
        Object.values(asset.identity.byId).some((identity) => identity.synthetic))
    )
      throw new Error('Synthetic data cannot enter real publication');
    const bytes = Buffer.from(canonicalJson(asset));
    const assetHash = createHash('sha256').update(bytes).digest('hex');
    immutableWrite(join(root, 'assets', `${assetHash}.json`), bytes);
    words[row.word] = { assetHash };
  }
  const snapshot = {
    kind: 'published-pronunciation-batch',
    manifestVersion: candidate.candidateHash,
    previousManifestVersion: current.manifestVersion,
    words,
    candidateHash: candidate.candidateHash,
    approvalId: approval.approvalId,
  };
  const manifestHash = contentHash(snapshot);
  immutableWrite(
    join(root, 'history', `${contentHash(candidate)}.candidate.json`),
    canonicalJson(candidate),
  );
  immutableWrite(
    join(root, 'history', `${contentHash(approval)}.approval.json`),
    canonicalJson(approval),
  );
  immutableWrite(join(root, 'manifests', `${manifestHash}.json`), canonicalJson(snapshot));
  for (const value of Object.values(words)) validateWord(root, value);
  for (const directory of ['assets', 'manifests', 'history']) syncDirectory(join(root, directory));
  // Recheck baseline after all validation and before committing the pointer.
  const latest = existsSync(join(root, 'current.json'))
    ? readPublishedSnapshot(root).manifestVersion
    : 'empty';
  if (latest !== current.manifestVersion)
    throw new Error('Baseline changed: regenerate diff and approve again');
  atomicPointer(root, { manifestHash }, beforeCommit);
  return { manifestHash, snapshot };
}

export function rollbackSnapshot(root, targetManifestHash, authorization, options = {}) {
  return publicationLock(root, () =>
    rollbackLocked(root, targetManifestHash, authorization, options),
  );
}
function rollbackLocked(
  root,
  targetManifestHash,
  authorization,
  { synthetic = false, beforeCommit } = {},
) {
  checkMode(root, synthetic);
  const current = readPublishedSnapshot(root);
  if (
    authorization.action !== 'rollback-manifest' ||
    authorization.explicitConfirmation !== true ||
    authorization.targetManifestHash !== targetManifestHash ||
    authorization.currentManifestVersion !== current.manifestVersion ||
    !authorization.approvedBy?.trim() ||
    !Number.isFinite(Date.parse(authorization.approvedAt)) ||
    (authorization.synthetic && !synthetic)
  )
    throw new Error('Explicit target-bound rollback authorization required');
  if (!/^[a-f0-9]{64}$/.test(targetManifestHash)) throw new Error('Invalid rollback target');
  const target = JSON.parse(
    readFileSync(join(root, 'manifests', `${targetManifestHash}.json`), 'utf8'),
  );
  if (contentHash(target) !== targetManifestHash || target.kind !== 'published-pronunciation-batch')
    throw new Error('Corrupt rollback manifest');
  for (const value of Object.values(target.words)) validateWord(root, value);
  immutableWrite(
    join(root, 'history', `${contentHash(authorization)}.rollback.json`),
    canonicalJson(authorization),
  );
  syncDirectory(join(root, 'history'));
  atomicPointer(root, { manifestHash: targetManifestHash }, beforeCommit);
}

export function loadPublishedWord(root, word) {
  const snapshot = readPublishedSnapshot(root);
  const value = Object.hasOwn(snapshot.words, word) ? snapshot.words[word] : undefined;
  return value === undefined ? undefined : validateWord(root, value);
}
