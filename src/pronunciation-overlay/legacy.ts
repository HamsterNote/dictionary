import type { DictionaryCorrectionMap, DictionaryCorrectionPatch } from '../dictionaryCorrections';
import {
  normalizeDictionaryCorrectionKey,
  DICTIONARY_CORRECTION_STORAGE_KEY,
} from '../dictionaryCorrections';
import type { ApplicabilityScope, PronunciationRule } from './contracts';
import {
  PRONUNCIATION_SCHEMA,
  scopeWith,
  validateApplicabilityScope,
  isOpaqueIdFormat,
} from './contracts';
import { fingerprintJson } from './json';
import { scopeCovers } from './resolve';

export interface LegacyPatchRecord {
  readonly key: string;
  readonly patch: DictionaryCorrectionPatch;
  readonly fingerprint: string;
  readonly rule: PronunciationRule;
}

export function adaptLegacyCorrections(
  map: DictionaryCorrectionMap,
  origin: 'user' | 'system',
): readonly LegacyPatchRecord[] {
  return Object.entries(map).map(([key, patch]) => {
    const fingerprint = fingerprintJson({ key, patch });
    return {
      key,
      patch: { ...patch },
      fingerprint,
      rule: {
        schema: PRONUNCIATION_SCHEMA.rule,
        ruleId: `legacy:${origin}:${fingerprint}`,
        origin,
        target: { kind: 'legacy-headword', word: key },
        conditions: scopeWith({}),
        evidenceRefs: [],
        operations: (['word', 'meaning', 'phonetic'] as const).flatMap((field) => {
          const value = patch[field];
          return value === undefined
            ? []
            : [
                {
                  field,
                  op: value === '' ? ('suppress' as const) : ('set' as const),
                  ...(value === '' ? {} : { value }),
                },
              ];
        }),
        createdAtUnknownReason: 'v1 未记录创建或核验时间',
        reviewStatus: 'pending-review',
      },
    };
  });
}

export interface LegacyScopeResolution {
  readonly key: string;
  readonly origin: 'user' | 'system';
  readonly patchFingerprint: string;
  readonly entryId: string;
  readonly scope: ApplicabilityScope;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly operation: string;
}

export type LegacyReadState =
  | {
      readonly status: 'ready';
      readonly user: DictionaryCorrectionMap;
      readonly system: DictionaryCorrectionMap;
    }
  | { readonly status: 'failed'; readonly reason: string };

/** Read failures include malformed payloads; they must never unlock a globally published sidecar. */
export function readLegacyState(
  storage: Pick<Storage, 'getItem'>,
  system: DictionaryCorrectionMap = {},
): LegacyReadState {
  try {
    const raw = storage.getItem(DICTIONARY_CORRECTION_STORAGE_KEY);
    const value: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('v1 必须为对象');
    for (const patch of Object.values(value as Record<string, unknown>)) {
      if (
        typeof patch !== 'object' ||
        patch === null ||
        Array.isArray(patch) ||
        Object.entries(patch as Record<string, unknown>).some(
          ([field, content]) =>
            !['word', 'meaning', 'phonetic'].includes(field) || typeof content !== 'string',
        )
      ) {
        throw new Error('v1 字段无效');
      }
    }
    return { status: 'ready', user: value as DictionaryCorrectionMap, system };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export function legacyProtection(
  word: string,
  state: LegacyReadState,
  resolutions: readonly LegacyScopeResolution[],
  activeEntryIds?: readonly string[],
  preservedRules?: readonly PronunciationRule[],
): readonly string[] {
  if (state.status === 'failed') return [`旧纠错读取失败：${state.reason}`];
  const reasons: string[] = [];
  for (const origin of ['system', 'user'] as const) {
    for (const record of adaptLegacyCorrections(state[origin], origin)) {
      if (
        normalizeDictionaryCorrectionKey(record.key) !== normalizeDictionaryCorrectionKey(word) ||
        record.patch.phonetic === undefined
      )
        continue;
      const resolved = resolutions.some((resolution) => {
        const issues: Parameters<typeof validateApplicabilityScope>[2] = [];
        validateApplicabilityScope(resolution.scope, '$', issues);
        return (
          issues.length === 0 &&
          resolution.key === record.key &&
          resolution.origin === origin &&
          isOpaqueIdFormat(resolution.entryId) &&
          resolution.entryId.startsWith('ent_') &&
          (activeEntryIds === undefined || activeEntryIds.includes(resolution.entryId)) &&
          resolution.patchFingerprint === record.fingerprint &&
          resolution.operation === 'confirm-scope' &&
          resolution.confirmedBy.trim() !== '' &&
          Number.isFinite(Date.parse(resolution.confirmedAt)) &&
          resolution.scope.entry.kind === 'known' &&
          resolution.scope.entry.values.length === 1 &&
          resolution.scope.entry.values[0] === resolution.entryId &&
          Object.values(resolution.scope).every((constraint) => constraint.kind !== 'unknown') &&
          (preservedRules === undefined ||
            preservedRules.some(
              (rule) =>
                rule.origin === origin &&
                rule.target.kind === 'entry' &&
                rule.target.entryId === resolution.entryId &&
                !['revoked', 'replaced'].includes(rule.reviewStatus) &&
                scopeCovers(rule.conditions, resolution.scope) &&
                scopeCovers(resolution.scope, rule.conditions) &&
                rule.operations.some(
                  (operation) =>
                    operation.field === 'phonetic' &&
                    (operation.op === 'set' ? operation.value : '') === record.patch.phonetic,
                ),
            ))
        );
      });
      if (!resolved) reasons.push(`${origin}:${record.key}: 旧音标纠错范围未确认或尚未保留`);
    }
  }
  return reasons;
}

export function protectPublishedWord<T>(input: {
  readonly word: string;
  readonly legacy: LegacyReadState;
  readonly resolutions: readonly LegacyScopeResolution[];
  readonly current: T;
  readonly published: T;
  readonly candidates: T;
}): { readonly current: T; readonly candidates: T; readonly blockedReasons: readonly string[] } {
  const blockedReasons = legacyProtection(input.word, input.legacy, input.resolutions);
  return {
    current: blockedReasons.length > 0 ? input.current : input.published,
    candidates: input.candidates,
    blockedReasons,
  };
}
