import type { PronunciationDisplayDto, OverlayDocumentSet } from './contracts';
import { validateOverlayDocumentSet } from './contracts';
import type { IdentityRegistry } from './identity';
import { getEntry, lookupEntryIdsBySpelling, validateIdentityRegistry } from './identity';
import type { LegacyReadState, LegacyScopeResolution } from './legacy';
import { legacyProtection } from './legacy';
import { buildReadingPlan, classifyObservation } from './classification';
import { scopeCovers, observationResultScope } from './resolve';

/** Only a validated, approved snapshot is accepted; candidates are separate caller-owned data. */
export interface PronunciationSnapshot {
  readonly kind: 'published-pronunciation-snapshot';
  readonly identity: IdentityRegistry;
  readonly documents: OverlayDocumentSet;
}

export function validateSnapshotSemantics(snapshot: PronunciationSnapshot): void {
  const { documents, identity } = snapshot;
  const canonicalEntries = Object.values(identity.byId)
    .filter((entry) => entry.kind === 'entry')
    .map((entry) => entry.id)
    .sort();
  if (JSON.stringify(canonicalEntries) !== JSON.stringify([...documents.identityEntryIds].sort()))
    throw new Error('正式文档与 canonical 身份集合不一致');
  for (const evidence of documents.evidence) {
    for (const url of [evidence.pageUrl, evidence.historyUrl, evidence.license.url]) {
      if (new URL(url).protocol !== 'https:') throw new Error('归因链接必须为 HTTPS');
    }
  }
  const defaults = new Set(
    buildReadingPlan(documents.observations).defaults.flatMap((group) =>
      group.observations.map((observation) => observation.observationId),
    ),
  );
  for (const display of documents.displays ?? []) {
    const approval = documents.approvals.find(
      (value) => value.approvalId === documents.manifest.approvalId,
    );
    if (
      !approval?.includedHeads.includes(display.word) ||
      approval.excludedHeads.includes(display.word)
    )
      throw new Error('展示词头不在批准纳入名单内');
    for (const url of [
      display.attribution.pageUrl,
      display.attribution.historyUrl,
      display.attribution.licenseUrl,
    ]) {
      if (new URL(url).protocol !== 'https:') throw new Error('展示归因链接必须为 HTTPS');
    }
    const entry = getEntry(identity, display.entryId);
    if (
      entry?.status !== 'active' ||
      !entry.grammarRoles.includes(display.role) ||
      entry.exactSpelling !== display.word
    ) {
      throw new Error('展示身份与 canonical registry 不一致');
    }
    if (display.tier !== 'default' || display.origin === 'legacy') continue;
    const result = documents.resolved.find((value) => value.entryId === display.entryId);
    if (result === undefined || result.unresolvedReasons.length > 0)
      throw new Error('不明结果不得作为默认展示');
    if (
      result.conditions.entry.kind !== 'known' ||
      result.conditions.entry.values.length !== 1 ||
      result.conditions.entry.values[0] !== display.entryId ||
      result.conditions.role.kind !== 'known' ||
      !result.conditions.role.values.includes(display.role)
    )
      throw new Error('默认展示与结果身份或角色范围不一致');
    if (display.origin === 'qualified-source') {
      const source = documents.observations.find(
        (observation) =>
          defaults.has(observation.observationId) &&
          result.defaultReadingRefs.includes(observation.observationId) &&
          observation.rawIpa === display.originalIpa &&
          observation.notation === display.notation &&
          scopeCovers(result.conditions, observationResultScope(observation)) &&
          observationResultScope(observation).entry.kind === 'known' &&
          observation.applicability.entry.kind === 'known' &&
          observation.applicability.entry.values.includes(display.entryId) &&
          observation.applicability.role.kind === 'known' &&
          observation.applicability.role.values.includes(display.role) &&
          classifyObservation(observation).accent.family === display.accent.class &&
          classifyObservation(observation).accent.unspecified === display.accent.unspecified,
      );
      if (source === undefined) throw new Error('默认展示缺少合格同范围来源');
      if (
        documents.rules.some(
          (rule) =>
            rule.target.kind === 'entry' &&
            rule.target.entryId === display.entryId &&
            !['revoked', 'replaced'].includes(rule.reviewStatus) &&
            scopeCovers(rule.conditions, observationResultScope(source)) &&
            rule.operations.some((operation) => operation.field === 'phonetic'),
        )
      )
        throw new Error('来源默认结果不能覆盖同范围人工纠错');
    } else {
      const rule = documents.rules.find(
        (value) =>
          value.origin === display.origin &&
          value.target.kind === 'entry' &&
          value.target.entryId === display.entryId &&
          !['revoked', 'replaced'].includes(value.reviewStatus) &&
          scopeCovers(result.conditions, value.conditions) &&
          value.operations.some(
            (operation) =>
              operation.field === 'phonetic' &&
              (operation.op === 'set'
                ? operation.value === display.originalIpa
                : display.originalIpa === ''),
          ),
      );
      if (rule === undefined) throw new Error('人工展示缺少同范围有效规则');
    }
  }
  for (const projection of documents.manifest.compatibleProjection) {
    if (
      !(documents.displays ?? []).some(
        (display) =>
          display.entryId === projection.entryId &&
          display.word === projection.legacyWord &&
          display.tier === 'default' &&
          display.originalIpa === projection.phonetic &&
          display.notation === projection.notation,
      )
    ) {
      throw new Error('兼容投影与获准默认结果不一致');
    }
  }
}

export function createPronunciationQuery(
  value: unknown,
  protection: {
    readonly legacy: LegacyReadState;
    readonly resolutions: readonly LegacyScopeResolution[];
  },
) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('snapshot 必须为对象');
  const record = value as Record<string, unknown>;
  if (
    record['kind'] !== 'published-pronunciation-snapshot' ||
    !validateIdentityRegistry(record['identity']).valid ||
    !validateOverlayDocumentSet(record['documents']).valid
  ) {
    throw new Error('正式音标 snapshot 身份或引用无效');
  }
  const snapshot = value as PronunciationSnapshot;
  const { manifest } = snapshot.documents;
  const approved = snapshot.documents.approvals.find(
    (approval) => approval.approvalId === manifest.approvalId,
  );
  if (approved?.action !== 'approve-batch') throw new Error('正式 snapshot 缺少明确批准');
  validateSnapshotSemantics(snapshot);
  // Capture one immutable revision; mutations in a host object cannot mix snapshots mid-query.
  const frozen = structuredClone(snapshot);
  const state = structuredClone(protection);
  const activeEntryIds = Object.values(frozen.identity.byId)
    .filter((entry) => entry.kind === 'entry' && entry.status === 'active')
    .map((entry) => entry.id);
  function byId(entryId: string): {
    readonly entry: ReturnType<typeof getEntry>;
    readonly readings: readonly PronunciationDisplayDto[];
    readonly blockedReasons: readonly string[];
  } {
    const entry = getEntry(frozen.identity, entryId);
    if (entry === undefined) return { entry, readings: [], blockedReasons: [] };
    const blockedReasons = legacyProtection(
      entry.exactSpelling,
      state.legacy,
      state.resolutions,
      activeEntryIds,
      frozen.documents.rules,
    );
    const readings =
      blockedReasons.length > 0 || entry.status !== 'active'
        ? []
        : (frozen.documents.displays ?? []).filter((display) => display.entryId === entryId);
    return { entry: structuredClone(entry), readings: structuredClone(readings), blockedReasons };
  }
  return {
    manifestVersion: manifest.manifestVersion,
    lookup: (spelling: string) => lookupEntryIdsBySpelling(frozen.identity, spelling),
    getEntryById: byId,
    legacyProjection(
      word: string,
      current: string | undefined,
      options: {
        readonly hostOwned?: boolean;
        readonly verifiedProjection?: {
          readonly manifestVersion: string;
          readonly entryId: string;
          readonly phonetic: string;
          readonly explicitlyVerified: boolean;
        };
      } = {},
    ): string | undefined {
      if (
        options.hostOwned ||
        legacyProtection(
          word,
          state.legacy,
          state.resolutions,
          activeEntryIds,
          frozen.documents.rules,
        ).length > 0
      )
        return current;
      const ids = lookupEntryIdsBySpelling(frozen.identity, word).entryIds;
      const verified = options.verifiedProjection;
      if (
        verified?.explicitlyVerified === true &&
        verified.manifestVersion === manifest.manifestVersion &&
        ids.includes(verified.entryId)
      ) {
        const projection = manifest.compatibleProjection.find(
          (value) =>
            value.legacyWord === word &&
            value.entryId === verified.entryId &&
            value.phonetic === verified.phonetic,
        );
        if (projection !== undefined) return projection.phonetic;
      }
      if (ids.length !== 1) return current;
      const id = ids[0];
      const readings =
        id === undefined ? [] : byId(id).readings.filter((reading) => reading.tier === 'default');
      if (readings.length !== 1 || readings[0]?.notation === 'unknown') return current;
      const projection = manifest.compatibleProjection.find(
        (value) =>
          value.entryId === id &&
          value.legacyWord === word &&
          value.phonetic === readings[0]?.originalIpa &&
          value.notation === readings[0]?.notation,
      );
      return projection?.phonetic ?? current;
    },
  };
}
