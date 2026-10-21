/**
 * 音标叠加层 JSON 合同的 Node 侧离线测试（小阶段 A）。
 *
 * 目的：
 * - 用 Vite SSR 加载 `src/pronunciation-overlay/contracts.ts`，对合成夹具执行形状/引用校验；
 * - 与 `scripts/wiktionary_per_word/contracts.py` 对**同一份夹具 JSON** 做交叉对照，
 *   要求 TS 与 Python 对 valid/invalid 结论一致（真正跨语言核对，而非各自为政）；
 * - 覆盖 createdAt 缺省保效、known entry/lexeme 引用、规则生命周期引用、
 *   fieldProvenance/suppression/checkpoint/projection 坏引用、可选列表类型、unknown-as-all 等。
 *
 * 零网络、零安装、零采集、零发布；仅使用合成夹具，不写正式结果。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
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
      pos: unknownScope('未注明词性'),
      sense: unknownScope('未注明词义'),
      accent: knownScope(['US']),
      other: unknownScope('未注明其他条件'),
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
  // 1. 基础形状 / 维度 / unknown-as-all / 空观测
  // =========================================================================

  assert.ok(SCOPE_DIMENSIONS.includes('entry'));
  assert.ok(SCOPE_DIMENSIONS.includes('lexeme'));
  assert.equal(SCOPE_DIMENSIONS.length, 8);

  const validSet = makeDocumentSet();
  const validResult = validateOverlayDocumentSet(validSet);
  assert.equal(validResult.valid, true, JSON.stringify(validResult.issues));

  // 缺 list 不得默认空数组；null/primitive 不崩。
  const missingList = clone(validSet);
  delete missingList.evidence;
  assert.equal(validateOverlayDocumentSet(missingList).valid, false);
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

  // unknown 不得当 explicit-all；explicit-all 缺证据/坏项/坏引用被拒。
  const unknownNoReason = clone(validSet);
  unknownNoReason.observations[0].applicability.language = { kind: 'unknown' };
  assert.equal(validateOverlayDocumentSet(unknownNoReason).valid, false);
  const fakeAll = clone(validSet);
  fakeAll.observations[0].applicability.sense = { kind: 'all' };
  assert.equal(validateOverlayDocumentSet(fakeAll).valid, false);
  const emptyAllEvidence = clone(validSet);
  emptyAllEvidence.rules[0].conditions.accent = { kind: 'explicit-all', evidence: [] };
  assert.equal(validateOverlayDocumentSet(emptyAllEvidence).valid, false);
  const danglingAllEvidence = clone(validSet);
  danglingAllEvidence.rules[0].conditions.accent = {
    kind: 'explicit-all',
    evidence: ['ev-missing'],
  };
  assert.equal(validateOverlayDocumentSet(danglingAllEvidence).valid, false);
  const scopeIssues = [];
  validateScopeConstraint({ kind: 'unknown' }, '$', scopeIssues);
  assert.equal(scopeIssues.length > 0, true);

  // 空观测保留：rawIpa/normalizedIpa 允许为空字符串，但不得作为默认读法（此合同层只保证可保存）。
  const emptyObservation = clone(validSet);
  emptyObservation.observations[0].rawIpa = '';
  emptyObservation.observations[0].normalizedIpa = '';
  emptyObservation.observations[0].completeness = 'empty';
  assert.equal(
    validateOverlayDocumentSet(emptyObservation).valid,
    true,
    JSON.stringify(validateOverlayDocumentSet(emptyObservation).issues),
  );

  // 空证据引用的 explicit-all 是“不合格条件”，不得作为合格证据放行。
  assert.equal(validateOverlayDocumentSet(emptyAllEvidence).valid, false);

  // =========================================================================
  // 2. createdAt 缺省保效 / 不得伪填今天
  // =========================================================================

  const legacyRule = clone(validSet);
  delete legacyRule.rules[0].createdAt;
  legacyRule.rules[0].createdAtUnknownReason = '旧规则导入时无 timestamp';
  legacyRule.rules[0].reviewStatus = 'pending-review';
  assert.equal(
    validateOverlayDocumentSet(legacyRule).valid,
    true,
    JSON.stringify(validateOverlayDocumentSet(legacyRule).issues),
  );

  const noCreatedAt = clone(validSet);
  delete noCreatedAt.rules[0].createdAt;
  assert.equal(validateOverlayDocumentSet(noCreatedAt).valid, false);
  const fakeActive = clone(validSet);
  delete fakeActive.rules[0].createdAt;
  fakeActive.rules[0].createdAtUnknownReason = '未知';
  assert.equal(validateOverlayDocumentSet(fakeActive).valid, false);
  const conflictCreatedAt = clone(validSet);
  conflictCreatedAt.rules[0].createdAtUnknownReason = '不应同时出现';
  assert.equal(validateOverlayDocumentSet(conflictCreatedAt).valid, false);
  const emptyCreatedAt = clone(validSet);
  emptyCreatedAt.rules[0].createdAt = '';
  assert.equal(validateOverlayDocumentSet(emptyCreatedAt).valid, false);

  // =========================================================================
  // 3. 身份引用 / 可选列表 / 生命周期引用
  // =========================================================================

  // identityLexemeIds 必须实用：known lexeme 引用坏 ID 被拒。
  const badLexeme = clone(validSet);
  badLexeme.rules[0].conditions.lexeme = {
    kind: 'known',
    values: ['lex_99999999-0000-0000-0000-000000000000'],
  };
  assert.equal(validateOverlayDocumentSet(badLexeme).valid, false);
  const badEntry = clone(validSet);
  badEntry.observations[0].applicability.entry = {
    kind: 'known',
    values: ['ent_99999999-0000-0000-0000-000000000000'],
  };
  assert.equal(validateOverlayDocumentSet(badEntry).valid, false);
  // lex-test 这类非不透明 ID 不再被接受。
  const nonOpaqueLexeme = clone(validSet);
  nonOpaqueLexeme.identityLexemeIds = ['lex-test'];
  assert.equal(validateOverlayDocumentSet(nonOpaqueLexeme).valid, false);

  // 可选列表若存在必须为数组。
  const malformedLexemeList = clone(validSet);
  malformedLexemeList.identityLexemeIds = 'nope';
  assert.equal(validateOverlayDocumentSet(malformedLexemeList).valid, false);
  const malformedDisplays = clone(validSet);
  malformedDisplays.displays = { entryId: ENTRY_ID };
  assert.equal(validateOverlayDocumentSet(malformedDisplays).valid, false);

  // 重复规则 / 坏 supersedes / 自引用 revokedBy。
  const duplicateRule = clone(validSet);
  duplicateRule.rules.push(clone(duplicateRule.rules[0]));
  assert.equal(validateOverlayDocumentSet(duplicateRule).valid, false);
  const badSupersedes = clone(validSet);
  badSupersedes.rules[0].supersedesRuleId = 'rule-missing';
  assert.equal(validateOverlayDocumentSet(badSupersedes).valid, false);
  const selfRevoked = clone(validSet);
  selfRevoked.rules[0].revokedByRuleId = 'rule-synthetic-1';
  assert.equal(validateOverlayDocumentSet(selfRevoked).valid, false);

  // fieldProvenance 按 source 引用；suppression.ruleId；checkpoint；projection.entryId。
  const badProvenance = clone(validSet);
  badProvenance.resolved[0].fieldProvenance = [
    { field: 'phonetic', source: 'user', ref: 'rule-missing' },
  ];
  assert.equal(validateOverlayDocumentSet(badProvenance).valid, false);
  const badSuppression = clone(validSet);
  badSuppression.resolved[0].suppression = { reason: '有意清空', ruleId: 'rule-missing' };
  assert.equal(validateOverlayDocumentSet(badSuppression).valid, false);
  const badCheckpoint = clone(validSet);
  badCheckpoint.checkpoints[0].lastCompletionEvidence = 'ev-missing';
  assert.equal(validateOverlayDocumentSet(badCheckpoint).valid, false);
  const badProjection = clone(validSet);
  badProjection.manifest.compatibleProjection = [
    { entryId: 'ent_99999999-0000-0000-0000-000000000000', legacyWord: 'read' },
  ];
  assert.equal(validateOverlayDocumentSet(badProjection).valid, false);

  // 缺许可 / schema 版本。
  const mitLicense = clone(validSet);
  mitLicense.evidence[0].license.spdx = 'MIT';
  assert.equal(validateOverlayDocumentSet(mitLicense).valid, false);
  const licenseIssues = [];
  validateSourceEvidence(mitLicense.evidence[0], '$', licenseIssues);
  assert.equal(licenseIssues.length > 0, true);
  const badManifestVersion = clone(validSet);
  badManifestVersion.manifest.ruleSchemaVersion = 'pronunciation-rule/0';
  assert.equal(validateOverlayDocumentSet(badManifestVersion).valid, false);
  const badApprovalVersion = clone(validSet);
  badApprovalVersion.approvals[0].resolvedSchemaVersion = 'pronunciation-resolved/0';
  assert.equal(validateOverlayDocumentSet(badApprovalVersion).valid, false);

  // =========================================================================
  // 4. 观测语义指纹：规范比较，不改 raw；无关边界空白/实体/NFC 不误触发
  // =========================================================================

  const baseObservation = makeObservation();
  const baseFp = computeObservationFingerprint(baseObservation);
  // 边界空白 / HTML 实体 / NFD 等价形式不应触发语义变化。
  assert.equal(
    computeObservationFingerprint({ ...baseObservation, rawIpa: ` ${baseObservation.rawIpa} ` }),
    baseFp,
  );
  assert.equal(
    computeObservationFingerprint({ ...baseObservation, rawIpa: '/&#83;YNTH-IPA-A/' }),
    baseFp,
  );
  assert.equal(
    computeObservationFingerprint({
      ...baseObservation,
      normalizedIpa: baseObservation.normalizedIpa.normalize('NFD'),
    }),
    baseFp,
  );
  assert.equal(
    computeObservationFingerprint({ ...baseObservation, rawTags: ['UK', 'IPA'] }),
    baseFp,
  );
  // 真实语义变化必须触发：notation / qualifiers / scope / IPA。
  assert.notEqual(
    computeObservationFingerprint({ ...baseObservation, notation: 'phonetic' }),
    baseFp,
  );
  assert.notEqual(
    computeObservationFingerprint({ ...baseObservation, rawQualifiers: ['GA'] }),
    baseFp,
  );
  assert.notEqual(
    computeObservationFingerprint({
      ...baseObservation,
      applicability: scopeFor(ENTRY_ID, { accent: knownScope(['UK']) }),
    }),
    baseFp,
  );
  assert.notEqual(
    computeObservationFingerprint({ ...baseObservation, normalizedIpa: '/SYNTH-IPA-B/' }),
    baseFp,
  );
  assert.notEqual(
    computeObservationFingerprint({ ...baseObservation, rawIpa: '/SYNTH-IPA-B/' }),
    baseFp,
  );
  // explicit-all 带证据与 unknown 不得互换。
  assert.notEqual(
    computeObservationFingerprint({
      ...baseObservation,
      applicability: scopeFor(ENTRY_ID, { sense: explicitAllScope([EVIDENCE_ID]) }),
    }),
    baseFp,
  );

  // =========================================================================
  // 5. TS ↔ Python 同夹具交叉对照
  // =========================================================================

  const crossFixtures = [
    { name: 'valid', doc: makeDocumentSet() },
    {
      name: 'legacy-rule-pending',
      doc: (() => {
        const d = makeDocumentSet();
        delete d.rules[0].createdAt;
        d.rules[0].createdAtUnknownReason = '旧规则导入时无 timestamp';
        d.rules[0].reviewStatus = 'pending-review';
        return d;
      })(),
    },
    {
      name: 'rule-no-created-at',
      doc: (() => {
        const d = makeDocumentSet();
        delete d.rules[0].createdAt;
        return d;
      })(),
    },
    {
      name: 'rule-fake-active',
      doc: (() => {
        const d = makeDocumentSet();
        delete d.rules[0].createdAt;
        d.rules[0].createdAtUnknownReason = '未知';
        return d;
      })(),
    },
    {
      name: 'unknown-as-all',
      doc: (() => {
        const d = makeDocumentSet();
        d.observations[0].applicability.sense = { kind: 'all' };
        return d;
      })(),
    },
    {
      name: 'empty-explicit-all',
      doc: (() => {
        const d = makeDocumentSet();
        d.rules[0].conditions.accent = { kind: 'explicit-all', evidence: [] };
        return d;
      })(),
    },
    {
      name: 'bad-known-entry',
      doc: (() => {
        const d = makeDocumentSet();
        d.observations[0].applicability.entry = {
          kind: 'known',
          values: ['ent_99999999-0000-0000-0000-000000000000'],
        };
        return d;
      })(),
    },
    {
      name: 'bad-known-lexeme',
      doc: (() => {
        const d = makeDocumentSet();
        d.rules[0].conditions.lexeme = {
          kind: 'known',
          values: ['lex_99999999-0000-0000-0000-000000000000'],
        };
        return d;
      })(),
    },
    {
      name: 'malformed-lexeme-list',
      doc: (() => {
        const d = makeDocumentSet();
        d.identityLexemeIds = 'nope';
        return d;
      })(),
    },
    {
      name: 'duplicate-rule',
      doc: (() => {
        const d = makeDocumentSet();
        d.rules.push(clone(d.rules[0]));
        return d;
      })(),
    },
    {
      name: 'bad-supersedes',
      doc: (() => {
        const d = makeDocumentSet();
        d.rules[0].supersedesRuleId = 'rule-missing';
        return d;
      })(),
    },
    {
      name: 'self-revoked',
      doc: (() => {
        const d = makeDocumentSet();
        d.rules[0].revokedByRuleId = d.rules[0].ruleId;
        return d;
      })(),
    },
    {
      name: 'bad-provenance',
      doc: (() => {
        const d = makeDocumentSet();
        d.resolved[0].fieldProvenance = [
          { field: 'phonetic', source: 'user', ref: 'rule-missing' },
        ];
        return d;
      })(),
    },
    {
      name: 'bad-suppression',
      doc: (() => {
        const d = makeDocumentSet();
        d.resolved[0].suppression = { reason: '有意清空', ruleId: 'rule-missing' };
        return d;
      })(),
    },
    {
      name: 'bad-checkpoint-evidence',
      doc: (() => {
        const d = makeDocumentSet();
        d.checkpoints[0].lastCompletionEvidence = 'ev-missing';
        return d;
      })(),
    },
    {
      name: 'bad-projection-entry',
      doc: (() => {
        const d = makeDocumentSet();
        d.manifest.compatibleProjection = [
          { entryId: 'ent_99999999-0000-0000-0000-000000000000', legacyWord: 'read' },
        ];
        return d;
      })(),
    },
    {
      name: 'mit-license',
      doc: (() => {
        const d = makeDocumentSet();
        d.evidence[0].license.spdx = 'MIT';
        return d;
      })(),
    },
    {
      name: 'missing-license-asset',
      doc: (() => {
        const d = makeDocumentSet();
        d.manifest.licenseAssets = [d.manifest.licenseAssets[1]];
        return d;
      })(),
    },
    {
      name: 'empty-observation',
      doc: (() => {
        const d = makeDocumentSet();
        d.observations[0].rawIpa = '';
        d.observations[0].normalizedIpa = '';
        d.observations[0].completeness = 'empty';
        return d;
      })(),
    },
  ];

  const crossResult = crossValidateWithPython(crossFixtures, validateOverlayDocumentSet);
  assert.equal(crossResult.ok, true, crossResult.message);

  console.log('test_pronunciation_contracts: OK');
} finally {
  await server.close();
}

/**
 * 用同一份夹具 JSON 调用 Python `contracts.py`，逐项比较 TS/Python 的 valid 结论。
 * 只做离线校验，不联网、不写文件。
 */
function crossValidateWithPython(items, validateFn) {
  const script = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("pc", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'items = json.load(sys.stdin)',
    'out = []',
    'for it in items:',
    '    issues = m.validate_document_set(it["doc"])',
    '    out.append({"name": it["name"], "valid": not issues, "codes": issues})',
    'print(json.dumps(out, ensure_ascii=False))',
  ].join('\n');
  const scriptPath = `${REPO_ROOT}scripts/wiktionary_per_word/contracts.py`;
  const result = spawnSync('python3', ['-c', script, scriptPath], {
    input: JSON.stringify(items),
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, message: `无法启动 python3：${String(result.error)}` };
  }
  if (result.status !== 0) {
    return { ok: false, message: `python3 退出码 ${String(result.status)}：${result.stderr}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    return { ok: false, message: `无法解析 python3 输出：${String(error)}` };
  }
  const mismatches = [];
  parsed.forEach((entry) => {
    const tsValid = validateFn(items.find((item) => item.name === entry.name).doc).valid;
    if (Boolean(tsValid) !== Boolean(entry.valid)) {
      mismatches.push(`${entry.name}: TS=${String(tsValid)} / Python=${String(entry.valid)}`);
    }
  });
  if (mismatches.length > 0) {
    return { ok: false, message: `TS/Python 结论不一致：${mismatches.join('; ')}` };
  }
  return { ok: true, message: '' };
}
