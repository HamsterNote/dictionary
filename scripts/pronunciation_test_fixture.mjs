import { createHash } from 'node:crypto';

/** Shared synthetic data for policy tests; never imported by application or publication entry points. */
export function makeFixture(contracts, identity, { fourRoles = false } = {}) {
  const { PRONUNCIATION_SCHEMA: schema, scopeWith, knownScope } = contracts;
  let sequence = 0;
  const factory = (kind) =>
    `${kind === 'entry' ? 'ent' : 'lex'}_${String(++sequence).padStart(8, '0')}-0000-4000-8000-000000000001`;
  const read = identity.establishReadIdentities(identity.createIdentityRegistry(), {
    synthetic: true,
    idFactory: factory,
    multiRoleEvidence: {
      roles: fourRoles ? identity.READ_ROLE_ORDER : ['base'],
      evidenceRefs: ['synthetic:identity'],
    },
  });
  const entryId = read.ids.base;
  const scope = (overrides = {}) =>
    scopeWith({
      language: knownScope(['en']),
      entry: knownScope([entryId]),
      lexeme: knownScope([read.lexemeId]),
      role: knownScope(['base']),
      pos: knownScope(['verb']),
      sense: knownScope(['synthetic-sense']),
      accent: knownScope(['US']),
      other: knownScope(['unrestricted']),
      ...overrides,
    });
  const evidence = {
    schema: schema.evidence,
    evidenceId: 'synthetic:evidence',
    sourceSite: 'wiktionary',
    language: 'en',
    pageUrl: 'https://en.wiktionary.org/wiki/read',
    historyUrl: 'https://en.wiktionary.org/w/index.php?title=read&action=history',
    revision: 'synthetic-1',
    extractedAt: '2026-10-17T00:00:00Z',
    requestVersion: 'synthetic/1',
    renderVersion: 'synthetic/1',
    extractorVersion: 'synthetic/1',
    tagRuleVersion: 'synthetic/1',
    responseContentHash: 'synthetic-only',
    ipaSemanticFingerprint: 'synthetic-only',
    license: {
      spdx: 'CC-BY-SA-4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'Wiktionary contributors (synthetic fixture)',
      shareAlike: true,
      changeNotice: 'Synthetic fixture; no real source IPA asserted',
    },
    synthetic: true,
  };
  const observation = {
    schema: schema.observation,
    observationId: 'synthetic:observation',
    evidenceId: evidence.evidenceId,
    language: 'en',
    sourceSpelling: 'read',
    rawIpa: '/x/',
    normalizedIpa: '/x/',
    notation: 'phonemic',
    completeness: 'complete',
    rawTags: ['US'],
    rawQualifiers: [],
    structuralPath: ['English', 'Pronunciation'],
    applicability: scope(),
    synthetic: true,
  };
  const rule = (overrides = {}) => ({
    schema: schema.rule,
    ruleId: 'synthetic:rule',
    origin: 'user',
    target: { kind: 'entry', entryId },
    operations: [{ field: 'phonetic', op: 'set', value: '/u/' }],
    conditions: scope(),
    evidenceRefs: [],
    createdAt: '2026-01-31T00:00:00Z',
    reviewStatus: 'active',
    ...overrides,
  });
  const attribution = {
    pageUrl: evidence.pageUrl,
    historyUrl: evidence.historyUrl,
    licenseUrl: evidence.license.url,
    licenseSpdx: evidence.license.spdx,
    changeNotice: evidence.license.changeNotice,
  };
  const display = {
    schema: schema.display,
    entryId,
    role: 'base',
    word: 'read',
    originalIpa: '/x/',
    notation: 'phonemic',
    accent: { class: 'us-unspecified', label: 'US', unspecified: false },
    usage: [],
    tier: 'default',
    reviewStatus: 'active',
    origin: 'qualified-source',
    attribution,
    synthetic: true,
  };
  const notice =
    'Synthetic pronunciation fixture. CC BY-SA 4.0. https://creativecommons.org/licenses/by-sa/4.0/';
  const versions = {
    identitySchemaVersion: schema.identity,
    evidenceSchemaVersion: schema.evidence,
    observationSchemaVersion: schema.observation,
    ruleSchemaVersion: schema.rule,
    resolvedSchemaVersion: schema.resolved,
  };
  const documents = {
    identityEntryIds: Object.values(read.ids),
    identityLexemeIds: [read.lexemeId],
    evidence: [evidence],
    observations: [observation],
    rules: [],
    resolved: [
      {
        schema: schema.resolved,
        entryId,
        conditions: scope(),
        defaultReadingRefs: [observation.observationId],
        supplementalReadingRefs: [],
        retainedReadingRefs: [],
        fieldProvenance: [
          { field: 'phonetic', source: 'qualified-source', ref: observation.observationId },
        ],
        unresolvedReasons: [],
        excludedReasons: [],
        reviewStatus: 'active',
      },
    ],
    manifest: {
      schema: schema.manifest,
      manifestVersion: 'synthetic-manifest',
      previousManifestVersion: 'empty',
      ...versions,
      candidateHash: 'synthetic-candidate',
      assets: [
        {
          path: 'NOTICE.txt',
          sha256: createHash('sha256').update(notice).digest('hex'),
          bytes: Buffer.byteLength(notice),
          licenseSpdx: 'CC-BY-SA-4.0',
        },
      ],
      perEntryResultVersions: { [entryId]: 'synthetic-result/1' },
      compatibleProjection: [
        { entryId, legacyWord: 'read', phonetic: '/x/', notation: 'phonemic' },
      ],
      licenseAssets: [
        {
          spdx: 'CC-BY-SA-4.0',
          url: evidence.license.url,
          noticePath: 'NOTICE.txt',
          scope: 'wiktionary-derived',
        },
      ],
      approvalId: 'synthetic:approval',
    },
    approvals: [
      {
        schema: schema.approval,
        approvalId: 'synthetic:approval',
        candidateHash: 'synthetic-candidate',
        baseManifestVersion: 'empty',
        ...versions,
        includedHeads: ['read'],
        excludedHeads: [],
        approvedBy: 'synthetic-tester',
        approvedAt: '2026-10-17T00:00:00Z',
        action: 'approve-batch',
      },
    ],
    checkpoints: [],
    displays: [display],
  };
  return {
    ...read,
    entryId,
    scope,
    evidence,
    observation,
    rule,
    display,
    documents,
    snapshot: {
      kind: 'published-pronunciation-snapshot',
      identity: read.registry,
      documents,
      files: { 'NOTICE.txt': notice },
    },
  };
}
