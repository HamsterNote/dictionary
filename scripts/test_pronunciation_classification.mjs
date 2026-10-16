/**
 * 任务 3.2 版本化分类纯函数离线测试（Node + Vite SSR）。
 *
 * 用 Vite SSR 加载 `src/pronunciation-overlay/classification.ts`（及其依赖的
 * `contracts.ts`），对合成观测执行分类、准入、处置、排序、安全去重与语义指纹核对。
 * 零网络、零安装、零采集、零发布；仅合成夹具。
 *
 * 在仓库根运行：`node scripts/test_pronunciation_classification.mjs`
 */

import assert from 'node:assert/strict';
import { createServer } from 'vite';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const server = await createServer({
  root: REPO_ROOT,
  logLevel: 'error',
  server: { middlewareMode: true },
});

let checks = 0;
function check(label, fn) {
  checks += 1;
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

try {
  const c = await server.ssrLoadModule('/src/pronunciation-overlay/classification.ts');
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const { scopeWith, knownScope, unknownScope, SCOPE_DIMENSIONS } = contracts;
  const {
    CLASSIFICATION_RULE_VERSION,
    classifyObservation,
    disposeObservation,
    buildReadingPlan,
    safeDedup,
    safeDedupKey,
    computeSemanticFingerprint,
    deriveNotation,
    deriveCompleteness,
    isLayoutToken,
    canonicalScope,
  } = c;

  const ENTRY = 'ent_11111111-2222-3333-4444-555555555555';
  const ENTRY_B = 'ent_22222222-2222-3333-4444-555555555555';
  const LEX = 'lex_11111111-2222-3333-4444-555555555555';

  function scope(overrides = {}) {
    return scopeWith({
      language: knownScope(['en']),
      entry: knownScope([ENTRY]),
      lexeme: knownScope([LEX]),
      role: knownScope(['base']),
      pos: knownScope(['verb']),
      sense: knownScope(['s1']),
      accent: unknownScope('accent-not-determinable'),
      other: knownScope(['no-other-restriction']),
      ...overrides,
    });
  }

  let counter = 0;
  function obs({
    rawIpa,
    normalizedIpa,
    notation,
    completeness = 'complete',
    rawTags = [],
    rawQualifiers = [],
    scopeOverrides = {},
    evidenceId = 'ev-synthetic-1',
  } = {}) {
    const derivedNormalized = normalizedIpa === undefined ? rawIpa : normalizedIpa;
    let derivedNotation = notation;
    if (derivedNotation === undefined) derivedNotation = deriveNotation(rawIpa);
    return {
      schema: 'pronunciation-observation/1',
      observationId: `obs-${(counter += 1)}`,
      evidenceId,
      language: 'en',
      sourceSpelling: 'read',
      rawIpa,
      normalizedIpa: derivedNormalized,
      notation: derivedNotation,
      completeness,
      rawTags: [...rawTags],
      rawQualifiers: [...rawQualifiers],
      structuralPath: ['English', 'Pronunciation'],
      applicability: scope(scopeOverrides),
    };
  }

  // 1. 版本化规则表
  check('rule version', () => {
    assert.equal(classifyObservation(obs({ rawIpa: '/x/' })).ruleVersion, CLASSIFICATION_RULE_VERSION);
  });

  // 2. accent 等价：保具体名称，RP≠SSB；GA 变体同 canonical
  check('accent RP variants', () => {
    for (const q of ['(RP)', '(Received Pronunciation)', '(Received-Pronunciation)']) {
      const accent = classifyObservation(obs({ rawIpa: '/x/', rawQualifiers: [q] })).accent;
      assert.equal(accent.family, 'standard');
      assert.equal(accent.canonicalName, 'RP');
      assert.equal(accent.label, 'RP');
    }
    assert.equal(classifyObservation(obs({ rawIpa: '/x/', rawQualifiers: ['(SSB)'] })).accent.canonicalName, 'SSB');
    for (const q of ['(GA)', '(General American)', '(General-American)']) {
      assert.equal(classifyObservation(obs({ rawIpa: '/x/', rawQualifiers: [q] })).accent.canonicalName, 'GA');
    }
  });

  // 3. UK/US 只有无地域限定时通用；有地域不得升通用
  check('UK/US unspecified only without region', () => {
    assert.equal(classifyObservation(obs({ rawIpa: '/x/', rawTags: ['UK'] })).accent.family, 'uk-unspecified');
    assert.equal(classifyObservation(obs({ rawIpa: '/x/', rawTags: ['US'] })).accent.family, 'us-unspecified');
    const ukRegion = classifyObservation(obs({ rawIpa: '/x/', rawTags: ['UK', 'Scotland'] })).accent;
    assert.equal(ukRegion.family, 'regional');
    assert.equal(ukRegion.label, 'Scotland');
    // 回归：UK + regional-unspecified 也不得仍为 uk-unspecified
    assert.equal(classifyObservation(obs({ rawIpa: '/x/', rawTags: ['UK', 'regional'] })).accent.family, 'regional');
  });

  // 4. 地域名保留 / 地域未细分；原始标签保留
  check('regional labels preserved', () => {
    const ne = classifyObservation(obs({ rawIpa: '/x/', rawTags: ['Northern England'] })).accent;
    assert.equal(ne.label, 'Northern England');
    assert.deepEqual(ne.rawLabels, ['Northern England']);
    assert.equal(classifyObservation(obs({ rawIpa: '/x/', rawTags: ['Southern US'] })).accent.label, 'Southern US');
    const unspec = classifyObservation(obs({ rawIpa: '/x/', rawTags: ['regional'] })).accent;
    assert.equal(unspec.family, 'regional');
    assert.equal(unspec.label, '地域未细分');
    // Scottish 原标签不丢（rawLabels 保原样）
    assert.ok(classifyObservation(obs({ rawIpa: '/x/', rawTags: ['Scottish'] })).accent.rawLabels.includes('Scottish'));
  });

  // 5. 未注明口音只单份、不复制 UK/US
  check('unspecified accent single, no UK/US copies', () => {
    const reading = obs({ rawIpa: '/x/' });
    const classification = classifyObservation(reading);
    assert.equal(classification.accent.family, 'unspecified');
    assert.equal(classification.accent.unspecified, true);
    const plan = buildReadingPlan([reading]);
    assert.equal(plan.defaults.length, 1);
    assert.deepEqual(plan.defaults.flatMap((g) => g.observations).map((o) => o.rawIpa), ['/x/']);
  });

  // 6. rare 可默认；archaic/obsolete 仅补充
  check('rare default / archaic obsolete supplemental', () => {
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', rawTags: ['rare'] })).disposition, 'default');
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', rawTags: ['archaic'] })).disposition, 'supplemental');
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', rawTags: ['obsolete'] })).disposition, 'supplemental');
    const plan = buildReadingPlan([
      obs({ rawIpa: '/x/', rawTags: ['archaic'] }),
      obs({ rawIpa: '/y/', rawTags: ['obsolete'] }),
    ]);
    assert.equal(plan.defaults.length, 0);
    assert.equal(plan.supplementals.length, 2);
  });

  // 7. 未知标签：准入但不冒充默认；显式非限制规则可 qualify；可能限制保 unresolved
  check('unknown tag kinds', () => {
    const restrictive = disposeObservation(obs({ rawIpa: '/x/', rawTags: ['mystery-grammar-marker'] }));
    assert.equal(restrictive.admitted, true);
    assert.equal(restrictive.disposition, 'unresolved');
    assert.deepEqual(restrictive.classification.unclassifiedTags, ['mystery-grammar-marker']);

    // 版本化显式非限制规则：保留 unclassified 但可参与（default）
    const nonRestrictive = disposeObservation(obs({ rawIpa: '/x/', rawTags: ['enpr'] }));
    assert.equal(nonRestrictive.disposition, 'default');
    assert.deepEqual(nonRestrictive.classification.unclassifiedTags, ['enpr']);
    assert.deepEqual(nonRestrictive.classification.unknownRestrictions, []);

    // 已知限制标签（非 rare/archaic/obsolete）保守 unresolved，不冒充状态
    const nonstandard = disposeObservation(obs({ rawIpa: '/x/', rawTags: ['nonstandard'] }));
    assert.equal(nonstandard.classification.usage.length, 0);
    assert.equal(nonstandard.disposition, 'unresolved');
  });

  // 8. 整段限定解析：已识别跨度 + 剩余限制（不被 GA 掩掉）
  check('multi-span qualifier parses leftovers', () => {
    const mixed = classifyObservation(obs({ rawIpa: '/x/', rawQualifiers: ['(GA, nonstandard)'] }));
    assert.equal(mixed.accent.canonicalName, 'GA');
    assert.deepEqual(mixed.unknownRestrictions.map((r) => r.tag), ['nonstandard']);
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', rawQualifiers: ['(GA, nonstandard)'] })).disposition, 'unresolved');

    const mixed2 = classifyObservation(obs({ rawIpa: '/x/', rawQualifiers: ['(GA mystery-limit)'] }));
    assert.equal(mixed2.accent.canonicalName, 'GA');
    assert.ok(mixed2.unknownRestrictions.some((r) => r.tag.includes('mystery')));
  });

  // 9. notation / completeness：不因定界符就宣称完整；decoded 控制也拒
  check('notation and completeness', () => {
    assert.equal(deriveNotation('/x/'), 'phonemic');
    assert.equal(deriveNotation('[x]'), 'phonetic');
    assert.equal(deriveNotation('x'), 'unknown');
    assert.equal(deriveCompleteness('/x/'), 'complete');
    assert.equal(deriveCompleteness('[x]'), 'complete');
    for (const bad of ['/x]/', '/x/ /y/', '/ /', '[]', '//']) {
      assert.notEqual(deriveCompleteness(bad), 'complete', bad);
    }
    assert.equal(deriveCompleteness('/x\u007f/'), 'control-character');
    // decoded 控制字符（实体形式）
    assert.equal(deriveCompleteness('/x&#x200b;/'), 'control-character');
    assert.equal(disposeObservation(obs({ rawIpa: '/x&#x200b;/' })).disposition, 'evidence-only');
    assert.equal(deriveCompleteness('x'), 'broken-delimiter');
    assert.equal(deriveCompleteness(''), 'empty');
    // 上游声明非 complete 不得凭外形升级
    assert.equal(deriveCompleteness('/x/', 'fragment'), 'fragment');
    assert.equal(deriveCompleteness('/x/', 'truncated'), 'truncated');
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', completeness: 'fragment' })).disposition, 'evidence-only');
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', completeness: 'truncated' })).disposition, 'evidence-only');
  });

  // 10. 片段/空/控制/截断 → evidence-only
  check('incomplete readings evidence-only', () => {
    for (const rawIpa of ['/x]/', '/x/ /y/', '/ /', '', '/x\u007f/', 'x']) {
      assert.equal(disposeObservation(obs({ rawIpa })).disposition, 'evidence-only', rawIpa);
    }
  });

  // 11. phonemic 优先 phonetic（同 accent + 同完整 scope）；仅 phonetic 可默认；不同 accent 不互配
  check('phonemic preferred over phonetic same accent', () => {
    const group = [
      obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], scopeOverrides: { accent: knownScope(['RP']) } }),
      obs({ rawIpa: '[x]', rawQualifiers: ['(RP)'], scopeOverrides: { accent: knownScope(['RP']) } }),
    ];
    const plan = buildReadingPlan(group);
    assert.equal(plan.defaults.length, 1);
    assert.equal(plan.defaults[0].observations[0].rawIpa, '/x/');
    assert.equal(plan.supplementals.length, 1);
    assert.equal(plan.supplementals[0].observations[0].rawIpa, '[x]');
  });

  check('phonetic-only can default and keep [ ]', () => {
    const plan = buildReadingPlan([obs({ rawIpa: '[x]', rawQualifiers: ['(RP)'] })]);
    assert.equal(plan.defaults.length, 1);
    assert.equal(plan.defaults[0].observations[0].rawIpa, '[x]');
  });

  check('different accents do not pair phonemic/phonetic', () => {
    const plan = buildReadingPlan([
      obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] }),
      obs({ rawIpa: '[x]', rawQualifiers: ['(GA)'] }),
    ]);
    assert.equal(plan.defaults.length, 2);
  });

  // 12. plan 保留原 input index 与逐条 classification（不被首项代表）
  check('plan preserves input indices and per-observation metadata', () => {
    const readings = [
      obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['rare'] }),
      obs({ rawIpa: '/y/', rawQualifiers: ['(RP)'] }),
    ];
    const plan = buildReadingPlan(readings);
    const indices = plan.defaults.flatMap((group) => group.indices);
    assert.deepEqual([...indices].sort((a, b) => a - b), [0, 1]);
    assert.ok(indices.every((index) => index >= 0), `indices 不应为 -1: ${indices}`);
    for (const group of plan.defaults) {
      assert.equal(group.classifications.length, group.observations.length);
      group.classifications.forEach((classification, position) => {
        assert.equal(classification.preserved.rawIpa, group.observations[position].rawIpa);
      });
    }
    // rare 与无标签各自 metadata 保留（不被首项代表）
    const usageByIndex = new Map();
    plan.defaults.forEach((group) => {
      group.indices.forEach((index, position) => usageByIndex.set(index, group.classifications[position].usage));
    });
    assert.deepEqual(usageByIndex.get(0), ['rare']);
    assert.deepEqual(usageByIndex.get(1), []);
  });

  // 13. 地域：通用存在时补充；仅地域（同 identity）可默认；他词 general 不影响本词
  check('regional decisions scoped per identity', () => {
    const withGeneral = buildReadingPlan([
      obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] }),
      obs({ rawIpa: '/y/', rawTags: ['Scotland'] }),
    ]);
    assert.equal(withGeneral.defaults.length, 1);
    assert.equal(withGeneral.supplementals.length, 1);
    assert.equal(withGeneral.supplementals[0].accent.label, 'Scotland');

    const regionalOnly = buildReadingPlan([obs({ rawIpa: '/y/', rawTags: ['Scotland'] })]);
    assert.equal(regionalOnly.defaults.length, 1);
    assert.equal(regionalOnly.defaults[0].accent.label, 'Scotland');

    // 不同 entry：entry A 有 general 不应把 entry B 的 regional-only 降级
    const crossEntry = buildReadingPlan([
      obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] }), // entry A
      obs({ rawIpa: '/y/', rawTags: ['Scotland'], scopeOverrides: { entry: knownScope([ENTRY_B]) } }), // entry B
    ]);
    assert.ok(
      crossEntry.defaults.some((group) => group.accent.label === 'Scotland'),
      'different entry general 不得降级本词 regional-only',
    );
  });

  // 14. scope 未确定 → unresolved；严格三态；confirmed 标记不能绕过
  check('unknown scope unresolved / strict three-state / no bypass', () => {
    const unresolvedScope = disposeObservation(
      obs({ rawIpa: '/x/', scopeOverrides: { role: unknownScope('role-not-determinable') } }),
    );
    assert.equal(unresolvedScope.disposition, 'unresolved');
    assert.ok(unresolvedScope.classification.scopeEligibility.unresolvedReasons.includes('scope-unresolved:role'));

    // confirmedScopeDimensions 不能把 unknown 变 known → 仍 unresolved
    const confirmedAttempt = disposeObservation(
      obs({ rawIpa: '/x/', scopeOverrides: { role: unknownScope('role-not-determinable') } }),
      { confirmedScopeDimensions: ['role'] },
    );
    assert.equal(confirmedAttempt.disposition, 'unresolved');

    // requiredScopeDimensions 为空数组也不能缩减默认必需集
    const shrinkAttempt = disposeObservation(
      obs({ rawIpa: '/x/', scopeOverrides: { entry: unknownScope('entry-not-determinable') } }),
      { requiredScopeDimensions: [] },
    );
    assert.equal(shrinkAttempt.disposition, 'unresolved');

    const invalid = classifyObservation(obs({ rawIpa: '/x/', scopeOverrides: { language: { kind: 'all' } } }));
    assert.ok(invalid.scopeEligibility.invalidReasons.includes('scope-invalid:language'));

    const explicit = disposeObservation(
      obs({ rawIpa: '/x/', scopeOverrides: { sense: { kind: 'explicit-all', evidence: ['ev-synthetic-1'] } } }),
    );
    assert.equal(explicit.disposition, 'default');
  });

  // 15. 安全去重：同证据 + 完整 scope + notation + completeness + 语义限制 + raw IPA
  check('safe dedup true duplicates only', () => {
    const a = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] });
    const b = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] });
    assert.equal(safeDedup([a, b]).length, 1);
    assert.deepEqual(safeDedup([a, b])[0].indices, [0, 1]);

    const differentScope = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], scopeOverrides: { role: knownScope(['past']) } });
    assert.equal(safeDedup([a, differentScope]).length, 2);

    const archaic = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['archaic'] });
    assert.equal(safeDedup([a, archaic]).length, 2);

    const differentEvidence = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], evidenceId: 'ev-2' });
    assert.equal(safeDedup([a, differentEvidence]).length, 2);

    const ga = obs({ rawIpa: '/x/', rawQualifiers: ['(GA)'] });
    assert.equal(safeDedup([a, ga]).length, 2);

    // 跨 completeness 不合并
    const declaredFragment = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], completeness: 'fragment' });
    assert.equal(safeDedup([a, declaredFragment]).length, 2);

    // scope 身份值精确：a-b 与 a_b 不合并
    const hyphen = obs({ rawIpa: '/x/', scopeOverrides: { role: knownScope(['a-b']) } });
    const underscore = obs({ rawIpa: '/x/', scopeOverrides: { role: knownScope(['a_b']) } });
    assert.equal(safeDedup([hyphen, underscore]).length, 2);

    // accent scope known vs unknown 不合并（unknown 不当可比等价）
    const accentKnown = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], scopeOverrides: { accent: knownScope(['RP']) } });
    const accentUnknown = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] });
    assert.equal(safeDedup([accentKnown, accentUnknown]).length, 2);

    // stale normalizedIpa 不跨真实 IPA 合并
    const stale1 = obs({ rawIpa: '/x/', normalizedIpa: '/z/', rawQualifiers: ['(RP)'] });
    const stale2 = obs({ rawIpa: '/x/', normalizedIpa: '/z/', rawQualifiers: ['(RP)'] });
    assert.equal(safeDedup([stale1, stale2]).length, 2);
  });

  // 16. 语义指纹：layout 不触发；IPA/accent/scope/usage/unknown 触发；实体/NFC/trim 不误报
  check('semantic fingerprint triggers correctly', () => {
    const base = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['IPA'] });
    const layoutChanged = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['IPA', 'mw-heading'] });
    assert.equal(computeSemanticFingerprint(base), computeSemanticFingerprint(layoutChanged));

    assert.notEqual(computeSemanticFingerprint(base), computeSemanticFingerprint(obs({ rawIpa: '/y/', rawQualifiers: ['(RP)'], rawTags: ['IPA'] })));
    assert.notEqual(computeSemanticFingerprint(base), computeSemanticFingerprint(obs({ rawIpa: '/x/', rawQualifiers: ['(GA)'], rawTags: ['IPA'] })));
    assert.notEqual(
      computeSemanticFingerprint(base),
      computeSemanticFingerprint(obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['IPA'], scopeOverrides: { role: knownScope(['past']) } })),
    );
    assert.notEqual(computeSemanticFingerprint(base), computeSemanticFingerprint(obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['IPA', 'rare'] })));
    assert.notEqual(computeSemanticFingerprint(base), computeSemanticFingerprint(obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['IPA', 'foobar'] })));
    // scope unknown 状态本身参与语义
    assert.notEqual(
      computeSemanticFingerprint(obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['x']) } })),
      computeSemanticFingerprint(obs({ rawIpa: '/x/', scopeOverrides: { other: unknownScope('x') } })),
    );

    const composed = obs({ rawIpa: '/x/', rawQualifiers: ['(caf\u00e9)'] });
    const decomposed = obs({ rawIpa: '/x/', rawQualifiers: ['(cafe\u0301)'] });
    const entity = obs({ rawIpa: '/x/', rawQualifiers: ['(caf&#233;)'] });
    const padded = obs({ rawIpa: '/x/', rawQualifiers: ['  (caf\u00e9)  '] });
    assert.equal(computeSemanticFingerprint(composed), computeSemanticFingerprint(decomposed));
    assert.equal(computeSemanticFingerprint(composed), computeSemanticFingerprint(entity));
    assert.equal(computeSemanticFingerprint(composed), computeSemanticFingerprint(padded));
  });

  // 17. scope 身份精确：accent-only 派生；other 同义（RP vs Received Pronunciation）不因降维而合并
  check('scope identity exact / accent-only derivation', () => {
    const accentOnly = classifyObservation(obs({ rawIpa: '/x/', scopeOverrides: { accent: knownScope(['RP']) } }));
    assert.equal(accentOnly.accent.canonicalName, 'RP');
    const rpOther = obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['(RP)']) } });
    const fullOther = obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['(Received Pronunciation)']) } });
    assert.notEqual(safeDedupKey(rpOther), safeDedupKey(fullOther));
    assert.notEqual(computeSemanticFingerprint(rpOther), computeSemanticFingerprint(fullOther));
    const composed = obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['caf\u00e9']) } });
    const decomposed = obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['cafe\u0301']) } });
    assert.equal(safeDedupKey(composed), safeDedupKey(decomposed));
  });

  // 18. raw 原值完整保留（含实体/变音符/标签不 trim）
  check('raw preserved unchanged', () => {
    const raw = '/ri&#720;d/ \u02c8';
    const reading = obs({ rawIpa: raw, normalizedIpa: raw, rawTags: ['IPA ', ' mw-heading'], rawQualifiers: ['  (RP)  '] });
    const classification = classifyObservation(reading);
    assert.equal(classification.preserved.rawIpa, raw);
    assert.deepEqual(classification.preserved.rawTags, ['IPA ', ' mw-heading']);
    assert.deepEqual(classification.preserved.rawQualifiers, ['  (RP)  ']);
    assert.equal(classifyObservation(reading).accent.canonicalName, 'RP');
  });

  // 19. isLayoutToken 谨慎：不 broad-prefix 吞 grammar 限制
  check('isLayoutToken cautious', () => {
    assert.equal(isLayoutToken('mw-heading'), true);
    assert.equal(isLayoutToken('IPA'), true);
    assert.equal(isLayoutToken('heading:Etymology'), true);
    assert.equal(isLayoutToken('inflection-grammar'), false);
    assert.equal(isLayoutToken('metadata-x'), false);
    assert.equal(isLayoutToken('template-param'), false);
    assert.equal(isLayoutToken('mystery-grammar-marker'), false);
  });

  // 20. 多标准名 / 标准+地域冲突：不冒充单一 general，保全部原 label
  check('conflicting/multiple accent labels', () => {
    const multi = classifyObservation(obs({ rawIpa: '/x/', rawTags: ['RP', 'GA'] })).accent;
    assert.equal(multi.family, 'unknown');
    assert.equal(multi.unknownReason, 'multiple-standard-accents');
    assert.ok(multi.label.includes('RP') && multi.label.includes('GA'));

    const conflict = classifyObservation(obs({ rawIpa: '/x/', rawTags: ['RP', 'Scotland'] })).accent;
    assert.equal(conflict.family, 'unknown');
    assert.equal(conflict.unknownReason, 'conflicting-standard-region');
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', rawTags: ['RP', 'Scotland'] })).disposition, 'unresolved');
  });

  // 21. JSON 可序列化，含版本与 per-observation metadata
  check('classification/plan JSON serializable', () => {
    const reading = obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'], rawTags: ['archaic'] });
    const classification = classifyObservation(reading);
    const restored = JSON.parse(JSON.stringify(classification));
    assert.equal(restored.ruleVersion, CLASSIFICATION_RULE_VERSION);
    assert.ok(Array.isArray(restored.reasons));
    const plan = buildReadingPlan([reading]);
    const planRestored = JSON.parse(JSON.stringify(plan));
    assert.equal(planRestored.ruleVersion, CLASSIFICATION_RULE_VERSION);
    assert.equal(planRestored.supplementals.length, 1);
    assert.equal(planRestored.supplementals[0].classifications.length, 1);
  });

  // 22. 8 维覆盖
  check('covers 8 scope dimensions', () => {
    assert.equal(SCOPE_DIMENSIONS.length, 8);
    assert.ok(SCOPE_DIMENSIONS.includes('lexeme'));
    assert.deepEqual(Object.keys(canonicalScope(scope())).sort(), [...SCOPE_DIMENSIONS].sort());
  });

  // 23. 声明 unknown notation 不得猜；冲突不得 upgrade
  check('declared unknown notation not guessed', () => {
    const declaredUnknown = disposeObservation(obs({ rawIpa: '/x/', notation: 'unknown' }));
    assert.equal(declaredUnknown.classification.notation, 'unknown');
    assert.equal(declaredUnknown.disposition, 'evidence-only');

    const conflict = disposeObservation(obs({ rawIpa: '/x/', notation: 'phonetic' })); // derived phonemic
    assert.equal(conflict.classification.notationConflict, true);
    assert.equal(conflict.disposition, 'unresolved');

    const noUpgrade = disposeObservation(obs({ rawIpa: 'x', notation: 'phonemic' })); // derived unknown
    assert.equal(noUpgrade.classification.notation, 'unknown');
    assert.equal(noUpgrade.disposition, 'evidence-only');
  });

  // 24. scope accent known 整段解析（含 leftovers），不得因 GA 掩掉限制
  check('scope accent leftover parsed', () => {
    const reading = obs({ rawIpa: '/x/', scopeOverrides: { accent: knownScope(['GA, nonstandard']) } });
    const classification = classifyObservation(reading);
    assert.equal(classification.accent.canonicalName, 'GA');
    assert.ok(classification.unknownRestrictions.some((r) => r.tag === 'nonstandard'));
    assert.equal(disposeObservation(reading).disposition, 'unresolved');
  });

  // 25. mw- semantic class 不当 layout
  check('mw semantic class not layout', () => {
    assert.equal(isLayoutToken('mw-dialect-only'), false);
    assert.equal(isLayoutToken('mw-parser-output'), true);
    assert.equal(disposeObservation(obs({ rawIpa: '/x/', rawTags: ['mw-dialect-only'] })).disposition, 'unresolved');
  });

  // 26. 未知 other 限制不得当默认；明确无限制/all 才可
  check('unknown other restriction unresolved', () => {
    const restricted = disposeObservation(
      obs({ rawIpa: '/x/', scopeOverrides: { other: unknownScope('possibly only a restricted grammatical construction') } }),
    );
    assert.equal(restricted.disposition, 'unresolved');
    assert.ok(restricted.classification.scopeEligibility.unresolvedReasons.includes('scope-unresolved:other'));
    assert.equal(
      disposeObservation(obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['no-other-restriction']) } })).disposition,
      'default',
    );
    assert.equal(
      disposeObservation(obs({ rawIpa: '/x/', scopeOverrides: { other: { kind: 'explicit-all', evidence: ['obs-self'] } } })).disposition,
      'default',
    );
  });

  // 27. unspecified accent 不假 phonemic 优先；确定 accent 正例才优先
  check('unspecified accent does not suppress phonetic', () => {
    const plan = buildReadingPlan([obs({ rawIpa: '/x/' }), obs({ rawIpa: '[x]' })]);
    assert.equal(plan.defaults.length, 2);
    assert.deepEqual(
      plan.defaults.flatMap((g) => g.observations.map((o) => o.rawIpa)).sort(),
      ['/x/', '[x]'],
    );
    assert.equal(plan.supplementals.length, 0);

    const determined = buildReadingPlan([
      obs({ rawIpa: '/x/', rawQualifiers: ['(RP)'] }),
      obs({ rawIpa: '[x]', rawQualifiers: ['(RP)'] }),
    ]);
    assert.equal(determined.defaults.length, 1);
    assert.equal(determined.defaults[0].observations[0].rawIpa, '/x/');
    assert.equal(determined.supplementals.length, 1);
  });

  // 28. 指纹：unknown 措辞 / explicit-all 证据 ref 不误触发；状态与限制变化触发
  check('fingerprint ignores non-semantic scope wording/refs', () => {
    const reasonA = obs({ rawIpa: '/x/', scopeOverrides: { other: unknownScope('reason wording A') } });
    const reasonB = obs({ rawIpa: '/x/', scopeOverrides: { other: unknownScope('totally different wording B') } });
    assert.equal(computeSemanticFingerprint(reasonA), computeSemanticFingerprint(reasonB));

    const allA = obs({ rawIpa: '/x/', scopeOverrides: { other: { kind: 'explicit-all', evidence: ['ev-a'] } } });
    const allB = obs({ rawIpa: '/x/', scopeOverrides: { other: { kind: 'explicit-all', evidence: ['ev-b'] } } });
    assert.equal(computeSemanticFingerprint(allA), computeSemanticFingerprint(allB));

    assert.notEqual(
      computeSemanticFingerprint(reasonA),
      computeSemanticFingerprint(obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['x']) } })),
    );
    assert.notEqual(
      computeSemanticFingerprint(obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['x']) } })),
      computeSemanticFingerprint(obs({ rawIpa: '/x/', scopeOverrides: { other: knownScope(['y']) } })),
    );
    assert.equal(
      computeSemanticFingerprint(obs({ rawIpa: '/x/', rawTags: ['IPA'] })),
      computeSemanticFingerprint(obs({ rawIpa: '/x/', rawTags: ['IPA', 'mw-parser-output'] })),
    );
    assert.notEqual(
      computeSemanticFingerprint(obs({ rawIpa: '/x/', rawTags: ['IPA'] })),
      computeSemanticFingerprint(obs({ rawIpa: '/x/', rawTags: ['IPA', 'archaic'] })),
    );
  });

  console.log(`test_pronunciation_classification: OK (${checks} checks)`);
} finally {
  await server.close();
}
