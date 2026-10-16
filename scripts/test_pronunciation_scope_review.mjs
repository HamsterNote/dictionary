/**
 * task 3.1（适用范围匹配）与 task 3.4（六个日历月复核 / 相关语义提醒）的离线单元测试。
 *
 * 运行：`node scripts/test_pronunciation_scope_review.mjs`
 * 全部为合成夹具（synthetic），零网络、零安装；经本仓库既有 Vite SSR + Node `assert` 方式加载 TS。
 *
 * 只覆盖本 lane 新增的 `src/pronunciation-overlay/scope.ts` 与 `review.ts`；
 * 不触碰 contracts / json / identity、不改旧测试、不写 resolver、不勾 tasks。
 */

import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const scope = await server.ssrLoadModule('/src/pronunciation-overlay/scope.ts');
  const review = await server.ssrLoadModule('/src/pronunciation-overlay/review.ts');

  const {
    PRONUNCIATION_SCHEMA,
    SCOPE_DIMENSIONS,
    knownScope,
    unknownScope,
    explicitAllScope,
    scopeWith,
    validateScopeConstraint,
    validateRule,
  } = contracts;
  const {
    matchApplicabilityScopes,
    isExactScopeMatch,
    isDisjointScopeMatch,
    isUnresolvedScopeMatch,
    validateScopeMatchInputs,
    describeScopeMatch,
  } = scope;
  const {
    addCalendarMonthsUtc,
    computeReviewTiming,
    computeReviewDueAt,
    diffRelatedSemantics,
    evaluateReviewStatus,
    applyReviewEvent,
    revokeRule,
    replaceRule,
    REVIEW_PERIOD_MONTHS,
  } = review;

  const ENTRY_ID = 'ent_11111111-2222-3333-4444-555555555555';

  /** 八维全 known 的基线范围；可对单维 override，用于逐维验证。 */
  function knownAll(value = 'same', overrides = {}) {
    const base = {};
    for (const dimension of SCOPE_DIMENSIONS) base[dimension] = knownScope([value]);
    return scopeWith({ ...base, ...overrides });
  }

  // =========================================================================
  // A. task 3.1 适用范围匹配
  // =========================================================================

  // A1. 八维逐一：known 取值无交集 → 该维 disjoint 且整体 disjoint。
  for (const dimension of SCOPE_DIMENSIONS) {
    const left = knownAll('same');
    const right = knownAll('same', { [dimension]: knownScope(['other']) });
    const match = matchApplicabilityScopes(left, right);
    assert.equal(match.result, 'disjoint', `dimension ${dimension} 应整体 disjoint`);
    assert.equal(isDisjointScopeMatch(match), true);
    const dim = match.dimensions.find((item) => item.dimension === dimension);
    assert.equal(dim.relation, 'disjoint', `dimension ${dimension} 应为 disjoint`);
    // 其余维度 exact，说明 disjoint 来源精确到该维。
    assert.equal(
      match.dimensions.filter((item) => item.relation === 'exact').length,
      SCOPE_DIMENSIONS.length - 1,
    );
  }

  // A2. 八维逐一：unknown 不是 wildcard → 该维 unresolved，整体 unresolved。
  for (const dimension of SCOPE_DIMENSIONS) {
    const match = matchApplicabilityScopes(
      knownAll('same'),
      knownAll('same', { [dimension]: unknownScope(`未指定 ${dimension}`) }),
    );
    assert.equal(match.result, 'unresolved', `dimension ${dimension} unknown 应 unresolved`);
    assert.equal(isUnresolvedScopeMatch(match), true);
    // unknown 不得被当成等价或不相交。
    assert.equal(isDisjointScopeMatch(match), false);
    assert.equal(isExactScopeMatch(match), false);
    const dim = match.dimensions.find((item) => item.dimension === dimension);
    assert.equal(dim.relation, 'unresolved');
  }

  // A3. 八维逐一：explicit-all（带证据）是明确的覆盖关系，而非缺省。
  for (const dimension of SCOPE_DIMENSIONS) {
    const match = matchApplicabilityScopes(
      knownAll('same', { [dimension]: explicitAllScope(['ev-synthetic-all']) }),
      knownAll('same'),
    );
    assert.equal(match.result, 'comparable', `dimension ${dimension} explicit-all 应 comparable`);
    const dim = match.dimensions.find((item) => item.dimension === dimension);
    assert.equal(dim.relation, 'all-covers-left');
    // 反向：left known、right explicit-all。
    const reverse = matchApplicabilityScopes(
      knownAll('same'),
      knownAll('same', { [dimension]: explicitAllScope(['ev-synthetic-all']) }),
    );
    assert.equal(reverse.dimensions.find((item) => item.dimension === dimension).relation, 'all-covers-right');
    // 双方 explicit-all。
    const both = matchApplicabilityScopes(
      knownAll('same', { [dimension]: explicitAllScope(['ev-a']) }),
      knownAll('same', { [dimension]: explicitAllScope(['ev-b']) }),
    );
    assert.equal(both.dimensions.find((item) => item.dimension === dimension).relation, 'all-both');
  }

  // A4. 部分集合不等价：subset / overlap 暴露精确信息，绝不宣称整 scope 等价。
  {
    const narrow = knownAll('same', { accent: knownScope(['US']) });
    const wide = knownAll('same', { accent: knownScope(['US', 'GA']) });
    const widened = matchApplicabilityScopes(narrow, wide);
    const narrowed = matchApplicabilityScopes(wide, narrow);
    assert.equal(widened.dimensions.find((d) => d.dimension === 'accent').relation, 'left-subset');
    assert.equal(narrowed.dimensions.find((d) => d.dimension === 'accent').relation, 'right-subset');
    assert.equal(isExactScopeMatch(widened), false);
    assert.equal(isExactScopeMatch(narrowed), false);

    const left = knownAll('same', { accent: knownScope(['US', 'RP']) });
    const right = knownAll('same', { accent: knownScope(['US', 'GA']) });
    const overlap = matchApplicabilityScopes(left, right);
    const accent = overlap.dimensions.find((d) => d.dimension === 'accent');
    assert.equal(accent.relation, 'overlap');
    assert.deepEqual(accent.shared, ['US']);
    assert.deepEqual(accent.leftOnly, ['RP']);
    assert.deepEqual(accent.rightOnly, ['GA']);
    // 有交集 ≠ 等价。
    assert.equal(isExactScopeMatch(overlap), false);
    assert.equal(overlap.result, 'comparable');
  }

  // A5. base / past 负例：不同 role 取值确定 disjoint，不互相推导（也不从 IPA/拼写推身份）。
  {
    const base = knownAll('same', { role: knownScope(['base']) });
    const past = knownAll('same', { role: knownScope(['past']) });
    const pastParticiple = knownAll('same', { role: knownScope(['past-participle']) });
    assert.equal(matchApplicabilityScopes(base, past).result, 'disjoint');
    assert.equal(matchApplicabilityScopes(past, pastParticiple).result, 'disjoint');
    // 明确多 role 的同一来源可与单 role 交集为可比；但不整 scope 等价。
    const multi = knownAll('same', { role: knownScope(['base', 'present']) });
    const single = knownAll('same', { role: knownScope(['base']) });
    const shared = matchApplicabilityScopes(multi, single);
    assert.equal(shared.dimensions.find((d) => d.dimension === 'role').relation, 'right-subset');
  }

  // A6. 任一确定 disjoint 可整体 disjoint：其他 unknown 不改变结论。
  {
    const left = knownAll('same', { language: knownScope(['en']) });
    const right = knownAll('same', {
      language: knownScope(['fr']),
      pos: unknownScope('POS 未确定'),
      accent: unknownScope('口音未确定'),
    });
    const match = matchApplicabilityScopes(left, right);
    assert.equal(match.result, 'disjoint');
    assert.equal(isDisjointScopeMatch(match), true);
  }

  // A7. 复用既有 validator：无效范围理由码与 contracts 一致，不重复实现。
  {
    // unknown 缺 reason。
    assert.equal(validateScopeMatchInputs(knownAll('same'), knownAll('same', { pos: { kind: 'unknown' } })).valid, false);
    const missingReason = validateScopeMatchInputs(knownAll('same'), knownAll('same', { pos: { kind: 'unknown' } }));
    assert.ok(missingReason.issues.some((issue) => issue.code === 'scope-unknown-reason'));

    // known 空取值。
    const emptyKnown = validateScopeMatchInputs(knownAll('same'), knownAll('same', { pos: { kind: 'known', values: [] } }));
    assert.ok(emptyKnown.issues.some((issue) => issue.code === 'scope-known-empty'));

    // unknown 当全范围 / kind 非法。
    const badKind = validateScopeMatchInputs(knownAll('same'), knownAll('same', { pos: { kind: 'all' } }));
    assert.ok(badKind.issues.some((issue) => issue.code === 'scope-unknown-as-all'));

    // explicit-all 缺证据。
    const noEvidence = validateScopeMatchInputs(knownAll('same'), knownAll('same', { pos: { kind: 'explicit-all' } }));
    assert.ok(noEvidence.issues.some((issue) => issue.code === 'scope-all-evidence'));

    // 缺维度。
    const missingDimension = validateScopeMatchInputs(knownAll('same'), { language: knownScope(['en']) });
    assert.ok(missingDimension.issues.some((issue) => issue.code === 'scope-missing-dimension'));

    // null 输入。
    const nullInput = validateScopeMatchInputs(null, knownAll('same'));
    assert.equal(nullInput.valid, false);
    assert.ok(nullInput.issues.some((issue) => issue.code === 'scope-required'));

    // 合法输入。
    assert.equal(validateScopeMatchInputs(knownAll('same'), knownAll('same')).valid, true);
    // 单维 validateScopeConstraint 直接复用（contracts 导出）。
    const direct = [];
    validateScopeConstraint({ kind: 'unknown' }, 'x', direct);
    assert.ok(direct.some((issue) => issue.code === 'scope-unknown-reason'));
  }

  // A8. 匹配 fail closed：公开 API 校验两侧范围，无效输入抛错而非 comparable。
  {
    const badScopes = [
      { pos: { kind: 'unknown' } }, // unknown 缺 reason
      { pos: { kind: 'known', values: [] } }, // 空 known
      { pos: { kind: 'explicit-all' } }, // 空 explicit-all.evidence
      { pos: { kind: 'all' } }, // 非法 kind
    ];
    for (const override of badScopes) {
      assert.throws(
        () => matchApplicabilityScopes(knownAll('same'), knownAll('same', override)),
        /无效适用范围/,
        JSON.stringify(override),
      );
    }
    // 缺维度。
    assert.throws(
      () => matchApplicabilityScopes(knownAll('same'), { language: knownScope(['en']) }),
      /无效适用范围/,
    );
    // 空 dimensions 不能冒充整 scope 等价。
    assert.throws(() => matchApplicabilityScopes(knownAll('same'), knownAll('same'), []), RangeError);
  }

  // A9. 局部维度只代表局部：wholeScope / isExactScopeMatch 不得做 vacuous 整 scope 证明。
  {
    const partial = matchApplicabilityScopes(knownAll('same'), knownAll('same'), ['language', 'pos']);
    assert.equal(partial.result, 'comparable');
    assert.equal(partial.wholeScope, false);
    assert.deepEqual(partial.comparedDimensions, ['language', 'pos']);
    assert.equal(isExactScopeMatch(partial), false); // 即使所比维度全 exact，也不构成整 scope 等价

    const full = matchApplicabilityScopes(knownAll('same'), knownAll('same'));
    assert.equal(full.wholeScope, true);
    assert.equal(isExactScopeMatch(full), true);
  }

  // A10. 匹配只读 scope 维度，不从 IPA/word/translation 推身份（断言描述可用且无此入口）。
  assert.equal(
    typeof describeScopeMatch(matchApplicabilityScopes(knownAll('same'), knownAll('same'))),
    'string',
  );

  // =========================================================================
  // B. task 3.4 六个日历月复核与相关语义提醒
  // =========================================================================

  // B1. UTC 日历月 + 月末裁剪。
  assert.equal(REVIEW_PERIOD_MONTHS, 6);
  assert.equal(addCalendarMonthsUtc('2026-01-31', 6), '2026-07-31'); // Jan31 → Jul31（有 31 日）
  assert.equal(addCalendarMonthsUtc('2026-07-31', 6), '2027-01-31'); // Jul31 → Jan31
  assert.equal(addCalendarMonthsUtc('2026-08-31', 6), '2027-02-28'); // 非闰年 2 月裁剪到 28
  assert.equal(addCalendarMonthsUtc('2027-08-31', 6), '2028-02-29'); // 闰年 2 月裁剪到 29
  assert.equal(addCalendarMonthsUtc('2026-01-31T12:30:00Z', 6), '2026-07-31T12:30:00Z'); // 保留时分秒
  assert.throws(() => addCalendarMonthsUtc('2026-02-30', 6), RangeError); // 非法日期拒绝
  // 仅 UTC：拒绝时区偏移与缺 Z 的本地时间，避免按原日期保留 offset 算错。
  assert.throws(() => addCalendarMonthsUtc('2026-08-31T23:00:00-05:00', 6), RangeError);
  assert.throws(() => addCalendarMonthsUtc('2026-08-31T23:00:00', 6), RangeError);
  // 非法时钟 / 月份 / 年份。
  assert.throws(() => addCalendarMonthsUtc('2026-01-31T25:00:00Z', 6), RangeError);
  assert.throws(() => addCalendarMonthsUtc('2026-01-31T10:60:00Z', 6), RangeError);
  assert.throws(() => addCalendarMonthsUtc('2026-13-01', 6), RangeError);
  assert.throws(() => addCalendarMonthsUtc('0000-01-01', 6), RangeError);
  // months 必须是有限整数。
  assert.throws(() => addCalendarMonthsUtc('2026-01-31', 6.5), RangeError);
  assert.throws(() => addCalendarMonthsUtc('2026-01-31', Number.NaN), RangeError);
  assert.throws(() => addCalendarMonthsUtc('2026-01-31', Number.POSITIVE_INFINITY), RangeError);

  // B2. 基准：lastVerifiedAt 优先于 createdAt；两者皆无 → unknown（不伪填今天）。
  const ruleWithBoth = {
    schema: PRONUNCIATION_SCHEMA.rule,
    ruleId: 'rule-synthetic-1',
    origin: 'user',
    target: { kind: 'entry', entryId: ENTRY_ID },
    operations: [{ field: 'phonetic', op: 'set', value: '/riːd/' }],
    conditions: scopeWith({}),
    evidenceRefs: [],
    createdAt: '2026-01-31',
    lastVerifiedAt: '2026-03-15',
    reviewStatus: 'active',
  };
  const timingBoth = computeReviewTiming(ruleWithBoth);
  assert.equal(timingBoth.baseSource, 'lastVerifiedAt');
  assert.equal(timingBoth.baseAt, '2026-03-15');
  assert.equal(timingBoth.dueAt, '2026-09-15');
  assert.equal(computeReviewDueAt(ruleWithBoth), '2026-09-15');

  const ruleCreatedOnly = { ...ruleWithBoth, lastVerifiedAt: undefined };
  const timingCreated = computeReviewTiming(ruleCreatedOnly);
  assert.equal(timingCreated.baseSource, 'createdAt');
  assert.equal(timingCreated.dueAt, '2026-07-31');

  const ruleNoTimestamp = {
    ...ruleWithBoth,
    createdAt: undefined,
    createdAtUnknownReason: '旧规则无 timestamp',
    lastVerifiedAt: undefined,
    reviewStatus: 'pending-review',
  };
  const timingUnknown = computeReviewTiming(ruleNoTimestamp);
  assert.equal(timingUnknown.baseSource, 'unknown');
  assert.equal(timingUnknown.dueAt, undefined);
  assert.ok(typeof timingUnknown.unresolvedReason === 'string' && timingUnknown.unresolvedReason.length > 0);

  // B3. 无 timestamp：保持有效待复核，不伪填今天、不撤销、不降级。
  const evalUnknown = evaluateReviewStatus(ruleNoTimestamp, { now: '2030-01-01' });
  assert.equal(evalUnknown.reviewStatus, 'pending-review');
  assert.equal(evalUnknown.dueAt, undefined);
  assert.equal(evalUnknown.priorityPreserved, true);
  assert.equal(evalUnknown.revoked, false);
  assert.equal(evalUnknown.replaced, false);

  // B4. 到期 → due；priorityPreserved；不自动撤销/替代/fallback。
  const evalBefore = evaluateReviewStatus(ruleCreatedOnly, { now: '2026-07-30' });
  assert.equal(evalBefore.reviewStatus, 'active');
  const evalOnDue = evaluateReviewStatus(ruleCreatedOnly, { now: '2026-07-31' });
  assert.equal(evalOnDue.reviewStatus, 'due');
  assert.equal(evalOnDue.priorityPreserved, true);
  assert.equal(evalOnDue.revoked, false);
  assert.equal(evalOnDue.replaced, false);
  assert.ok(evalOnDue.reasons.some((reason) => reason.includes('不降级')));

  // B4b. 既有 pending-review / due 必须 persist，普通评估与「尚未到期」都不清回 active。
  {
    // 到期日 2026-07-31，但当前 2026-10-12 仍待复核（主编排实测场景）。
    const pendingRule = { ...ruleCreatedOnly, reviewStatus: 'pending-review' };
    const evalPending = evaluateReviewStatus(pendingRule, { now: '2026-10-12' });
    assert.equal(evalPending.reviewStatus, 'pending-review');
    assert.equal(evalPending.priorityPreserved, true);
    // 尚未到期也不把 due 清回 active。
    const dueRule = { ...ruleCreatedOnly, reviewStatus: 'due' };
    const evalDueEarly = evaluateReviewStatus(dueRule, { now: '2026-01-01' });
    assert.equal(evalDueEarly.reviewStatus, 'due');
  }

  // B4c. 非法 context.now 不得字符串 fallback 伪造有效到期。
  {
    const evalBadNow = evaluateReviewStatus(ruleCreatedOnly, { now: 'not-a-time' });
    assert.equal(evalBadNow.reviewStatus, 'active'); // 未判为 due
    assert.ok(evalBadNow.reasons.some((reason) => reason.includes('当前时间非法')));
  }

  // B5. 关联由明确 associationKey 判定；相关/无关变化来自注入的规范化语义。
  const snapshotBase = {
    associationKey: 'page:read#noun',
    evidenceId: 'ev-synthetic-1',
    applicability: knownAll('same'),
    ipaSemanticFingerprint: 'fp-a',
    pageText: '页面正文 A',
    revision: 'revid-100',
    extractedAt: '2026-01-01T00:00:00Z',
  };
  // 无关变化：仅页面文本/时间戳/revid 不同，注入的规范化指纹与范围相同。
  const unrelated = diffRelatedSemantics(snapshotBase, {
    ...snapshotBase,
    pageText: '页面正文 B（重排）',
    revision: 'revid-200',
    extractedAt: '2026-02-01T00:00:00Z',
  });
  assert.equal(unrelated.related, false);
  assert.equal(unrelated.unknown, false);

  // 关键回归（主编排实测）：同关联、evidenceId 因新 render 而变、且 IPA 语义变化 → 必触发。
  const ipaChanged = diffRelatedSemantics(snapshotBase, {
    ...snapshotBase,
    evidenceId: 'ev-synthetic-2',
    ipaSemanticFingerprint: 'fp-b',
    pageText: '页面正文 B',
    revision: 'revid-200',
  });
  assert.equal(ipaChanged.related, true);
  assert.equal(ipaChanged.unknown, false);
  assert.deepEqual(ipaChanged.changed, ['ipa-semantic']);

  // 相关变化：适用范围（口音）。
  const scopeChanged = diffRelatedSemantics(snapshotBase, {
    ...snapshotBase,
    applicability: knownAll('same', { accent: knownScope(['UK']) }),
  });
  assert.equal(scopeChanged.related, true);
  assert.ok(scopeChanged.changed.includes('applicability'));

  // 同关联、evidenceId 变但语义未变 → 不触发。
  const sameSemanticsNewEvidence = diffRelatedSemantics(snapshotBase, {
    ...snapshotBase,
    evidenceId: 'ev-synthetic-3',
  });
  assert.equal(sameSemanticsNewEvidence.related, false);

  // explicit-all 证据引用变化不改变「明确全范围」语义 → 不触发。
  const allEvidenceChanged = diffRelatedSemantics(
    { ...snapshotBase, applicability: knownAll('same', { pos: explicitAllScope(['ev-old']) }) },
    { ...snapshotBase, applicability: knownAll('same', { pos: explicitAllScope(['ev-new']) }) },
  );
  assert.equal(allEvidenceChanged.related, false);

  // unknown 原因措辞变化不是范围语义变化 → 不触发。
  const unknownReasonWorded = diffRelatedSemantics(
    { ...snapshotBase, applicability: knownAll('same', { sense: unknownScope('旧措辞') }) },
    { ...snapshotBase, applicability: knownAll('same', { sense: unknownScope('新措辞') }) },
  );
  assert.equal(unknownReasonWorded.related, false);

  // 缺少规范化语义指纹：保守提示，但不伪装确定变化、不撤销/降级。
  const unknownFingerprint = diffRelatedSemantics(snapshotBase, {
    ...snapshotBase,
    ipaSemanticFingerprint: undefined,
  });
  assert.equal(unknownFingerprint.related, true);
  assert.equal(unknownFingerprint.unknown, true);

  // 缺关联键：不凭新 evidenceId 判无关，保守 unknown。
  const missingAssociation = diffRelatedSemantics(
    { ...snapshotBase, associationKey: undefined },
    { ...snapshotBase, associationKey: undefined, evidenceId: 'ev-new', ipaSemanticFingerprint: 'fp-a' },
  );
  assert.equal(missingAssociation.related, true);
  assert.equal(missingAssociation.unknown, true);

  // 明确不同关联 → 不触发。
  const differentAssociation = diffRelatedSemantics(snapshotBase, {
    ...snapshotBase,
    associationKey: 'page:read#verb',
    ipaSemanticFingerprint: 'fp-zzz',
  });
  assert.equal(differentAssociation.related, false);

  // 相关语义变化使未到期规则转为待复核，且保优先级。
  const evalSemantic = evaluateReviewStatus(ruleCreatedOnly, {
    now: '2026-04-01',
    semanticChange: ipaChanged,
  });
  assert.equal(evalSemantic.reviewStatus, 'pending-review');
  assert.equal(evalSemantic.priorityPreserved, true);
  assert.equal(evalSemantic.revoked, false);
  assert.equal(evalSemantic.replaced, false);

  // 无关变化不改变状态。
  const evalUnrelated = evaluateReviewStatus(ruleCreatedOnly, {
    now: '2026-04-01',
    semanticChange: unrelated,
  });
  assert.equal(evalUnrelated.reviewStatus, 'active');

  // B6. 事件独立：采集/导入/渲染/批次批准都不刷新人工核验时间，也不伪造 createdAt。
  for (const type of ['collection', 'import', 'render', 'approval', 'created']) {
    const applied = applyReviewEvent(ruleWithBoth, { type, at: '2026-05-01' });
    assert.equal(applied.applied, false, `${type} 不应刷新核验`);
    assert.equal(applied.rule.lastVerifiedAt, '2026-03-15');
    assert.equal(applied.rule.reviewDueAt, undefined);
  }
  // 导入不能给无 timestamp 旧规则伪填创建时间。
  const importOld = applyReviewEvent(ruleNoTimestamp, { type: 'import', at: '2026-05-01' });
  assert.equal(importOld.applied, false);
  assert.equal(importOld.rule.createdAt, undefined);
  assert.equal(importOld.rule.lastVerifiedAt, undefined);
  // 普通批准/采集/导入/渲染不清除既有 pending-review。
  const approvalPending = applyReviewEvent(
    { ...ruleCreatedOnly, reviewStatus: 'pending-review' },
    { type: 'approval', at: '2026-05-01' },
  );
  assert.equal(approvalPending.applied, false);
  assert.equal(approvalPending.rule.reviewStatus, 'pending-review');

  // B7. 明确逐项核验才更新 lastVerifiedAt 并重算到期；须带 actor/auditRef/合法 UTC。
  // 缺 actor/auditRef 或非法时间 → 拒绝，普通批准不能冒充核验。
  const verifyMissingAudit = applyReviewEvent(ruleCreatedOnly, {
    type: 'explicit-verification',
    at: '2026-08-15',
    actor: 'user',
  });
  assert.equal(verifyMissingAudit.applied, false);
  const verifyBadTime = applyReviewEvent(ruleCreatedOnly, {
    type: 'explicit-verification',
    at: 'not-a-time',
    actor: 'user',
    auditRef: 'audit-v0',
  });
  assert.equal(verifyBadTime.applied, false);

  const verified = applyReviewEvent(ruleCreatedOnly, {
    type: 'explicit-verification',
    at: '2026-08-15T00:00:00Z',
    actor: ' user ',
    auditRef: ' audit-v1 ',
  });
  assert.equal(verified.applied, true);
  assert.equal(verified.rule.lastVerifiedAt, '2026-08-15T00:00:00Z');
  assert.equal(verified.rule.reviewDueAt, '2027-02-15T00:00:00Z');
  assert.equal(verified.rule.reviewStatus, 'active');
  assert.equal(verified.audit.action, 'explicit-verification');
  assert.equal(verified.audit.ruleId, ruleCreatedOnly.ruleId);
  assert.equal(verified.audit.actor, 'user');
  assert.equal(verified.audit.auditRef, 'audit-v1');
  {
    const issues = [];
    validateRule(verified.rule, 'rule', issues);
    assert.equal(issues.length, 0, JSON.stringify(issues));
  }
  // createdAt 未知的旧规则经核验仍保持 pending-review（合同要求，不伪填 createdAt）。
  const verifiedOld = applyReviewEvent(ruleNoTimestamp, {
    type: 'explicit-verification',
    at: '2026-08-15T00:00:00Z',
    actor: 'user',
    auditRef: 'audit-v2',
  });
  assert.equal(verifiedOld.applied, true);
  assert.equal(verifiedOld.rule.createdAt, undefined);
  assert.equal(verifiedOld.rule.reviewStatus, 'pending-review');
  {
    const issues = [];
    validateRule(verifiedOld.rule, 'rule', issues);
    assert.equal(issues.length, 0, JSON.stringify(issues));
  }

  // B8. 撤销/替代须明确确认 + 审计输入；严格 confirmed===true、trim 非空、合法 UTC。
  const noConfirmRevoke = revokeRule(ruleWithBoth, undefined);
  assert.equal(noConfirmRevoke.applied, false);
  assert.equal(noConfirmRevoke.rule.reviewStatus, 'active');
  // 字符串 'false' 不得被 truthy 当确认。
  for (const bad of [
    { confirmed: 'false', actor: 'user', at: '2026-05-01', reason: '误操作', auditRef: 'audit-1' },
    { confirmed: false, actor: 'user', at: '2026-05-01', reason: '误操作', auditRef: 'audit-1' },
    { confirmed: true, actor: '   ', at: '2026-05-01', reason: '已确认', auditRef: 'audit-1' },
    { confirmed: true, actor: 'user', at: '2026-05-01', reason: '   ', auditRef: 'audit-1' },
    { confirmed: true, actor: 'user', at: '2026-05-01', reason: '已确认', auditRef: '   ' },
    { confirmed: true, actor: 'user', at: 'not-a-time', reason: '已确认', auditRef: 'audit-1' },
    { confirmed: true, actor: 'user', at: '2026-13-01', reason: '已确认', auditRef: 'audit-1' },
  ]) {
    const result = revokeRule(ruleWithBoth, bad);
    assert.equal(result.applied, false, JSON.stringify(bad));
    assert.equal(result.rule.reviewStatus, 'active');
  }
  const confirmedRevoke = revokeRule(ruleWithBoth, {
    confirmed: true,
    actor: ' user ',
    at: '2026-05-01T00:00:00Z',
    reason: '用户明确撤销',
    auditRef: 'audit-2',
  });
  assert.equal(confirmedRevoke.applied, true);
  assert.equal(confirmedRevoke.rule.reviewStatus, 'revoked');
  assert.equal(confirmedRevoke.audit.action, 'revoke');
  assert.equal(confirmedRevoke.audit.actor, 'user');
  assert.equal(confirmedRevoke.audit.auditRef, 'audit-2');
  assert.equal(confirmedRevoke.audit.at, '2026-05-01T00:00:00Z');
  // 已撤销规则不再无谓更改。
  const revokeAgain = revokeRule(confirmedRevoke.rule, {
    confirmed: true,
    actor: 'user',
    at: '2026-05-01',
    reason: '重复撤销',
    auditRef: 'audit-x',
  });
  assert.equal(revokeAgain.applied, false);

  const noConfirmReplace = replaceRule(ruleWithBoth, 'rule-synthetic-2', undefined);
  assert.equal(noConfirmReplace.applied, false);
  const selfReplace = replaceRule(ruleWithBoth, ruleWithBoth.ruleId, {
    confirmed: true,
    actor: 'user',
    at: '2026-05-01',
    reason: '自引用',
    auditRef: 'audit-4',
  });
  assert.equal(selfReplace.applied, false);
  const blankReplace = replaceRule(ruleWithBoth, '   ', {
    confirmed: true,
    actor: 'user',
    at: '2026-05-01',
    reason: '空白 ID',
    auditRef: 'audit-5',
  });
  assert.equal(blankReplace.applied, false);
  const confirmedReplace = replaceRule(ruleWithBoth, 'rule-synthetic-2', {
    confirmed: true,
    actor: 'user',
    at: '2026-05-01T00:00:00Z',
    reason: '以新规则替代',
    auditRef: 'audit-3',
  });
  assert.equal(confirmedReplace.applied, true);
  assert.equal(confirmedReplace.rule.reviewStatus, 'replaced');
  assert.equal(confirmedReplace.rule.revokedByRuleId, 'rule-synthetic-2');
  assert.equal(confirmedReplace.audit.action, 'replace');
  assert.equal(confirmedReplace.audit.supersedingRuleId, 'rule-synthetic-2');

  // B9. 已撤销/替代规则不会被复核评估重新激活，也不会因到期自动撤销/替代。
  const revokedRule = confirmedRevoke.rule;
  const evalRevoked = evaluateReviewStatus(revokedRule, { now: '2099-01-01' });
  assert.equal(evalRevoked.reviewStatus, 'revoked');
  assert.equal(evalRevoked.revoked, false);
  assert.equal(evalRevoked.replaced, false);
  // 到期规则的评估结果永不携带 revoked/replaced。
  assert.equal(evaluateReviewStatus(ruleCreatedOnly, { now: '2099-01-01' }).revoked, false);
  assert.equal(evaluateReviewStatus(ruleCreatedOnly, { now: '2099-01-01' }).replaced, false);

  console.log('test_pronunciation_scope_review: OK');
} finally {
  await server.close();
}
