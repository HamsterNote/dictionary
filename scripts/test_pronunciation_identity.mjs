import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const identity = await server.ssrLoadModule('/src/pronunciation-overlay/identity.ts');
  const json = await server.ssrLoadModule('/src/pronunciation-overlay/json.ts');

  const {
    PRONUNCIATION_SCHEMA,
    SCOPE_DIMENSIONS,
    validateOverlayDocumentSet,
    validateScopeConstraint,
    validateSourceEvidence,
    computeObservationFingerprint,
    knownScope,
    unknownScope,
    explicitAllScope,
    scopeWith,
  } = contracts;
  const {
    createIdentityRegistry,
    createLexeme,
    createEntry,
    updateEntryAttributes,
    getEntry,
    getLexeme,
    listEntries,
    listLexemes,
    listLexemeEntryIds,
    buildSpellingIndex,
    lookupEntryIdsBySpelling,
    addSourceAlias,
    reconcileSourceAlias,
    confirmSourceAlias,
    establishReadIdentities,
    shareRoleEvidence,
    mergeEntries,
    splitEntry,
    validateIdentityRegistry,
    defaultIdentityIdFactory,
    isOpaqueIdentityId,
    normalizeSpellingKey,
    serializeIdentityRegistry,
    deserializeIdentityRegistry,
    evaluateScopeCompatibility,
    overallScopeResult,
    READ_ROLE_ORDER,
  } = identity;
  const { canonicalizeJson, fingerprintJson } = json;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const ENTRY_ID = 'ent_11111111-2222-3333-4444-555555555555';
  const LEXEME_ID = 'lex_11111111-2222-3333-4444-555555555555';
  const EVIDENCE_ID = 'ev-synthetic-1';
  const OBSERVATION_ID = 'obs-synthetic-1';
  const APPROVAL_ID = 'apr-synthetic-1';

  function scopeFor(entryId, overrides = {}) {
    return scopeWith({
      language: knownScope(['en']),
      entry: knownScope([entryId]),
      lexeme: knownScope([LEXEME_ID]),
      role: knownScope(['base']),
      pos: knownScope(['noun']),
      sense: knownScope(['color']),
      accent: knownScope(['US']),
      other: knownScope(['none']),
      ...overrides,
    });
  }

  /** 全维度 known 的范围构造器（merge/split 覆盖核对用）。 */
  function fullScope(entryId, lexemeId, overrides = {}) {
    return scopeWith({
      language: knownScope(['en']),
      entry: knownScope([entryId]),
      lexeme: knownScope([lexemeId]),
      role: knownScope(['base']),
      pos: knownScope(['noun']),
      sense: knownScope(['color']),
      accent: knownScope(['US']),
      other: knownScope(['none']),
      ...overrides,
    });
  }

  function makeEvidence(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.evidence,
      evidenceId: EVIDENCE_ID,
      sourceSite: 'wiktionary',
      language: 'en',
      pageUrl: 'https://en.wiktionary.org/wiki/read',
      historyUrl: 'https://en.wiktionary.org/w/index.php?title=read&action=history',
      revision: '100',
      extractedAt: '2026-10-08T00:00:00Z',
      requestVersion: 'req/1',
      renderVersion: 'render/1',
      extractorVersion: 'extractor/1',
      tagRuleVersion: 'tags/1',
      responseContentHash: 'sha256:synthetic',
      ipaSemanticFingerprint: 'fp-synthetic',
      license: {
        spdx: 'CC-BY-SA-4.0',
        url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attribution: 'https://en.wiktionary.org/w/index.php?title=read&action=history',
        shareAlike: true,
        changeNotice: 'derived pronunciation overlay, synthetic fixture',
      },
      synthetic: true,
      ...overrides,
    };
  }

  function makeObservation(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.observation,
      observationId: OBSERVATION_ID,
      evidenceId: EVIDENCE_ID,
      language: 'en',
      sourceSpelling: 'read',
      rawIpa: '/SYNTH-IPA-A/',
      normalizedIpa: '/SYNTH-IPA-A/',
      notation: 'phonemic',
      completeness: 'complete',
      rawTags: ['IPA', 'UK'],
      rawQualifiers: ['RP'],
      structuralPath: ['English', 'Pronunciation', 'IPA'],
      applicability: scopeFor(ENTRY_ID),
      synthetic: true,
      ...overrides,
    };
  }

  function makeRule(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.rule,
      ruleId: 'rule-synthetic-1',
      origin: 'system',
      target: { kind: 'entry', entryId: ENTRY_ID },
      operations: [
        { field: 'phonetic', op: 'set', value: '/SYNTH-IPA-A/', observationRefs: [OBSERVATION_ID] },
      ],
      conditions: scopeFor(ENTRY_ID),
      evidenceRefs: [EVIDENCE_ID],
      createdAt: '2026-10-08T00:00:00Z',
      reviewStatus: 'active',
      ...overrides,
    };
  }

  function makeResolved(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.resolved,
      entryId: ENTRY_ID,
      conditions: scopeFor(ENTRY_ID),
      defaultReadingRefs: [OBSERVATION_ID],
      supplementalReadingRefs: [],
      retainedReadingRefs: [],
      fieldProvenance: [{ field: 'phonetic', source: 'qualified-source', ref: OBSERVATION_ID }],
      unresolvedReasons: [],
      excludedReasons: [],
      reviewStatus: 'active',
      ...overrides,
    };
  }

  function makeManifest(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.manifest,
      manifestVersion: 'manifest/1',
      identitySchemaVersion: PRONUNCIATION_SCHEMA.identity,
      evidenceSchemaVersion: PRONUNCIATION_SCHEMA.evidence,
      observationSchemaVersion: PRONUNCIATION_SCHEMA.observation,
      ruleSchemaVersion: PRONUNCIATION_SCHEMA.rule,
      resolvedSchemaVersion: PRONUNCIATION_SCHEMA.resolved,
      candidateHash: 'candidate-synthetic-1',
      previousManifestVersion: 'manifest/0',
      assets: [
        {
          path: 'src/data/overlay.json',
          sha256: 'sha256:synthetic',
          bytes: 10,
          licenseSpdx: 'CC-BY-SA-4.0',
        },
      ],
      perEntryResultVersions: { [ENTRY_ID]: 'resolved/1' },
      compatibleProjection: [
        { entryId: ENTRY_ID, legacyWord: 'read', phonetic: 'SYNTH-IPA-A', notation: 'phonemic' },
      ],
      licenseAssets: [
        {
          spdx: 'CC-BY-SA-4.0',
          url: 'https://creativecommons.org/licenses/by-sa/4.0/',
          noticePath: 'LICENSES/WIKTIONARY.txt',
          scope: 'wiktionary-derived',
        },
        {
          spdx: 'MIT',
          url: 'https://opensource.org/license/mit',
          noticePath: 'THIRD_PARTY_NOTICES.md',
          scope: 'application',
        },
      ],
      approvalId: APPROVAL_ID,
      ...overrides,
    };
  }

  function makeApproval(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.approval,
      approvalId: APPROVAL_ID,
      candidateHash: 'candidate-synthetic-1',
      baseManifestVersion: 'manifest/0',
      identitySchemaVersion: PRONUNCIATION_SCHEMA.identity,
      evidenceSchemaVersion: PRONUNCIATION_SCHEMA.evidence,
      observationSchemaVersion: PRONUNCIATION_SCHEMA.observation,
      ruleSchemaVersion: PRONUNCIATION_SCHEMA.rule,
      resolvedSchemaVersion: PRONUNCIATION_SCHEMA.resolved,
      includedHeads: ['read'],
      excludedHeads: [],
      approvedBy: 'synthetic-tester',
      approvedAt: '2026-10-08T00:00:00Z',
      action: 'approve-batch',
      ...overrides,
    };
  }

  function makeCheckpoint() {
    return {
      schema: PRONUNCIATION_SCHEMA.checkpoint,
      batchId: 'batch-synthetic-1',
      schemaVersions: {
        overlay: PRONUNCIATION_SCHEMA.overlay,
        extractor: 'extractor/1',
        tagRule: 'tags/1',
      },
      approvedBudget: { maxDistinctHeads: 100, maxDecompressedBytes: 20971520, authorized: true },
      queue: ['read'],
      headStates: { read: 'reported' },
      startedDistinctHeads: ['read'],
      counts: {
        requests: 1,
        retries: 0,
        auxiliaryRequests: 1,
        decompressedBytes: 1024,
        networkBytes: 512,
      },
      lastCompletionEvidence: EVIDENCE_ID,
    };
  }

  function makeDisplay(overrides = {}) {
    return {
      schema: PRONUNCIATION_SCHEMA.display,
      entryId: ENTRY_ID,
      role: 'base',
      word: 'read',
      originalIpa: '/SYNTH-IPA-A/',
      notation: 'phonemic',
      accent: { class: 'unspecified', label: '未注明口音', unspecified: true },
      usage: [],
      tier: 'default',
      reviewStatus: 'active',
      origin: 'qualified-source',
      attribution: {
        pageUrl: 'https://en.wiktionary.org/wiki/read',
        historyUrl: 'https://en.wiktionary.org/w/index.php?title=read&action=history',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        licenseSpdx: 'CC-BY-SA-4.0',
        changeNotice: 'derived pronunciation overlay, synthetic fixture',
      },
      synthetic: true,
      ...overrides,
    };
  }

  function makeDocumentSet() {
    return {
      identityEntryIds: [ENTRY_ID],
      identityLexemeIds: [LEXEME_ID],
      evidence: [makeEvidence()],
      observations: [makeObservation()],
      rules: [makeRule()],
      resolved: [makeResolved()],
      manifest: makeManifest(),
      approvals: [makeApproval()],
      checkpoints: [makeCheckpoint()],
      displays: [makeDisplay()],
    };
  }

  // =========================================================================
  // 2.1 JSON 合同 / 校验
  // =========================================================================

  // entry 与 lexeme 维度独立。
  assert.ok(SCOPE_DIMENSIONS.includes('entry'));
  assert.ok(SCOPE_DIMENSIONS.includes('lexeme'));

  const validSet = makeDocumentSet();
  const validResult = validateOverlayDocumentSet(validSet);
  assert.equal(validResult.valid, true, JSON.stringify(validResult.issues));

  // 非不透明 lex-test 引用不再放行（必须是真实持久 lex_ UUID）。
  const invalidLexemeRef = clone(validSet);
  invalidLexemeRef.observations[0].applicability.lexeme = knownScope(['lex-test']);
  assert.equal(validateOverlayDocumentSet(invalidLexemeRef).valid, false);

  // 缺 list 不得默认空数组；null/primitive 不得崩溃。
  const missingList = clone(validSet);
  delete missingList.evidence;
  assert.equal(validateOverlayDocumentSet(missingList).valid, false);
  const nullList = clone(validSet);
  nullList.evidence = null;
  assert.equal(validateOverlayDocumentSet(nullList).valid, false);
  const primitiveList = clone(validSet);
  primitiveList.rules = 'not-an-array';
  assert.equal(validateOverlayDocumentSet(primitiveList).valid, false);
  assert.doesNotThrow(() =>
    validateOverlayDocumentSet({
      identityEntryIds: [1],
      evidence: [null],
      observations: 5,
      rules: null,
      resolved: {},
      approvals: 'x',
      checkpoints: 0,
      manifest: 42,
    }),
  );

  // unknown 不得当 explicit-all；explicit-all 证据项与引用必须有效。
  const missingReason = clone(validSet);
  missingReason.observations[0].applicability.language = { kind: 'unknown' };
  assert.equal(validateOverlayDocumentSet(missingReason).valid, false);
  const fakeAll = clone(validSet);
  fakeAll.observations[0].applicability.sense = { kind: 'all' };
  assert.equal(validateOverlayDocumentSet(fakeAll).valid, false);
  const emptyAllEvidence = clone(validSet);
  emptyAllEvidence.rules[0].conditions.accent = { kind: 'explicit-all', evidence: [] };
  assert.equal(validateOverlayDocumentSet(emptyAllEvidence).valid, false);
  const badAllItem = clone(validSet);
  badAllItem.rules[0].conditions.accent = { kind: 'explicit-all', evidence: [123] };
  assert.equal(validateOverlayDocumentSet(badAllItem).valid, false);
  const danglingAllEvidence = clone(validSet);
  danglingAllEvidence.rules[0].conditions.accent = {
    kind: 'explicit-all',
    evidence: ['ev-missing'],
  };
  assert.equal(validateOverlayDocumentSet(danglingAllEvidence).valid, false);
  const missingDimension = clone(validSet);
  delete missingDimension.observations[0].applicability.other;
  assert.equal(validateOverlayDocumentSet(missingDimension).valid, false);
  const scopeIssues = [];
  validateScopeConstraint({ kind: 'unknown' }, '$', scopeIssues);
  assert.equal(scopeIssues.length > 0, true);

  // 空观测保留：rawIpa/normalizedIpa 允许为空字符串。
  const emptyObservation = clone(validSet);
  emptyObservation.observations[0].rawIpa = '';
  emptyObservation.observations[0].normalizedIpa = '';
  emptyObservation.observations[0].completeness = 'empty';
  assert.equal(
    validateOverlayDocumentSet(emptyObservation).valid,
    true,
    JSON.stringify(validateOverlayDocumentSet(emptyObservation).issues),
  );

  // RuleOperation：set 空值非法；suppress 无值合法。
  const setEmpty = clone(validSet);
  setEmpty.rules[0].operations = [{ field: 'phonetic', op: 'set', value: '' }];
  assert.equal(validateOverlayDocumentSet(setEmpty).valid, false);
  const suppressOk = clone(validSet);
  suppressOk.rules[0].operations = [{ field: 'phonetic', op: 'suppress' }];
  assert.equal(
    validateOverlayDocumentSet(suppressOk).valid,
    true,
    JSON.stringify(validateOverlayDocumentSet(suppressOk).issues),
  );
  const clearWithValue = clone(validSet);
  clearWithValue.rules[0].operations = [{ field: 'phonetic', op: 'clear', value: '/x/' }];
  assert.equal(validateOverlayDocumentSet(clearWithValue).valid, false);

  // operation observationRefs 坏引用。
  const badOpRef = clone(validSet);
  badOpRef.rules[0].operations = [
    { field: 'phonetic', op: 'set', value: '/x/', observationRefs: ['obs-missing'] },
  ];
  assert.equal(validateOverlayDocumentSet(badOpRef).valid, false);

  // manifest / approval 层 version 必须等于常量。
  const badManifestVersion = clone(validSet);
  badManifestVersion.manifest.ruleSchemaVersion = 'pronunciation-rule/0';
  assert.equal(validateOverlayDocumentSet(badManifestVersion).valid, false);
  const badApprovalVersion = clone(validSet);
  badApprovalVersion.approvals[0].resolvedSchemaVersion = 'pronunciation-resolved/0';
  assert.equal(validateOverlayDocumentSet(badApprovalVersion).valid, false);

  // 缺许可 / 错许可。
  const mitLicense = clone(validSet);
  mitLicense.evidence[0].license.spdx = 'MIT';
  assert.equal(validateOverlayDocumentSet(mitLicense).valid, false);
  const licenseIssues = [];
  validateSourceEvidence(mitLicense.evidence[0], '$', licenseIssues);
  assert.equal(licenseIssues.length > 0, true);
  const manifestMitLicense = clone(validSet);
  manifestMitLicense.manifest.licenseAssets = [
    { spdx: 'MIT', url: 'u', noticePath: 'n', scope: 'wiktionary-derived' },
  ];
  assert.equal(validateOverlayDocumentSet(manifestMitLicense).valid, false);

  // 坏引用 / 无效 ID / 重复。
  const badEvidenceRef = clone(validSet);
  badEvidenceRef.observations[0].evidenceId = 'ev-missing';
  assert.equal(validateOverlayDocumentSet(badEvidenceRef).valid, false);
  const badReadingRef = clone(validSet);
  badReadingRef.resolved[0].defaultReadingRefs = ['obs-missing'];
  assert.equal(validateOverlayDocumentSet(badReadingRef).valid, false);
  const badRuleTarget = clone(validSet);
  badRuleTarget.rules[0].target.entryId = 'ent-missing';
  assert.equal(validateOverlayDocumentSet(badRuleTarget).valid, false);
  const invalidIdentityId = clone(validSet);
  invalidIdentityId.identityEntryIds = ['read'];
  assert.equal(validateOverlayDocumentSet(invalidIdentityId).valid, false);
  const badPerEntry = clone(validSet);
  badPerEntry.manifest.perEntryResultVersions = { 'ent-missing': 'r1' };
  assert.equal(validateOverlayDocumentSet(badPerEntry).valid, false);
  const mismatchedApproval = clone(validSet);
  mismatchedApproval.manifest.candidateHash = 'candidate-other';
  assert.equal(validateOverlayDocumentSet(mismatchedApproval).valid, false);
  const duplicate = clone(validSet);
  duplicate.evidence.push(clone(duplicate.evidence[0]));
  assert.equal(validateOverlayDocumentSet(duplicate).valid, false);
  const noWiktionaryLicense = clone(validSet);
  noWiktionaryLicense.manifest.licenseAssets = [noWiktionaryLicense.manifest.licenseAssets[1]];
  assert.equal(validateOverlayDocumentSet(noWiktionaryLicense).valid, false);

  // json 工具。
  assert.equal(canonicalizeJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  assert.equal(fingerprintJson({ a: 1, b: 2 }), fingerprintJson({ b: 2, a: 1 }));
  assert.throws(() => canonicalizeJson({ a: Number.NaN }), /有限值/u);
  const baseObservation = makeObservation();
  assert.equal(
    computeObservationFingerprint(baseObservation),
    computeObservationFingerprint({ ...baseObservation, rawTags: ['UK', 'IPA'] }),
  );
  assert.notEqual(
    computeObservationFingerprint(baseObservation),
    computeObservationFingerprint({ ...baseObservation, rawIpa: '/SYNTH-IPA-B/' }),
  );

  // =========================================================================
  // 2.2 canonical byId / 索引 / 别名
  // =========================================================================

  assert.match(defaultIdentityIdFactory('entry'), /^ent_[0-9a-f-]{36}$/u);
  assert.match(defaultIdentityIdFactory('lexeme'), /^lex_[0-9a-f-]{36}$/u);
  assert.equal(isOpaqueIdentityId('ent_aaaaaaaa-1111-2222-3333-444444444444'), true);
  assert.equal(isOpaqueIdentityId('ent_not-a-uuid'), false);

  // 无 crypto 时 fail closed（不伪造 UUID）。
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let failClosedVerified = false;
  if (cryptoDescriptor !== undefined && cryptoDescriptor.configurable) {
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      assert.throws(() => defaultIdentityIdFactory('entry'), /fail closed/u);
      failClosedVerified = true;
    } finally {
      Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    }
  }
  assert.equal(failClosedVerified, true, '应能在无 crypto 时验证 fail closed');

  // kind 前缀严格：entry 必须 ent_；lexeme 必须 lex_；非法 ID 拒绝。
  let registry = createIdentityRegistry();
  assert.throws(
    () => createEntry(registry, { language: 'en', exactSpelling: 'x', id: 'ent_bad' }),
    /ent_/u,
  );
  assert.throws(
    () =>
      createEntry(registry, {
        language: 'en',
        exactSpelling: 'x',
        id: 'lex_00000001-0000-4000-8000-000000000001',
      }),
    /ent_/u,
  );
  assert.throws(() => createLexeme(registry, { language: 'en', id: ENTRY_ID }), /lex_/u);
  assert.throws(() => createEntry(registry, { language: '', exactSpelling: 'x' }), /language/u);
  assert.throws(
    () =>
      createEntry(registry, {
        language: 'en',
        exactSpelling: 'x',
        applicability: { language: { kind: 'all' } },
      }),
    /适用范围非法/u,
  );

  const lex1 = createLexeme(registry, {
    language: 'en',
    id: 'lex_00000001-0000-4000-8000-000000000000',
  });
  registry = lex1.registry;
  const entryA = createEntry(registry, {
    language: 'en',
    exactSpelling: 'read',
    lexemeId: lex1.lexemeId,
    id: ENTRY_ID,
  });
  registry = entryA.registry;
  // entry 语言必须与所属 lexeme 一致。
  assert.throws(
    () => createEntry(registry, { language: 'de', exactSpelling: 'read', lexemeId: lex1.lexemeId }),
    /语言/u,
  );
  // synthetic class 必须与所属 lexeme 一致；synthetic 必须是真布尔。
  assert.throws(
    () =>
      createEntry(registry, {
        language: 'en',
        exactSpelling: 'read',
        lexemeId: lex1.lexemeId,
        synthetic: true,
      }),
    /synthetic/u,
  );
  assert.throws(
    () => createEntry(registry, { language: 'en', exactSpelling: 'read', synthetic: 'yes' }),
    /布尔/u,
  );
  assert.throws(() => createLexeme(registry, { language: 'en', synthetic: 'no' }), /布尔/u);
  const lex2 = createLexeme(registry, {
    language: 'de',
    id: 'lex_00000002-0000-4000-8000-000000000000',
  });
  registry = lex2.registry;
  const entryB = createEntry(registry, {
    language: 'de',
    exactSpelling: 'read',
    lexemeId: lex2.lexemeId,
    id: 'ent_00000002-0000-4000-8000-000000000002',
  });
  registry = entryB.registry;

  // 单一 byId 真源，无重复注册表。
  assert.equal(registry.entries, undefined);
  assert.equal(registry.lexemes, undefined);
  assert.equal(getEntry(registry, ENTRY_ID).id, ENTRY_ID);
  assert.equal(getLexeme(registry, lex1.lexemeId).kind, 'lexeme');
  assert.equal(listEntries(registry).length, 2);
  assert.equal(listLexemes(registry).length, 2);
  assert.deepEqual(listLexemeEntryIds(registry, lex1.lexemeId), [ENTRY_ID]);

  const lookup = lookupEntryIdsBySpelling(registry, '  READ ');
  assert.equal(lookup.searchKey, 'read');
  assert.deepEqual([...lookup.entryIds].sort(), [entryA.entryId, entryB.entryId].sort());
  assert.equal(buildSpellingIndex(registry).get('read').length, 2);

  // NFKC/大小写碰撞不合并身份：两个同 searchKey 条目各自保留 ID。
  let collision = createIdentityRegistry();
  const c1 = createEntry(collision, {
    language: 'en',
    exactSpelling: 'Ａ',
    id: 'ent_0000000a-0000-4000-8000-00000000000a',
  });
  collision = c1.registry;
  const c2 = createEntry(collision, {
    language: 'en',
    exactSpelling: 'a',
    id: 'ent_0000000b-0000-4000-8000-00000000000b',
  });
  collision = c2.registry;
  assert.equal(normalizeSpellingKey('Ａ'), normalizeSpellingKey('a'));
  assert.equal(buildSpellingIndex(collision).get('a').length, 2);
  assert.notEqual(c1.entryId, c2.entryId);

  // 属性更新不换 ID，旧拼写转 alias；IPA 引用更新不换 ID。
  registry = updateEntryAttributes(registry, ENTRY_ID, {
    exactSpelling: 'read (verb)',
    partOfSpeech: 'verb',
    displayIpaRefs: ['obs-a'],
  });
  assert.equal(getEntry(registry, ENTRY_ID).id, ENTRY_ID);
  assert.equal(getEntry(registry, ENTRY_ID).exactSpelling, 'read (verb)');
  assert.ok(getEntry(registry, ENTRY_ID).aliases.includes('read'));
  registry = updateEntryAttributes(registry, ENTRY_ID, { displayIpaRefs: ['obs-b'] });
  assert.equal(getEntry(registry, ENTRY_ID).id, ENTRY_ID);
  assert.deepEqual(getEntry(registry, ENTRY_ID).displayIpaRefs, ['obs-b']);

  // JSON 往返后派生索引/关联保持。
  const roundTripped = deserializeIdentityRegistry(serializeIdentityRegistry(registry));
  assert.equal(
    validateIdentityRegistry(roundTripped).valid,
    true,
    JSON.stringify(validateIdentityRegistry(roundTripped).issues),
  );
  assert.equal(getEntry(roundTripped, ENTRY_ID).exactSpelling, 'read (verb)');
  assert.deepEqual(listLexemeEntryIds(roundTripped, lex1.lexemeId), [ENTRY_ID]);
  registry = roundTripped;

  // 来源别名：使用带 role 且语言匹配的条目（en alias 不得指向 de entry）。
  let aliasRegistry = createIdentityRegistry();
  const aliasLex = createLexeme(aliasRegistry, {
    language: 'en',
    id: 'lex_00000a01-0000-4000-8000-000000000001',
  });
  aliasRegistry = aliasLex.registry;
  const aliasBase = createEntry(aliasRegistry, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    lexemeId: aliasLex.lexemeId,
    id: 'ent_00000a01-0000-4000-8000-000000000001',
  });
  aliasRegistry = aliasBase.registry;
  const aliasPresent = createEntry(aliasRegistry, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['present'],
    lexemeId: aliasLex.lexemeId,
    id: 'ent_00000a02-0000-4000-8000-000000000002',
  });
  aliasRegistry = aliasPresent.registry;
  const aliasBase2 = createEntry(aliasRegistry, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    lexemeId: aliasLex.lexemeId,
    id: 'ent_00000a04-0000-4000-8000-000000000004',
  });
  aliasRegistry = aliasBase2.registry;
  const deLex = createLexeme(aliasRegistry, {
    language: 'de',
    id: 'lex_00000a03-0000-4000-8000-000000000003',
  });
  aliasRegistry = deLex.registry;
  const deEntry = createEntry(aliasRegistry, {
    language: 'de',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    lexemeId: deLex.lexemeId,
    id: 'ent_00000a03-0000-4000-8000-000000000003',
  });
  aliasRegistry = deEntry.registry;

  // 同页不同 role 是独立 alias。
  let aliased = addSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_1',
    role: 'base',
    entryId: aliasBase.entryId,
    evidenceRefs: ['ev-1'],
  });
  assert.equal(aliased.action, 'added');
  aliasRegistry = aliased.registry;
  aliased = addSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_1',
    role: 'present',
    entryId: aliasPresent.entryId,
    evidenceRefs: ['ev-2'],
  });
  assert.equal(aliased.action, 'added', '同页不同 role 不应 conflict');
  aliasRegistry = aliased.registry;
  // 同定位键不同条目 → conflict。
  assert.equal(
    addSourceAlias(aliasRegistry, {
      sourceSite: 'wiktionary',
      language: 'en',
      pageSpelling: 'read',
      anchor: 'Etymology_1',
      role: 'base',
      entryId: aliasBase2.entryId,
      evidenceRefs: ['ev-3'],
    }).action,
    'conflict',
  );
  // locator language/role 必须与目标身份兼容。
  assert.equal(
    addSourceAlias(aliasRegistry, {
      sourceSite: 'wiktionary',
      language: 'en',
      pageSpelling: 'read',
      anchor: 'Etymology_1',
      role: 'base',
      entryId: deEntry.entryId,
      evidenceRefs: ['ev-4'],
    }).action,
    'invalid',
    'en alias 不得指向 de entry',
  );
  assert.equal(
    addSourceAlias(aliasRegistry, {
      sourceSite: 'wiktionary',
      language: 'en',
      pageSpelling: 'read',
      anchor: 'Etymology_1',
      role: 'past',
      entryId: aliasBase.entryId,
      evidenceRefs: ['ev-5'],
    }).action,
    'invalid',
    'role 必须属于目标条目',
  );

  // addSourceAlias 与 reconcile 统一：相关 locator（同 site/lang/spelling/role，不同 anchor/路径）
  // 必须 pending 保旧，不得直接 confirmed；重复 pending 不回 confirmed。
  const addRelated = addSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_1_alt',
    role: 'base',
    entryId: aliasBase.entryId,
    evidenceRefs: ['ev-add-related'],
  });
  assert.equal(addRelated.action, 'review-required', '相关 locator 变化必须 pending');
  aliasRegistry = addRelated.registry;
  assert.equal(
    aliasRegistry.sourceAliases.find((a) => a.anchor === 'Etymology_1_alt').status,
    'pending-review',
  );
  assert.equal(
    aliasRegistry.sourceAliases.find((a) => a.anchor === 'Etymology_1' && a.role === 'base').status,
    'confirmed',
    '旧 confirmed 记录必须保留',
  );
  const addPendingAgain = addSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_1_alt',
    role: 'base',
    entryId: aliasBase.entryId,
    evidenceRefs: ['ev-add-related-2'],
  });
  assert.equal(addPendingAgain.action, 'exists');
  aliasRegistry = addPendingAgain.registry;
  assert.equal(
    aliasRegistry.sourceAliases.find((a) => a.anchor === 'Etymology_1_alt').status,
    'pending-review',
  );

  // 锚点变化 → pending，不自动确认；重复 pending 仍 pending。
  const beforeAliasCount = aliasRegistry.sourceAliases.length;
  let reconciled = reconcileSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_2',
    role: 'base',
    entryId: aliasBase.entryId,
    anchorChanged: true,
    evidenceRefs: ['ev-6'],
  });
  assert.equal(reconciled.action, 'review-required');
  aliasRegistry = reconciled.registry;
  assert.equal(aliasRegistry.sourceAliases.length, beforeAliasCount + 1);
  assert.equal(
    aliasRegistry.sourceAliases.find(
      (alias) => alias.anchor === 'Etymology_2' && alias.role === 'base',
    ).status,
    'pending-review',
  );
  assert.equal(
    aliasRegistry.sourceAliases.find(
      (alias) => alias.anchor === 'Etymology_1' && alias.role === 'base',
    ).status,
    'confirmed',
  );
  // 精确重复 pending：不得变 confirmed / rebound。
  reconciled = reconcileSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_2',
    role: 'base',
    entryId: aliasBase.entryId,
    anchorChanged: false,
    evidenceRefs: ['ev-7'],
  });
  assert.equal(reconciled.action, 'review-required');
  aliasRegistry = reconciled.registry;
  assert.equal(
    aliasRegistry.sourceAliases.find(
      (alias) => alias.anchor === 'Etymology_2' && alias.role === 'base',
    ).status,
    'pending-review',
  );
  // scopePath 变化：同页同 role 相关仍被识别 → pending，而非 bound。
  reconciled = reconcileSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_1',
    scopePath: ['English', 'Pronunciation'],
    role: 'base',
    entryId: aliasBase.entryId,
    anchorChanged: false,
    evidenceRefs: ['ev-8'],
  });
  assert.equal(reconciled.action, 'review-required');
  aliasRegistry = reconciled.registry;
  // 无证据 → invalid。
  assert.equal(
    reconcileSourceAlias(aliasRegistry, {
      sourceSite: 'wiktionary',
      language: 'en',
      pageSpelling: 'read',
      anchor: 'Etymology_3',
      role: 'base',
      entryId: aliasBase.entryId,
      anchorChanged: true,
      evidenceRefs: [],
    }).action,
    'invalid',
  );
  // 明确确认必须有非空新证据。
  const pendingLocator = {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_2',
    role: 'base',
  };
  assert.equal(
    confirmSourceAlias(aliasRegistry, pendingLocator, aliasBase.entryId, []).action,
    'missing-evidence',
  );
  // 空白/坏 evidence ref 同样拒绝，不得冒充新 confirmation。
  assert.equal(
    confirmSourceAlias(aliasRegistry, pendingLocator, aliasBase.entryId, ['   ']).action,
    'missing-evidence',
  );
  assert.equal(
    confirmSourceAlias(aliasRegistry, pendingLocator, aliasBase.entryId, ['ev-ok', '']).action,
    'missing-evidence',
  );
  // 只重复既有证据、无实质新证据 → 不得冒充新 confirmation。
  const pendingExistingEvidence = aliasRegistry.sourceAliases.find(
    (alias) => alias.anchor === 'Etymology_2' && alias.role === 'base',
  ).evidenceRefs[0];
  assert.equal(
    confirmSourceAlias(aliasRegistry, pendingLocator, aliasBase.entryId, [pendingExistingEvidence])
      .action,
    'missing-evidence',
  );
  const confirmed = confirmSourceAlias(aliasRegistry, pendingLocator, aliasBase.entryId, ['ev-9']);
  assert.equal(confirmed.action, 'confirmed');
  aliasRegistry = confirmed.registry;
  assert.equal(
    aliasRegistry.sourceAliases.find(
      (alias) => alias.anchor === 'Etymology_2' && alias.role === 'base',
    ).status,
    'confirmed',
  );
  // 再次确认已 confirmed → unchanged；错目标 → invalid。
  assert.equal(
    confirmSourceAlias(aliasRegistry, pendingLocator, aliasBase.entryId, ['ev-10']).action,
    'unchanged',
  );
  assert.equal(
    confirmSourceAlias(aliasRegistry, pendingLocator, deEntry.entryId, ['ev-11']).action,
    'invalid',
  );
  // reconcile 精确 locator 却声明 anchorChanged=true：不得走快捷 confirmed，须转 pending 待核。
  const shortcut = reconcileSourceAlias(aliasRegistry, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'read',
    anchor: 'Etymology_2',
    role: 'base',
    entryId: aliasBase.entryId,
    anchorChanged: true,
    evidenceRefs: ['ev-12'],
  });
  assert.equal(
    shortcut.action,
    'review-required',
    'anchorChanged 精确 locator 不得捷径直返 confirmed',
  );
  assert.equal(
    shortcut.registry.sourceAliases.find(
      (alias) => alias.anchor === 'Etymology_2' && alias.role === 'base',
    ).status,
    'pending-review',
  );

  // 校验：非法结构被拒且不 throw。
  assert.equal(
    validateIdentityRegistry(aliasRegistry).valid,
    true,
    JSON.stringify(validateIdentityRegistry(aliasRegistry).issues),
  );
  assert.equal(validateIdentityRegistry(null).valid, false);
  assert.equal(validateIdentityRegistry(42).valid, false);
  assert.doesNotThrow(() => validateIdentityRegistry({ schema: 'x', byId: null }));
  const danglingLexeme = clone(aliasRegistry);
  delete danglingLexeme.byId[aliasLex.lexemeId];
  assert.equal(validateIdentityRegistry(danglingLexeme).valid, false);
  const missingFields = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: { [ENTRY_ID]: { id: ENTRY_ID, kind: 'entry' } },
    sourceAliases: [],
  };
  assert.equal(validateIdentityRegistry(missingFields).valid, false);
  // 别名重复 / 冲突 / pending 无证据 / locator 不兼容。
  const dupAliases = clone(aliasRegistry);
  dupAliases.sourceAliases.push(clone(dupAliases.sourceAliases[0]));
  assert.equal(validateIdentityRegistry(dupAliases).valid, false);
  const conflictAliases = clone(aliasRegistry);
  conflictAliases.sourceAliases.push({
    ...clone(conflictAliases.sourceAliases[0]),
    entryId: aliasPresent.entryId,
  });
  assert.equal(validateIdentityRegistry(conflictAliases).valid, false);
  const pendingNoEvidence = clone(aliasRegistry);
  pendingNoEvidence.sourceAliases.find((alias) => alias.status === 'pending-review').evidenceRefs =
    [];
  assert.equal(validateIdentityRegistry(pendingNoEvidence).valid, false);
  const incompatibleAlias = clone(aliasRegistry);
  incompatibleAlias.sourceAliases[0].language = 'de';
  assert.equal(validateIdentityRegistry(incompatibleAlias).valid, false);
  const badHistory = clone(aliasRegistry);
  badHistory.history = [{ action: 'nope' }];
  assert.equal(validateIdentityRegistry(badHistory).valid, false);

  // =========================================================================
  // 2.3 read 四角色：幂等、按需补、合成/真实区分、共享证据
  // =========================================================================

  let readSeq = 100;
  const readFactory = (kind) => {
    const hex = (readSeq++).toString(16).padStart(8, '0');
    return `${kind === 'entry' ? 'ent' : 'lex'}_${hex}-0000-4000-8000-000000000000`;
  };

  let readRegistry = createIdentityRegistry();
  const read = establishReadIdentities(readRegistry, {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    multiRoleEvidence: { evidenceRefs: ['synthetic:read-multi'], roles: READ_ROLE_ORDER },
    idFactory: readFactory,
  });
  readRegistry = read.registry;
  assert.deepEqual(read.missingRoles, []);
  assert.deepEqual([...read.reusedRoles], []);
  assert.equal(new Set(Object.values(read.ids)).size, 4, '四角色各自独立 ID');
  assert.notEqual(read.ids.base, read.ids.present);
  assert.notEqual(read.ids.past, read.ids['past-participle']);
  assert.ok(read.lexemeId);
  for (const role of READ_ROLE_ORDER) {
    const entry = getEntry(readRegistry, read.ids[role]);
    assert.deepEqual(entry.grammarRoles, [role]);
    assert.equal(entry.lexemeId, read.lexemeId);
    assert.equal(entry.partOfSpeech, 'verb');
    assert.equal(entry.synthetic, true);
  }
  assert.equal(listLexemeEntryIds(readRegistry, read.lexemeId).length, 4);

  // 幂等：JSON 往返后再次建立复用原 4 ID，不新增。
  const readReloaded = deserializeIdentityRegistry(serializeIdentityRegistry(readRegistry));
  const again = establishReadIdentities(readReloaded, {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    multiRoleEvidence: { evidenceRefs: ['synthetic:read-multi'], roles: READ_ROLE_ORDER },
    idFactory: readFactory,
  });
  assert.deepEqual(again.createdRoles, []);
  assert.deepEqual([...again.reusedRoles].sort(), [...READ_ROLE_ORDER].sort());
  for (const role of READ_ROLE_ORDER) {
    assert.equal(again.ids[role], read.ids[role], `角色 ${role} 应复用原 ID`);
  }
  readRegistry = again.registry;

  // 4 role 别名真实往返：每 role 独立 alias，序列化/反序列化后仍各自存活。
  let roleAliasRegistry = readRegistry;
  for (const role of READ_ROLE_ORDER) {
    const added = addSourceAlias(roleAliasRegistry, {
      sourceSite: 'wiktionary',
      language: 'en',
      pageSpelling: 'read',
      anchor: `Etymology_${role}`,
      role,
      entryId: read.ids[role],
      evidenceRefs: [`ev-alias-${role}`],
    });
    assert.equal(added.action, 'added', `role ${role} alias 应独立 added`);
    roleAliasRegistry = added.registry;
  }
  const roleAliasReloaded = deserializeIdentityRegistry(
    serializeIdentityRegistry(roleAliasRegistry),
  );
  assert.equal(
    validateIdentityRegistry(roleAliasReloaded).valid,
    true,
    JSON.stringify(validateIdentityRegistry(roleAliasReloaded).issues),
  );
  assert.equal(roleAliasReloaded.sourceAliases.length, 4);
  for (const role of READ_ROLE_ORDER) {
    const record = roleAliasReloaded.sourceAliases.find((alias) => alias.role === role);
    assert.ok(record, `role ${role} alias 必须往返存活`);
    assert.equal(record.entryId, read.ids[role]);
    assert.equal(record.status, 'confirmed');
  }

  // multiRoleEvidence 只认证列出的 role；base-only / past-only 不认证其他。
  const onlyBasePresent = establishReadIdentities(createIdentityRegistry(), {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    multiRoleEvidence: { evidenceRefs: ['synthetic:bp'], roles: ['base', 'present'] },
    idFactory: readFactory,
  });
  assert.deepEqual([...onlyBasePresent.createdRoles].sort(), ['base', 'present']);
  assert.deepEqual([...onlyBasePresent.missingRoles].sort(), ['past', 'past-participle']);
  const baseOnly = establishReadIdentities(createIdentityRegistry(), {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    evidenceByRole: { base: ['synthetic:base'] },
    idFactory: readFactory,
  });
  assert.deepEqual(baseOnly.createdRoles, ['base']);
  assert.ok(baseOnly.missingRoles.includes('present'));
  const pastOnly = establishReadIdentities(createIdentityRegistry(), {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    evidenceByRole: { past: ['synthetic:past'] },
    idFactory: readFactory,
  });
  assert.deepEqual(pastOnly.createdRoles, ['past']);
  assert.ok(pastOnly.missingRoles.includes('past-participle'));

  // 缺角色在充分证据下按需补（复用既有 base）。
  let partial = createIdentityRegistry();
  const partialLex = createLexeme(partial, { language: 'en', synthetic: true }, readFactory);
  partial = partialLex.registry;
  const partialBase = createEntry(
    partial,
    {
      language: 'en',
      exactSpelling: 'read',
      grammarRoles: ['base'],
      partOfSpeech: 'verb',
      lexemeId: partialLex.lexemeId,
      evidenceRefs: ['synthetic:read-role'],
      synthetic: true,
    },
    readFactory,
  );
  partial = partialBase.registry;
  const toppedUp = establishReadIdentities(partial, {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    evidenceByRole: {
      present: ['synthetic:present'],
      past: ['synthetic:past'],
      'past-participle': ['synthetic:pp'],
    },
    idFactory: readFactory,
  });
  partial = toppedUp.registry;
  assert.deepEqual([...toppedUp.reusedRoles], ['base']);
  assert.deepEqual([...toppedUp.createdRoles].sort(), ['past', 'past-participle', 'present']);
  assert.deepEqual(toppedUp.missingRoles, []);
  assert.equal(toppedUp.ids.base, partialBase.entryId);

  // 缺证据时不补、不铸造无据 lexeme。
  const noEvidence = establishReadIdentities(createIdentityRegistry(), {
    spelling: 'zilch',
    synthetic: false,
    idFactory: readFactory,
  });
  assert.equal(noEvidence.lexemeId, undefined, '无证据不得铸造 lexeme');
  assert.equal(Object.keys(noEvidence.ids).length, 0);
  assert.deepEqual([...noEvidence.missingRoles].sort(), [...READ_ROLE_ORDER].sort());
  assert.equal(Object.keys(noEvidence.registry.byId).length, 0);

  // 真实条目不得使用 synthetic 证据；真实证据下不置 synthetic。
  assert.throws(
    () =>
      establishReadIdentities(createIdentityRegistry(), {
        spelling: 'real',
        synthetic: false,
        multiRoleEvidence: { evidenceRefs: ['synthetic:x'], roles: READ_ROLE_ORDER },
        idFactory: readFactory,
      }),
    /synthetic/u,
  );
  const real = establishReadIdentities(createIdentityRegistry(), {
    spelling: 'real',
    synthetic: false,
    multiRoleEvidence: { evidenceRefs: ['ev-real-1'], roles: READ_ROLE_ORDER },
    idFactory: readFactory,
  });
  assert.equal(
    getEntry(real.registry, real.ids.base).synthetic,
    false,
    '真实条目须显式非 synthetic',
  );

  // 复用必须排除 retired / merged（含其 lexeme 不作为唯一来源复用）。
  const RL = 'lex_00000b01-0000-4000-8000-000000000001';
  const RB = 'ent_00000b01-0000-4000-8000-000000000001';
  const RC = 'ent_00000b02-0000-4000-8000-000000000002';
  const retiredFixture = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      [RL]: { id: RL, kind: 'lexeme', language: 'en' },
      [RB]: {
        id: RB,
        kind: 'entry',
        language: 'en',
        exactSpelling: 'read',
        aliases: [],
        grammarRoles: ['base'],
        lexemeId: RL,
        status: 'retired',
        successorIds: [],
        redirectTo: RC,
        retiredReason: '旧身份合并',
        evidenceRefs: [],
      },
      [RC]: {
        id: RC,
        kind: 'entry',
        language: 'en',
        exactSpelling: 'read2',
        aliases: [],
        grammarRoles: ['base'],
        lexemeId: RL,
        status: 'active',
        successorIds: [],
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
    history: [],
  };
  assert.equal(
    validateIdentityRegistry(retiredFixture).valid,
    true,
    JSON.stringify(validateIdentityRegistry(retiredFixture).issues),
  );
  const retiredRe = establishReadIdentities(
    deserializeIdentityRegistry(JSON.stringify(retiredFixture)),
    {
      spelling: 'read',
      language: 'en',
      synthetic: true,
      multiRoleEvidence: { evidenceRefs: ['synthetic:read'], roles: READ_ROLE_ORDER },
      idFactory: readFactory,
    },
  );
  assert.notEqual(retiredRe.ids.base, RB, 'retired base 不得被复用');
  assert.notEqual(retiredRe.lexemeId, RL, 'retired 唯一来源不得复用其 lexeme');

  // 多个合法 lexeme 不得任取 first。
  let multiLex = createIdentityRegistry();
  const ml1 = createLexeme(multiLex, {
    language: 'en',
    synthetic: true,
    id: 'lex_00000c01-0000-4000-8000-000000000001',
  });
  multiLex = ml1.registry;
  const ml2 = createLexeme(multiLex, {
    language: 'en',
    synthetic: true,
    id: 'lex_00000c02-0000-4000-8000-000000000002',
  });
  multiLex = ml2.registry;
  const me1 = createEntry(multiLex, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    partOfSpeech: 'verb',
    evidenceRefs: ['synthetic:x'],
    synthetic: true,
    lexemeId: ml1.lexemeId,
    id: 'ent_00000c01-0000-4000-8000-000000000001',
  });
  multiLex = me1.registry;
  const me2 = createEntry(multiLex, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    partOfSpeech: 'verb',
    evidenceRefs: ['synthetic:y'],
    synthetic: true,
    lexemeId: ml2.lexemeId,
    id: 'ent_00000c02-0000-4000-8000-000000000002',
  });
  multiLex = me2.registry;
  assert.throws(
    () =>
      establishReadIdentities(multiLex, {
        spelling: 'read',
        language: 'en',
        synthetic: true,
        multiRoleEvidence: { evidenceRefs: ['synthetic:read'], roles: READ_ROLE_ORDER },
        idFactory: readFactory,
      }),
    /多个合格 verb lexeme/u,
  );

  // noun lexeme / 无据身份不得复用：应新建 verb lexeme。
  let nounReg = createIdentityRegistry();
  const nounLex = createLexeme(nounReg, {
    language: 'en',
    id: 'lex_00000d01-0000-4000-8000-000000000001',
  });
  nounReg = nounLex.registry;
  const nounEntry = createEntry(nounReg, {
    language: 'en',
    exactSpelling: 'read',
    partOfSpeech: 'noun',
    lexemeId: nounLex.lexemeId,
    id: 'ent_00000d01-0000-4000-8000-000000000001',
  });
  nounReg = nounEntry.registry;
  const nounReuse = establishReadIdentities(nounReg, {
    spelling: 'read',
    language: 'en',
    synthetic: true,
    multiRoleEvidence: { evidenceRefs: ['synthetic:read'], roles: READ_ROLE_ORDER },
    idFactory: readFactory,
  });
  assert.notEqual(nounReuse.lexemeId, nounLex.lexemeId, 'noun lexeme 不得复用');
  for (const role of READ_ROLE_ORDER) {
    assert.notEqual(getEntry(nounReuse.registry, nounReuse.ids[role]).lexemeId, nounLex.lexemeId);
  }

  // 只允许 verb：把 read 四 role 造成 noun 被拒。
  assert.throws(
    () =>
      establishReadIdentities(createIdentityRegistry(), {
        spelling: 'read',
        language: 'en',
        synthetic: true,
        partOfSpeech: 'noun',
        multiRoleEvidence: { evidenceRefs: ['synthetic:read'], roles: READ_ROLE_ORDER },
        idFactory: readFactory,
      }),
    /partOfSpeech 只能为 verb/u,
  );

  // synthetic 与真实复用不得混标：真实请求不得复用 synthetic 身份。
  const realNoReuse = establishReadIdentities(readRegistry, {
    spelling: 'read',
    language: 'en',
    synthetic: false,
    multiRoleEvidence: { evidenceRefs: ['ev-real'], roles: READ_ROLE_ORDER },
    idFactory: readFactory,
  });
  for (const role of READ_ROLE_ORDER) {
    assert.notEqual(realNoReuse.ids[role], read.ids[role], '真实请求不得复用 synthetic 身份');
  }

  // 混标必须被 validator 拒：real lexeme + synthetic entry；且 read 不得复用该身份。
  const MIX_L = 'lex_00000f01-0000-4000-8000-000000000001';
  const MIX_E = 'ent_00000f01-0000-4000-8000-000000000001';
  const mixedRegistry = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      [MIX_L]: { id: MIX_L, kind: 'lexeme', language: 'en' },
      [MIX_E]: {
        id: MIX_E,
        kind: 'entry',
        language: 'en',
        exactSpelling: 'read',
        aliases: [],
        grammarRoles: ['base'],
        partOfSpeech: 'verb',
        lexemeId: MIX_L,
        status: 'active',
        successorIds: [],
        evidenceRefs: ['synthetic:mix'],
        synthetic: true,
      },
    },
    sourceAliases: [],
  };
  assert.equal(
    validateIdentityRegistry(mixedRegistry).valid,
    false,
    'real lexeme + synthetic entry 混标必须被拒',
  );
  const mixedReuse = establishReadIdentities(
    deserializeIdentityRegistry(JSON.stringify(mixedRegistry)),
    {
      spelling: 'read',
      language: 'en',
      synthetic: true,
      multiRoleEvidence: { evidenceRefs: ['synthetic:read'], roles: READ_ROLE_ORDER },
      idFactory: readFactory,
    },
  );
  assert.notEqual(mixedReuse.ids.base, MIX_E, '混标 lexeme 不得复用');
  assert.notEqual(mixedReuse.lexemeId, MIX_L, '混标 lexeme 不得复用');

  // 四 role 分别设置不同 IPA 引用，互不覆盖；相同 IPA 不合并 ID。
  let ipaRegistry = readRegistry;
  for (const role of READ_ROLE_ORDER) {
    ipaRegistry = updateEntryAttributes(ipaRegistry, read.ids[role], {
      displayIpaRefs: [`ipa:${role}`],
    });
  }
  for (const role of READ_ROLE_ORDER) {
    assert.deepEqual(getEntry(ipaRegistry, read.ids[role]).displayIpaRefs, [`ipa:${role}`]);
  }
  let sameIpa = updateEntryAttributes(readRegistry, read.ids.base, {
    displayIpaRefs: ['ipa:same'],
  });
  sameIpa = updateEntryAttributes(sameIpa, read.ids.present, { displayIpaRefs: ['ipa:same'] });
  assert.notEqual(
    getEntry(sameIpa, read.ids.base).id,
    getEntry(sameIpa, read.ids.present).id,
    '相同 IPA 不合并 ID',
  );

  // 多角色共享证据：正例（完整 8 维明确，覆盖 base+present 真实 target）。
  const shareEvidence = ['ev-shared'];
  // entry 维必须覆盖真实 target ID；target entry 无 sense/accent/other 权威值 → 证据须 explicit-all。
  const sharedScope = scopeWith({
    language: knownScope(['en']),
    entry: knownScope([read.ids.base, read.ids.present]),
    lexeme: knownScope([read.lexemeId]),
    role: knownScope(['base', 'present']),
    pos: knownScope(['verb']),
    sense: explicitAllScope(shareEvidence),
    accent: explicitAllScope(shareEvidence),
    other: explicitAllScope(shareEvidence),
  });
  const shared = shareRoleEvidence(readRegistry, read.lexemeId, {
    observationId: 'obs-shared',
    roles: ['base', 'present'],
    applicability: sharedScope,
    evidenceRefs: shareEvidence,
  });
  assert.deepEqual([...shared.entryIds].sort(), [read.ids.base, read.ids.present].sort());
  assert.ok(getEntry(shared.registry, read.ids.base).sharedObservationIds.includes('obs-shared'));
  // 正面：entry.applicability 已有 sense reading/accent US，source 精确 8 维 multi-role → 必须共享。
  let fullReadReg = readRegistry;
  fullReadReg = updateEntryAttributes(fullReadReg, read.ids.base, {
    applicability: fullScope(read.ids.base, read.lexemeId, {
      role: knownScope(['base']),
      pos: knownScope(['verb']),
      sense: knownScope(['reading']),
      accent: knownScope(['US']),
      other: knownScope(['none']),
    }),
  });
  fullReadReg = updateEntryAttributes(fullReadReg, read.ids.present, {
    applicability: fullScope(read.ids.present, read.lexemeId, {
      role: knownScope(['present']),
      pos: knownScope(['verb']),
      sense: knownScope(['reading']),
      accent: knownScope(['US']),
      other: knownScope(['none']),
    }),
  });
  const exactSource = scopeWith({
    language: knownScope(['en']),
    entry: knownScope([read.ids.base, read.ids.present]),
    lexeme: knownScope([read.lexemeId]),
    role: knownScope(['base', 'present']),
    pos: knownScope(['verb']),
    sense: knownScope(['reading']),
    accent: knownScope(['US']),
    other: knownScope(['none']),
  });
  const exactShared = shareRoleEvidence(fullReadReg, read.lexemeId, {
    observationId: 'obs-exact',
    roles: ['base', 'present'],
    applicability: exactSource,
    evidenceRefs: ['ev-exact'],
  });
  assert.deepEqual(
    [...exactShared.entryIds].sort(),
    [read.ids.base, read.ids.present].sort(),
    'entry.applicability 已有 sense/accent 时精确 8 维必须共享',
  );
  // 但 source sense 与 entry 已有 sense 冲突 → 不共享。
  const conflictingSenseSource = scopeWith({
    language: knownScope(['en']),
    entry: knownScope([read.ids.base]),
    lexeme: knownScope([read.lexemeId]),
    role: knownScope(['base']),
    pos: knownScope(['verb']),
    sense: knownScope(['color']),
    accent: knownScope(['US']),
    other: knownScope(['none']),
  });
  assert.equal(
    shareRoleEvidence(fullReadReg, read.lexemeId, {
      observationId: 'obs-sense-conflict',
      roles: ['base'],
      applicability: conflictingSenseSource,
      evidenceRefs: ['ev'],
    }).entryIds.length,
    0,
  );
  // 反例：来源只覆盖 base role，不能分享给 present（past-only 同理）。
  const baseOnlyScope = scopeWith({
    language: knownScope(['en']),
    entry: knownScope([read.ids.base]),
    lexeme: knownScope([read.lexemeId]),
    role: knownScope(['base']),
    pos: knownScope(['verb']),
    sense: explicitAllScope(['ev-base-only']),
    accent: explicitAllScope(['ev-base-only']),
    other: explicitAllScope(['ev-base-only']),
  });
  const rejected = shareRoleEvidence(readRegistry, read.lexemeId, {
    observationId: 'obs-base-only',
    roles: ['base', 'present'],
    applicability: baseOnlyScope,
    evidenceRefs: ['ev-base-only'],
  });
  assert.ok(rejected.uncoveredRoles.includes('present'));
  assert.equal(rejected.entryIds.length, 0);
  assert.equal(getEntry(rejected.registry, read.ids.present).sharedObservationIds, undefined);
  // 单候选也必须逐维证明覆盖：source verb/reading/UK 与 target verb/…不匹配 → 不共享。
  const mismatchedSingleScope = scopeWith({
    language: knownScope(['en']),
    entry: knownScope([read.ids.base]),
    lexeme: knownScope([read.lexemeId]),
    role: knownScope(['base']),
    pos: knownScope(['noun']),
    sense: knownScope(['reading']),
    accent: knownScope(['UK']),
    other: explicitAllScope(['ev']),
  });
  const mismatched = shareRoleEvidence(readRegistry, read.lexemeId, {
    observationId: 'obs-mismatch',
    roles: ['base'],
    applicability: mismatchedSingleScope,
    evidenceRefs: ['ev'],
  });
  assert.equal(mismatched.entryIds.length, 0, '单候选也不得绕过 8 维覆盖核对');
  assert.ok(mismatched.uncoveredRoles.includes('base'));
  assert.equal(getEntry(mismatched.registry, read.ids.base).sharedObservationIds, undefined);
  // unknown 维度不是 wildcard：不得共享。
  const unknownDimScope = fullScope(read.ids.base, read.lexemeId, {
    sense: unknownScope('未注明词义'),
  });
  assert.equal(
    shareRoleEvidence(readRegistry, read.lexemeId, {
      observationId: 'obs-unknown',
      roles: ['base'],
      applicability: unknownDimScope,
      evidenceRefs: ['ev'],
    }).entryIds.length,
    0,
  );
  // lexeme 不匹配不得共享（旧的 lex-test/noun/color/US 正例不再放行）。
  const wrongLexemeScope = fullScope(read.ids.base, 'lex_99999999-0000-4000-8000-000000000000', {
    role: knownScope(['base']),
  });
  assert.equal(
    shareRoleEvidence(readRegistry, read.lexemeId, {
      observationId: 'obs-wrong-lexeme',
      roles: ['base'],
      applicability: wrongLexemeScope,
      evidenceRefs: ['ev'],
    }).uncoveredRoles.includes('base'),
    true,
  );
  // language 不匹配不得共享。
  assert.equal(
    shareRoleEvidence(readRegistry, read.lexemeId, {
      observationId: 'obs-wrong-lang',
      roles: ['base'],
      applicability: fullScope(read.ids.base, read.lexemeId, {
        language: knownScope(['de']),
        role: knownScope(['base']),
      }),
      evidenceRefs: ['ev'],
    }).uncoveredRoles.includes('base'),
    true,
  );
  // 同 role 多条：一 covered、一 unknown 未确定 disjoint → 不得声称唯一。
  let multiRoleReg = createIdentityRegistry();
  const mrLex = createLexeme(multiRoleReg, {
    language: 'en',
    id: 'lex_00000e01-0000-4000-8000-000000000001',
  });
  multiRoleReg = mrLex.registry;
  const mr1 = createEntry(multiRoleReg, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    partOfSpeech: 'verb',
    lexemeId: mrLex.lexemeId,
    id: 'ent_00000e01-0000-4000-8000-000000000001',
  });
  multiRoleReg = mr1.registry;
  const mr2 = createEntry(multiRoleReg, {
    language: 'en',
    exactSpelling: 'read',
    grammarRoles: ['base'],
    lexemeId: mrLex.lexemeId,
    id: 'ent_00000e02-0000-4000-8000-000000000002',
  });
  multiRoleReg = mr2.registry;
  const multiSource = scopeWith({
    language: knownScope(['en']),
    entry: explicitAllScope(['ev']),
    lexeme: knownScope([mrLex.lexemeId]),
    role: knownScope(['base']),
    pos: knownScope(['verb']),
    sense: explicitAllScope(['ev']),
    accent: explicitAllScope(['ev']),
    other: explicitAllScope(['ev']),
  });
  const multiShare = shareRoleEvidence(multiRoleReg, mrLex.lexemeId, {
    observationId: 'obs-multi',
    roles: ['base'],
    applicability: multiSource,
    evidenceRefs: ['ev'],
  });
  assert.equal(multiShare.entryIds.length, 0, '一 covered 一 unknown 不得声称唯一');
  assert.ok(multiShare.uncoveredRoles.includes('base'));

  // =========================================================================
  // 2.4 merge / split：完整覆盖、唯一性、scope.entry 重映射、历史持久
  // =========================================================================

  let mergeSeq = 200;
  const mergeFactory = (kind) => {
    const hex = (mergeSeq++).toString(16).padStart(8, '0');
    return `${kind === 'entry' ? 'ent' : 'lex'}_${hex}-0000-4000-8000-000000000000`;
  };
  let mergeRegistry = createIdentityRegistry();
  const mergeLex = createLexeme(mergeRegistry, { language: 'en' }, mergeFactory);
  mergeRegistry = mergeLex.registry;
  // canonical 范围更宽（accent US+UK），用于验证迁移不缩小来源条件。
  const canonicalScope = fullScope('ent_00000000-0000-4000-8000-0000000000ca', mergeLex.lexemeId, {
    accent: knownScope(['US', 'UK']),
  });
  const canonical = createEntry(
    mergeRegistry,
    {
      language: 'en',
      exactSpelling: 'color',
      lexemeId: mergeLex.lexemeId,
      applicability: canonicalScope,
    },
    mergeFactory,
  );
  mergeRegistry = canonical.registry;
  const variant = createEntry(
    mergeRegistry,
    { language: 'en', exactSpelling: 'colour', lexemeId: mergeLex.lexemeId },
    mergeFactory,
  );
  mergeRegistry = variant.registry;

  const subsetScope = fullScope(variant.entryId, mergeLex.lexemeId, { accent: knownScope(['US']) });
  const partialScope = fullScope(variant.entryId, mergeLex.lexemeId, {
    accent: knownScope(['US', 'AU']),
  });
  const conflictScope = fullScope(variant.entryId, mergeLex.lexemeId, {
    pos: knownScope(['verb']),
  });
  const unknownScopeC = fullScope(variant.entryId, mergeLex.lexemeId, {
    sense: unknownScope('未注明词义'),
  });
  const multiEntryScope = fullScope(variant.entryId, mergeLex.lexemeId, {
    entry: knownScope([variant.entryId, canonical.entryId]),
  });
  const mergeCorrections = [
    {
      correctionId: 'corr-subset',
      targetEntryId: variant.entryId,
      scope: subsetScope,
      fingerprint: 'fp-subset',
    },
    {
      correctionId: 'corr-partial',
      targetEntryId: variant.entryId,
      scope: partialScope,
      fingerprint: 'fp-partial',
    },
    {
      correctionId: 'corr-conflict',
      targetEntryId: variant.entryId,
      scope: conflictScope,
      fingerprint: 'fp-conflict',
    },
    {
      correctionId: 'corr-unknown',
      targetEntryId: variant.entryId,
      scope: unknownScopeC,
      fingerprint: 'fp-unknown',
    },
    {
      correctionId: 'corr-multientry',
      targetEntryId: variant.entryId,
      scope: multiEntryScope,
      fingerprint: 'fp-multi',
    },
  ];
  const merged = mergeEntries(mergeRegistry, mergeCorrections, {
    canonicalId: canonical.entryId,
    mergedIds: [variant.entryId],
    reason: '同一 lexeme 拼写变体，有来源证据',
    evidenceRefs: ['ev-merge'],
  });
  mergeRegistry = merged.registry;
  assert.equal(getEntry(mergeRegistry, variant.entryId).status, 'retired');
  assert.equal(getEntry(mergeRegistry, variant.entryId).redirectTo, canonical.entryId);
  assert.deepEqual(merged.audit.migratedCorrectionIds, ['corr-subset']);
  assert.deepEqual([...merged.audit.unresolvedCorrectionIds].sort(), [
    'corr-conflict',
    'corr-multientry',
    'corr-partial',
    'corr-unknown',
  ]);
  const migratedCorrection = merged.corrections.find((item) => item.correctionId === 'corr-subset');
  assert.equal(migratedCorrection.targetEntryId, canonical.entryId);
  // scope.entry 重映射到 canonical，其他维度保持（accent 仍只 US，不放大/缩小）。
  assert.deepEqual(migratedCorrection.scope.entry, knownScope([canonical.entryId]));
  assert.deepEqual(migratedCorrection.scope.accent, knownScope(['US']));
  // 交集非完整覆盖 / 冲突 / unknown / 多值 entry 均不迁移。
  assert.equal(
    merged.decisions.find((item) => item.correctionId === 'corr-partial').migrate,
    false,
  );
  assert.equal(
    merged.decisions.find((item) => item.correctionId === 'corr-multientry').migrate,
    false,
  );
  // 历史持久：registry.history 保留旧 scope/target/fingerprint/decisions。
  assert.equal(mergeRegistry.history.length, 1);
  const mergeHistory = mergeRegistry.history[0];
  assert.equal(mergeHistory.action, 'merge');
  const subsetDecision = mergeHistory.decisions.find((item) => item.correctionId === 'corr-subset');
  assert.equal(subsetDecision.previousFingerprint, 'fp-subset');
  assert.deepEqual(subsetDecision.previousScope.entry, knownScope([variant.entryId]));
  assert.equal(subsetDecision.resultingTargetEntryId, canonical.entryId);
  assert.equal(
    validateIdentityRegistry(mergeRegistry).valid,
    true,
    JSON.stringify(validateIdentityRegistry(mergeRegistry).issues),
  );
  assert.throws(
    () =>
      mergeEntries(mergeRegistry, [], {
        canonicalId: canonical.entryId,
        mergedIds: [variant.entryId],
        reason: 'r',
        evidenceRefs: [],
      }),
    /必须有身份证据/u,
  );

  // 无目标范围（canonical 未声明 applicability）→ 默认不迁。
  let noScopeRegistry = createIdentityRegistry();
  const noScopeLex = createLexeme(noScopeRegistry, { language: 'en' }, mergeFactory);
  noScopeRegistry = noScopeLex.registry;
  const noScopeCanonical = createEntry(
    noScopeRegistry,
    { language: 'en', exactSpelling: 'a', lexemeId: noScopeLex.lexemeId },
    mergeFactory,
  );
  noScopeRegistry = noScopeCanonical.registry;
  const noScopeVariant = createEntry(
    noScopeRegistry,
    { language: 'en', exactSpelling: 'a2', lexemeId: noScopeLex.lexemeId },
    mergeFactory,
  );
  noScopeRegistry = noScopeVariant.registry;
  const noScopeMerge = mergeEntries(
    noScopeRegistry,
    [
      {
        correctionId: 'corr-ns',
        targetEntryId: noScopeVariant.entryId,
        scope: fullScope(noScopeVariant.entryId, noScopeLex.lexemeId),
        fingerprint: 'fp',
      },
    ],
    {
      canonicalId: noScopeCanonical.entryId,
      mergedIds: [noScopeVariant.entryId],
      reason: 'r',
      evidenceRefs: ['ev'],
    },
  );
  assert.deepEqual(noScopeMerge.audit.migratedCorrectionIds, []);
  assert.deepEqual(noScopeMerge.audit.unresolvedCorrectionIds, ['corr-ns']);

  // split：完整覆盖 + 其他后继确定 disjoint + scope.entry 重映射。
  let splitSeq = 300;
  const splitFactory = (kind) => {
    const hex = (splitSeq++).toString(16).padStart(8, '0');
    return `${kind === 'entry' ? 'ent' : 'lex'}_${hex}-0000-4000-8000-000000000000`;
  };
  let splitRegistry = createIdentityRegistry();
  const splitLex = createLexeme(splitRegistry, { language: 'en' }, splitFactory);
  splitRegistry = splitLex.registry;
  const unsplit = createEntry(
    splitRegistry,
    { language: 'en', exactSpelling: 'read', lexemeId: splitLex.lexemeId },
    splitFactory,
  );
  splitRegistry = unsplit.registry;
  const baseScope = fullScope(unsplit.entryId, splitLex.lexemeId, {
    role: knownScope(['base']),
    pos: knownScope(['noun']),
    sense: knownScope(['sense-a']),
  });
  const pastScope = fullScope(unsplit.entryId, splitLex.lexemeId, {
    role: knownScope(['past']),
    pos: knownScope(['verb']),
    sense: knownScope(['sense-b']),
  });
  const pastCorrectionScope = fullScope(unsplit.entryId, splitLex.lexemeId, {
    role: knownScope(['past']),
    pos: knownScope(['verb']),
    sense: knownScope(['sense-b']),
  });
  const unknownSenseScope = fullScope(unsplit.entryId, splitLex.lexemeId, {
    role: knownScope(['past']),
    pos: knownScope(['verb']),
    sense: unknownScope('未注明'),
  });
  const conflictingAccentScope = fullScope(unsplit.entryId, splitLex.lexemeId, {
    role: knownScope(['past']),
    pos: knownScope(['verb']),
    sense: knownScope(['sense-b']),
    accent: knownScope(['UK']),
  });
  const baseCorrectionScope = fullScope(unsplit.entryId, splitLex.lexemeId, {
    role: knownScope(['base']),
    pos: knownScope(['noun']),
    sense: knownScope(['sense-a']),
  });
  const splitCorrections = [
    {
      correctionId: 'corr-past-ok',
      targetEntryId: unsplit.entryId,
      scope: pastCorrectionScope,
      fingerprint: 'fp-past',
    },
    {
      correctionId: 'corr-past-unknown',
      targetEntryId: unsplit.entryId,
      scope: unknownSenseScope,
      fingerprint: 'fp-unknown',
    },
    {
      correctionId: 'corr-past-conflict',
      targetEntryId: unsplit.entryId,
      scope: conflictingAccentScope,
      fingerprint: 'fp-conflict',
    },
    {
      correctionId: 'corr-base-noev',
      targetEntryId: unsplit.entryId,
      scope: baseCorrectionScope,
      fingerprint: 'fp-base',
    },
  ];
  const splitResult = splitEntry(
    splitRegistry,
    splitCorrections,
    {
      entryId: unsplit.entryId,
      reason: '按证据拆分 read',
      evidenceRefs: ['ev-split'],
      successors: [
        { role: 'base', scope: baseScope, evidenceRefs: [] },
        { role: 'past', scope: pastScope, evidenceRefs: ['ev-split-past'] },
      ],
    },
    splitFactory,
  );
  splitRegistry = splitResult.registry;
  assert.equal(getEntry(splitRegistry, unsplit.entryId).status, 'retired');
  assert.equal(getEntry(splitRegistry, unsplit.entryId).successorIds.length, 2);
  assert.equal(getEntry(splitRegistry, unsplit.entryId).redirectTo, undefined);
  const pastSuccessorId = splitResult.successorIds[1];
  assert.deepEqual(splitResult.audit.migratedCorrectionIds, ['corr-past-ok']);
  const pastMigrated = splitResult.corrections.find((item) => item.correctionId === 'corr-past-ok');
  assert.equal(pastMigrated.targetEntryId, pastSuccessorId);
  assert.deepEqual(
    pastMigrated.scope.entry,
    knownScope([pastSuccessorId]),
    'scope.entry 必须重映射到后继',
  );
  assert.deepEqual([...splitResult.audit.unresolvedCorrectionIds].sort(), [
    'corr-base-noev',
    'corr-past-conflict',
    'corr-past-unknown',
  ]);
  assert.equal(
    splitResult.corrections.find((item) => item.correctionId === 'corr-past-unknown').targetEntryId,
    unsplit.entryId,
  );
  assert.equal(
    splitResult.corrections.find((item) => item.correctionId === 'corr-base-noev').targetEntryId,
    unsplit.entryId,
  );
  assert.equal(splitRegistry.history.length, 1);
  assert.equal(splitRegistry.history[0].action, 'split');
  assert.equal(
    validateIdentityRegistry(splitRegistry).valid,
    true,
    JSON.stringify(validateIdentityRegistry(splitRegistry).issues),
  );

  // compatible 1 + 同 role unknown sense 的第二后继 → 不得迁移（其他后继非 disjoint）。
  let ambRegistry = createIdentityRegistry();
  const ambLex = createLexeme(ambRegistry, { language: 'en' }, splitFactory);
  ambRegistry = ambLex.registry;
  const ambUnsplit = createEntry(
    ambRegistry,
    { language: 'en', exactSpelling: 'read', lexemeId: ambLex.lexemeId },
    splitFactory,
  );
  ambRegistry = ambUnsplit.registry;
  const ambGoodScope = fullScope(ambUnsplit.entryId, ambLex.lexemeId, {
    role: knownScope(['base']),
    sense: knownScope(['sense-a']),
  });
  const ambUnknownScope = fullScope(ambUnsplit.entryId, ambLex.lexemeId, {
    role: knownScope(['base']),
    sense: unknownScope('未注明'),
  });
  const ambResult = splitEntry(
    ambRegistry,
    [
      {
        correctionId: 'corr-amb',
        targetEntryId: ambUnsplit.entryId,
        scope: ambGoodScope,
        fingerprint: 'fp',
      },
    ],
    {
      entryId: ambUnsplit.entryId,
      reason: '歧义拆分',
      evidenceRefs: ['ev'],
      successors: [
        { role: 'base', scope: ambGoodScope, evidenceRefs: ['ev-a'] },
        { role: 'base', scope: ambUnknownScope, evidenceRefs: ['ev-b'] },
      ],
    },
    splitFactory,
  );
  assert.deepEqual(
    ambResult.audit.migratedCorrectionIds,
    [],
    '同 role unknown sense 后继存在时不得迁移',
  );
  assert.deepEqual(ambResult.audit.unresolvedCorrectionIds, ['corr-amb']);

  // 两个后继都完整覆盖 → 不得迁移。
  let twoCovRegistry = createIdentityRegistry();
  const tcLex = createLexeme(twoCovRegistry, { language: 'en' }, splitFactory);
  twoCovRegistry = tcLex.registry;
  const tcUnsplit = createEntry(
    twoCovRegistry,
    { language: 'en', exactSpelling: 'read', lexemeId: tcLex.lexemeId },
    splitFactory,
  );
  twoCovRegistry = tcUnsplit.registry;
  const tcScope = fullScope(tcUnsplit.entryId, tcLex.lexemeId, { role: knownScope(['base']) });
  const tcResult = splitEntry(
    twoCovRegistry,
    [
      {
        correctionId: 'corr-two',
        targetEntryId: tcUnsplit.entryId,
        scope: tcScope,
        fingerprint: 'fp',
      },
    ],
    {
      entryId: tcUnsplit.entryId,
      reason: '双覆盖',
      evidenceRefs: ['ev'],
      successors: [
        { role: 'base', scope: tcScope, evidenceRefs: ['ev-a'] },
        { role: 'base', scope: tcScope, evidenceRefs: ['ev-b'] },
      ],
    },
    splitFactory,
  );
  assert.deepEqual(tcResult.audit.migratedCorrectionIds, []);

  // split successor persist：applicability.entry 重映射为新 successor，不留 retired predecessor。
  for (const successorId of splitResult.successorIds) {
    const successorEntry = getEntry(splitRegistry, successorId);
    assert.deepEqual(
      successorEntry.applicability.entry,
      knownScope([successorId]),
      'successor applicability.entry 必须重映射为新 ID',
    );
    assert.notEqual(successorEntry.applicability.entry.values[0], unsplit.entryId);
  }
  // 非 single old predecessor / 权威字段矛盾 → persist fail closed（throw）。
  let persistReg = createIdentityRegistry();
  const persistLex = createLexeme(persistReg, {
    language: 'en',
    id: 'lex_00001001-0000-4000-8000-000000000001',
  });
  persistReg = persistLex.registry;
  const persistUnsplit = createEntry(persistReg, {
    language: 'en',
    exactSpelling: 'read',
    lexemeId: persistLex.lexemeId,
    id: 'ent_00001001-0000-4000-8000-000000000001',
  });
  persistReg = persistUnsplit.registry;
  const goodPersistScope = fullScope(persistUnsplit.entryId, persistLex.lexemeId, {
    role: knownScope(['past']),
  });
  assert.throws(
    () =>
      splitEntry(
        persistReg,
        [],
        {
          entryId: persistUnsplit.entryId,
          reason: 'r',
          evidenceRefs: ['ev'],
          successors: [
            {
              role: 'base',
              scope: fullScope(persistUnsplit.entryId, persistLex.lexemeId, {
                role: knownScope(['base']),
                entry: unknownScope('未定'),
              }),
              evidenceRefs: ['e'],
            },
            { role: 'past', scope: goodPersistScope, evidenceRefs: ['e'] },
          ],
        },
        splitFactory,
      ),
    /单个旧 predecessor/u,
  );
  assert.throws(
    () =>
      splitEntry(
        persistReg,
        [],
        {
          entryId: persistUnsplit.entryId,
          reason: 'r',
          evidenceRefs: ['ev'],
          successors: [
            {
              role: 'base',
              scope: fullScope(persistUnsplit.entryId, persistLex.lexemeId, {
                role: knownScope(['base']),
                language: knownScope(['de']),
              }),
              evidenceRefs: ['e'],
            },
            { role: 'past', scope: goodPersistScope, evidenceRefs: ['e'] },
          ],
        },
        splitFactory,
      ),
    /权威语言/u,
  );

  // 注入 matcher 只能收紧：即使 custom migrate:true，internal gate 仍拒 partial/unknown。
  let cmReg = createIdentityRegistry();
  const cmLex = createLexeme(cmReg, {
    language: 'en',
    id: 'lex_00001101-0000-4000-8000-000000000001',
  });
  cmReg = cmLex.registry;
  const cmCanon = createEntry(cmReg, {
    language: 'en',
    exactSpelling: 'color',
    lexemeId: cmLex.lexemeId,
    applicability: fullScope('ent_00000000-0000-4000-8000-0000000000cb', cmLex.lexemeId, {
      accent: knownScope(['US']),
    }),
    id: 'ent_00001101-0000-4000-8000-000000000001',
  });
  cmReg = cmCanon.registry;
  const cmVar = createEntry(cmReg, {
    language: 'en',
    exactSpelling: 'colour',
    lexemeId: cmLex.lexemeId,
    id: 'ent_00001102-0000-4000-8000-000000000002',
  });
  cmReg = cmVar.registry;
  const alwaysMigrate = () => ({ migrate: true, reason: 'custom always', dimensions: [] });
  const cmResult = mergeEntries(
    cmReg,
    [
      {
        correctionId: 'cm-subset',
        targetEntryId: cmVar.entryId,
        scope: fullScope(cmVar.entryId, cmLex.lexemeId, { accent: knownScope(['US']) }),
        fingerprint: 'f1',
      },
      {
        correctionId: 'cm-partial',
        targetEntryId: cmVar.entryId,
        scope: fullScope(cmVar.entryId, cmLex.lexemeId, { accent: knownScope(['US', 'AU']) }),
        fingerprint: 'f2',
      },
      {
        correctionId: 'cm-unknown',
        targetEntryId: cmVar.entryId,
        scope: fullScope(cmVar.entryId, cmLex.lexemeId, { sense: unknownScope('x') }),
        fingerprint: 'f3',
      },
    ],
    { canonicalId: cmCanon.entryId, mergedIds: [cmVar.entryId], reason: 'r', evidenceRefs: ['ev'] },
    { matcher: alwaysMigrate },
  );
  assert.deepEqual(cmResult.audit.migratedCorrectionIds, ['cm-subset']);
  assert.ok(cmResult.audit.unresolvedCorrectionIds.includes('cm-partial'));
  assert.ok(cmResult.audit.unresolvedCorrectionIds.includes('cm-unknown'));

  // history 深校验：合法生成往返通过；decisions[{}] / 列表不一致被拒。
  const mergeRoundTrip = deserializeIdentityRegistry(serializeIdentityRegistry(mergeRegistry));
  assert.equal(
    validateIdentityRegistry(mergeRoundTrip).valid,
    true,
    JSON.stringify(validateIdentityRegistry(mergeRoundTrip).issues),
  );
  const badDecision = clone(mergeRegistry);
  badDecision.history[0].decisions = [{}];
  assert.equal(validateIdentityRegistry(badDecision).valid, false);
  const badConsistency = clone(mergeRegistry);
  badConsistency.history[0].migratedCorrectionIds = [];
  assert.equal(validateIdentityRegistry(badConsistency).valid, false);

  // 旧 alias 指向被 merge 的条目 → 显式 historical，registry 仍合法且 locator 保留。
  let histReg = createIdentityRegistry();
  const histLex = createLexeme(histReg, {
    language: 'en',
    id: 'lex_00001201-0000-4000-8000-000000000001',
  });
  histReg = histLex.registry;
  const histCanon = createEntry(histReg, {
    language: 'en',
    exactSpelling: 'color',
    grammarRoles: ['base'],
    lexemeId: histLex.lexemeId,
    id: 'ent_00001201-0000-4000-8000-000000000001',
  });
  histReg = histCanon.registry;
  const histVar = createEntry(histReg, {
    language: 'en',
    exactSpelling: 'colour',
    grammarRoles: ['base'],
    lexemeId: histLex.lexemeId,
    id: 'ent_00001202-0000-4000-8000-000000000002',
  });
  histReg = histVar.registry;
  histReg = addSourceAlias(histReg, {
    sourceSite: 'wiktionary',
    language: 'en',
    pageSpelling: 'colour',
    anchor: 'E1',
    role: 'base',
    entryId: histVar.entryId,
    evidenceRefs: ['ev-a'],
  }).registry;
  histReg = mergeEntries(histReg, [], {
    canonicalId: histCanon.entryId,
    mergedIds: [histVar.entryId],
    reason: 'r',
    evidenceRefs: ['ev'],
  }).registry;
  assert.equal(
    validateIdentityRegistry(histReg).valid,
    true,
    JSON.stringify(validateIdentityRegistry(histReg).issues),
  );
  const histAlias = histReg.sourceAliases.find((alias) => alias.pageSpelling === 'colour');
  assert.equal(histAlias.status, 'historical');
  assert.equal(histAlias.anchor, 'E1');
  // 对照：confirmed 指向 retired 必须被拒。
  const forcedConfirmed = clone(histReg);
  forcedConfirmed.sourceAliases[0].status = 'confirmed';
  assert.equal(validateIdentityRegistry(forcedConfirmed).valid, false);
  // 非法 role / 非数组 scopePath / 非 active 目标被拒。
  const badAliasRole = clone(histReg);
  badAliasRole.sourceAliases[0].role = 'noun';
  assert.equal(validateIdentityRegistry(badAliasRole).valid, false);
  const badAliasScopePath = clone(histReg);
  badAliasScopePath.sourceAliases[0].scopePath = 'not-an-array';
  assert.equal(validateIdentityRegistry(badAliasScopePath).valid, false);

  // 范围比较 helper 的直接语义（完整覆盖 vs 部分相交 vs 冲突 vs unknown vs explicit-all 目标）。
  assert.equal(
    overallScopeResult(evaluateScopeCompatibility(subsetScope, canonicalScope)),
    'compatible',
  );
  assert.equal(
    overallScopeResult(evaluateScopeCompatibility(partialScope, canonicalScope)),
    'unknown',
  );
  assert.equal(
    overallScopeResult(evaluateScopeCompatibility(conflictScope, canonicalScope)),
    'conflict',
  );
  assert.equal(
    overallScopeResult(evaluateScopeCompatibility(unknownScopeC, canonicalScope)),
    'unknown',
  );
  assert.equal(
    overallScopeResult(
      evaluateScopeCompatibility(
        subsetScope,
        fullScope(variant.entryId, mergeLex.lexemeId, { accent: explicitAllScope(['ev-1']) }),
      ),
    ),
    'compatible',
    '目标 explicit-all 应视为完整覆盖',
  );

  // redirect / successor / 生命周期不变量。
  const cyclic = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      'ent_00000001-0000-4000-8000-000000000001': {
        id: 'ent_00000001-0000-4000-8000-000000000001',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'a',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: [],
        redirectTo: 'ent_00000002-0000-4000-8000-000000000002',
        retiredReason: 'x',
        evidenceRefs: [],
      },
      'ent_00000002-0000-4000-8000-000000000002': {
        id: 'ent_00000002-0000-4000-8000-000000000002',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'b',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: [],
        redirectTo: 'ent_00000001-0000-4000-8000-000000000001',
        retiredReason: 'x',
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
  };
  assert.equal(validateIdentityRegistry(cyclic).valid, false);
  assert.doesNotThrow(() => validateIdentityRegistry(cyclic));

  // active 不得带 redirect / successor / retiredReason。
  const activeBad = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      'ent_00000001-0000-4000-8000-000000000001': {
        id: 'ent_00000001-0000-4000-8000-000000000001',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'a',
        aliases: [],
        grammarRoles: [],
        status: 'active',
        successorIds: [],
        redirectTo: 'ent_00000002-0000-4000-8000-000000000002',
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
  };
  assert.equal(validateIdentityRegistry(activeBad).valid, false);

  // retired 目标互斥：both / neither / 缺 reason 均拒绝。
  const retiredBoth = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      'ent_00000001-0000-4000-8000-000000000001': {
        id: 'ent_00000001-0000-4000-8000-000000000001',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'a',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: ['ent_00000002-0000-4000-8000-000000000002'],
        redirectTo: 'ent_00000002-0000-4000-8000-000000000002',
        retiredReason: 'x',
        evidenceRefs: [],
      },
      'ent_00000002-0000-4000-8000-000000000002': {
        id: 'ent_00000002-0000-4000-8000-000000000002',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'b',
        aliases: [],
        grammarRoles: [],
        status: 'active',
        successorIds: [],
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
  };
  assert.equal(validateIdentityRegistry(retiredBoth).valid, false);
  const retiredNeither = clone(retiredBoth);
  delete retiredNeither.byId['ent_00000001-0000-4000-8000-000000000001'].redirectTo;
  retiredNeither.byId['ent_00000001-0000-4000-8000-000000000001'].successorIds = [];
  assert.equal(validateIdentityRegistry(retiredNeither).valid, false);

  // 链式 redirect 可追溯：retired → retired → active 合法。
  const chain = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      'ent_00000001-0000-4000-8000-000000000001': {
        id: 'ent_00000001-0000-4000-8000-000000000001',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'a',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: [],
        redirectTo: 'ent_00000002-0000-4000-8000-000000000002',
        retiredReason: 'x',
        evidenceRefs: [],
      },
      'ent_00000002-0000-4000-8000-000000000002': {
        id: 'ent_00000002-0000-4000-8000-000000000002',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'b',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: [],
        redirectTo: 'ent_00000003-0000-4000-8000-000000000003',
        retiredReason: 'x',
        evidenceRefs: [],
      },
      'ent_00000003-0000-4000-8000-000000000003': {
        id: 'ent_00000003-0000-4000-8000-000000000003',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'c',
        aliases: [],
        grammarRoles: [],
        status: 'active',
        successorIds: [],
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
  };
  assert.equal(
    validateIdentityRegistry(chain).valid,
    true,
    JSON.stringify(validateIdentityRegistry(chain).issues),
  );

  // redirect 指向 split（一对多）→ 拒绝。
  const redirectToSplit = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      'ent_00000001-0000-4000-8000-000000000001': {
        id: 'ent_00000001-0000-4000-8000-000000000001',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'a',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: [],
        redirectTo: 'ent_00000002-0000-4000-8000-000000000002',
        retiredReason: 'x',
        evidenceRefs: [],
      },
      'ent_00000002-0000-4000-8000-000000000002': {
        id: 'ent_00000002-0000-4000-8000-000000000002',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'b',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: ['ent_00000003-0000-4000-8000-000000000003'],
        retiredReason: 'y',
        evidenceRefs: [],
      },
      'ent_00000003-0000-4000-8000-000000000003': {
        id: 'ent_00000003-0000-4000-8000-000000000003',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'c',
        aliases: [],
        grammarRoles: [],
        status: 'active',
        successorIds: [],
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
  };
  assert.equal(validateIdentityRegistry(redirectToSplit).valid, false);

  // successor 循环 → 拒绝。
  const successorCycle = {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {
      'ent_00000001-0000-4000-8000-000000000001': {
        id: 'ent_00000001-0000-4000-8000-000000000001',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'a',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: ['ent_00000002-0000-4000-8000-000000000002'],
        retiredReason: 'x',
        evidenceRefs: [],
      },
      'ent_00000002-0000-4000-8000-000000000002': {
        id: 'ent_00000002-0000-4000-8000-000000000002',
        kind: 'entry',
        language: 'en',
        exactSpelling: 'b',
        aliases: [],
        grammarRoles: [],
        status: 'retired',
        successorIds: ['ent_00000001-0000-4000-8000-000000000001'],
        retiredReason: 'x',
        evidenceRefs: [],
      },
    },
    sourceAliases: [],
  };
  assert.equal(validateIdentityRegistry(successorCycle).valid, false);

  assert.equal(normalizeSpellingKey('  Ｈｅｌｌｏ   World '), 'hello world');

  console.log('test_pronunciation_identity: OK');
} finally {
  await server.close();
}
