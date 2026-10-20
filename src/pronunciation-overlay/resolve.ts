import type {
  ApplicabilityScope,
  FieldProvenance,
  PronunciationObservation,
  PronunciationRule,
  ReadingDisposition,
  RuleField,
  SourceEvidence,
} from './contracts';
import { validateSourceEvidence, validateRule, knownScope } from './contracts';
import { buildReadingPlan, classifyObservation } from './classification';
import { matchApplicabilityScopes, isDisjointScopeMatch } from './scope';

/** 两个范围可能相交（不能证明不相交即按相交处理，fail closed）。 */
function scopesMayOverlap(a: ApplicabilityScope, b: ApplicabilityScope): boolean {
  return !isDisjointScopeMatch(matchApplicabilityScopes(a, b));
}

export interface ResolvedReading {
  readonly ref: string;
  readonly ipa: string;
  readonly scope: ApplicabilityScope;
  readonly tier: ReadingDisposition | 'retained' | 'excluded';
  readonly provenance: FieldProvenance;
  readonly reason?: string;
}

export interface EntryResolution {
  readonly entryId: string;
  readonly fields: Readonly<Partial<Record<RuleField, string>>>;
  readonly fieldProvenance: readonly FieldProvenance[];
  readonly readings: readonly ResolvedReading[];
  readonly unresolvedReasons: readonly string[];
}

/** 来源优先级：user > system > qualified-source > legacy。supersede 与字段赋值共用。 */
const SOURCE_PRIORITY: Readonly<Record<FieldProvenance['source'], number>> = {
  user: 4,
  system: 3,
  'qualified-source': 2,
  legacy: 1,
};

/** Resolve one explicit query cell without pretending an intersection covers a broader result. */
export function selectEffectiveReadings(
  readings: readonly ResolvedReading[],
  conditions: ApplicabilityScope,
): readonly ResolvedReading[] {
  const priority = SOURCE_PRIORITY;
  const applicable = readings.filter(
    (reading) => reading.tier === 'default' && scopeCovers(reading.scope, conditions),
  );
  const highest = Math.max(...applicable.map((reading) => priority[reading.provenance.source]));
  return applicable.filter((reading) => priority[reading.provenance.source] === highest);
}

/** A relation with an intersection alone cannot authorize replacement of a wider value. */
export function scopeCovers(source: ApplicabilityScope, target: ApplicabilityScope): boolean {
  const match = matchApplicabilityScopes(source, target);
  return (
    match.wholeScope &&
    match.dimensions.every((dimension) =>
      ['exact', 'all-both', 'all-covers-left', 'right-subset'].includes(dimension.relation),
    )
  );
}

/** Unmarked accent is its own display condition, never UK/US or a wildcard. Raw evidence stays intact. */
export function observationResultScope(observation: PronunciationObservation): ApplicabilityScope {
  return observation.applicability.accent.kind === 'unknown' &&
    classifyObservation(observation).accent.family === 'unspecified'
    ? { ...observation.applicability, accent: knownScope(['unspecified']) }
    : observation.applicability;
}

export interface ResolveEntryInput {
  readonly entryId: string;
  readonly scope: ApplicabilityScope;
  readonly legacyFields: Readonly<Partial<Record<RuleField, string>>>;
  readonly previousReadings: readonly ResolvedReading[];
  readonly observations: readonly PronunciationObservation[];
  readonly evidence: readonly SourceEvidence[];
  readonly rules: readonly PronunciationRule[];
  readonly confirmedExclusions?: readonly {
    readonly readingRef: string;
    readonly scope: ApplicabilityScope;
    readonly evidenceRefs: readonly string[];
    readonly reason: string;
    readonly confirmed: boolean;
  }[];
}

function remainingScopes(
  current: ApplicabilityScope,
  replacement: ApplicabilityScope,
): readonly ApplicabilityScope[] | undefined {
  const match = matchApplicabilityScopes(current, replacement);
  if (match.result !== 'comparable') return undefined;
  let intersection = current;
  const remaining: ApplicabilityScope[] = [];
  for (const dimension of match.comparedDimensions) {
    const old = intersection[dimension];
    const next = replacement[dimension];
    if (next.kind === 'explicit-all') continue;
    if (old.kind !== 'known' || next.kind !== 'known') return undefined;
    const shared = old.values.filter((value) => next.values.includes(value));
    if (shared.length === 0) return undefined;
    const rest = old.values.filter((value) => !next.values.includes(value));
    if (rest.length > 0)
      remaining.push({ ...intersection, [dimension]: { kind: 'known', values: rest } });
    intersection = { ...intersection, [dimension]: { kind: 'known', values: shared } };
  }
  return remaining;
}

function supersede(
  readings: ResolvedReading[],
  scope: ApplicabilityScope,
  reason: string,
  manual: boolean,
  eligibleRefs?: ReadonlySet<string>,
  incomingSource?: FieldProvenance['source'],
): void {
  const originalLength = readings.length;
  const incomingPriority = incomingSource === undefined ? 0 : SOURCE_PRIORITY[incomingSource];
  for (let index = 0; index < originalLength; index += 1) {
    const old = readings[index];
    if (old !== undefined && eligibleRefs !== undefined && !eligibleRefs.has(old.ref)) continue;
    if (old?.tier !== 'default' || (!manual && ['user', 'system'].includes(old.provenance.source)))
      continue;
    // 高优先级来源不被低优先级降级：新增 system 规则不得把仍有效的同范围
    // user 读法改为 retained；交集部分同样保留给用户（逐格选择按优先级裁定）。
    if (incomingSource !== undefined && SOURCE_PRIORITY[old.provenance.source] > incomingPriority)
      continue;
    const rest = scopeCovers(scope, old.scope) ? [] : remainingScopes(old.scope, scope);
    if (rest === undefined) continue;
    readings[index] = { ...old, tier: 'retained', reason };
    readings.push(...rest.map((conditions) => ({ ...old, scope: conditions })));
  }
}

export function resolveEntry(input: ResolveEntryInput): EntryResolution {
  const evidenceIds = new Set(
    input.evidence
      .filter((evidence) => {
        const issues: Parameters<typeof validateSourceEvidence>[2] = [];
        validateSourceEvidence(evidence, '$', issues);
        return issues.length === 0;
      })
      .map((evidence) => evidence.evidenceId),
  );
  const plan = buildReadingPlan(input.observations);
  const readings: ResolvedReading[] = input.previousReadings.map((reading) => {
    const revoked = input.rules.some(
      (rule) =>
        rule.ruleId === reading.provenance.ref &&
        ['revoked', 'replaced'].includes(rule.reviewStatus),
    );
    return revoked
      ? { ...reading, tier: 'retained', reason: '明确撤销或替代的规则，历史保留' }
      : { ...reading };
  });
  const unresolvedReasons = [...plan.explanations];
  for (const group of [
    ...plan.defaults,
    ...plan.supplementals,
    ...plan.evidenceOnly,
    ...plan.unresolved,
  ]) {
    for (const observation of group.observations) {
      const resultScope = observationResultScope(observation);
      const qualifies =
        evidenceIds.has(observation.evidenceId) && scopeCovers(input.scope, resultScope);
      const manualCovers = readings.some(
        (reading) =>
          reading.tier === 'default' &&
          ['user', 'system'].includes(reading.provenance.source) &&
          scopeCovers(reading.scope, resultScope),
      );
      const tier = qualifies
        ? manualCovers && group.disposition === 'default'
          ? 'retained'
          : group.disposition
        : 'unresolved';
      if (tier === 'default') {
        supersede(
          readings,
          resultScope,
          '同范围合格来源优先，旧值留存',
          false,
          new Set(input.previousReadings.map((reading) => reading.ref)),
          'qualified-source',
        );
      }
      if (
        !readings.some(
          (reading) => reading.ref === observation.observationId && reading.tier === tier,
        )
      ) {
        readings.push({
          ref: observation.observationId,
          ipa: observation.rawIpa,
          scope: resultScope,
          tier,
          provenance: {
            field: 'phonetic',
            source: 'qualified-source',
            ref: observation.observationId,
          },
        });
      }
    }
  }
  const fields = { ...input.legacyFields };
  const provenance = new Map<RuleField, FieldProvenance>(
    Object.keys(fields).map((field) => [
      field as RuleField,
      { field: field as RuleField, source: 'legacy' },
    ]),
  );
  // System first, user last. Stable rule IDs make competing same-priority rules deterministic.
  const rules = [...input.rules].sort(
    (a, b) =>
      Number(a.origin === 'user') - Number(b.origin === 'user') || a.ruleId.localeCompare(b.ruleId),
  );
  for (const rule of rules) {
    const issues: Parameters<typeof validateRule>[2] = [];
    validateRule(rule, '$', issues);
    if (issues.length > 0) throw new Error(`无效纠错规则 ${rule.ruleId}`);
    if (
      rule.target.kind !== 'entry' ||
      rule.target.entryId !== input.entryId ||
      ['revoked', 'replaced'].includes(rule.reviewStatus)
    )
      continue;
    for (const operation of rule.operations) {
      const from: FieldProvenance = {
        field: operation.field,
        source: rule.origin,
        ref: rule.ruleId,
      };
      if (operation.field !== 'phonetic') {
        if (!scopeCovers(rule.conditions, input.scope)) continue;
        fields[operation.field] = operation.op === 'set' ? (operation.value ?? '') : '';
        provenance.set(operation.field, from);
        continue;
      }
      if (!scopeCovers(input.scope, rule.conditions)) {
        unresolvedReasons.push(`${rule.ruleId}: 纠错范围尚未完整归属目标`);
        continue;
      }
      supersede(readings, rule.conditions, '人工同范围纠错优先，原值留存', true, undefined, rule.origin);
      readings.push({
        ref: rule.ruleId,
        ipa: operation.op === 'set' ? (operation.value ?? '') : '',
        scope: rule.conditions,
        tier: 'default',
        provenance: from,
        ...(operation.op === 'set' ? {} : { reason: '明确范围内有意清空' }),
      });
      // 单值 fields.phonetic 不在此赋值：统一由末尾的"整范围胜者唯一"判定输出。
    }
  }
  for (const exclusion of input.confirmedExclusions ?? []) {
    if (
      !exclusion.confirmed ||
      exclusion.reason.trim() === '' ||
      exclusion.evidenceRefs.length === 0 ||
      !exclusion.evidenceRefs.every((ref) => evidenceIds.has(ref))
    )
      continue;
    const index = readings.findIndex(
      (reading) =>
        reading.ref === exclusion.readingRef && scopeCovers(exclusion.scope, reading.scope),
    );
    const reading = readings[index];
    if (reading !== undefined && !['user', 'system'].includes(reading.provenance.source)) {
      readings[index] = { ...reading, tier: 'excluded', reason: exclusion.reason };
    }
  }
  // 单值字段只有在整个查询范围内最终胜者唯一时才输出。判定分两步：
  // ① 逐格有效选择在整格上恰有一个胜者；② 不存在与胜者同级或更高级、
  // 与查询范围可能相交（覆盖子范围即可，不要求整格相等）且值不同的其他
  // default 读法。子范围胜者不一致时不输出：字段缺席、provenance 不留错误
  // 来源，绝不用宽范围系统值冒充整体；纯 legacy 无竞争时保持原值。
  const effective = selectEffectiveReadings(readings, input.scope);
  const sole = effective.length === 1 ? effective[0] : undefined;
  let consistent = sole !== undefined;
  if (sole !== undefined) {
    const winnerPriority = SOURCE_PRIORITY[sole.provenance.source];
    consistent = !readings.some(
      (reading) =>
        reading.tier === 'default' &&
        reading.ref !== sole.ref &&
        SOURCE_PRIORITY[reading.provenance.source] >= winnerPriority &&
        reading.ipa !== sole.ipa &&
        scopesMayOverlap(reading.scope, input.scope),
    );
  }
  if (consistent && sole !== undefined) {
    fields.phonetic = sole.ipa;
    provenance.set('phonetic', sole.provenance);
  } else if (
    readings.some(
      (reading) =>
        reading.tier === 'default' &&
        reading.provenance.source !== 'legacy' &&
        scopesMayOverlap(reading.scope, input.scope),
    )
  ) {
    delete fields.phonetic;
    provenance.delete('phonetic');
  }
  return {
    entryId: input.entryId,
    fields,
    fieldProvenance: [...provenance.values()],
    readings,
    unresolvedReasons,
  };
}
