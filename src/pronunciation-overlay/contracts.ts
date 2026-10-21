/**
 * 音标叠加层 JSON 合同与离线校验。
 *
 * 三层不可混写：来源观测 `PronunciationObservation` → 来源证据 `SourceEvidence`
 * → 修正规则 `PronunciationRule` → 最终结果 `ResolvedPronunciation` → 正式 `PublicationManifest`；
 * 另有采集预算检查点 `BudgetCheckpoint` 与逐批批准 `ApprovalRecord`、展示 DTO `PronunciationDisplayDto`。
 *
 * 本模块只做「形状与引用完整性」校验，不解析真实来源、不联网、不发布。
 * 跨语言（Python）读取方需与本文件的 schema 版本常量保持一致。
 */

import { fingerprintJson } from './json';

/** 各文档的 schema 版本常量；Python `scripts/wiktionary_per_word/contracts.py` 必须一致。 */
export const PRONUNCIATION_SCHEMA = {
  overlay: 'pronunciation-overlay/1',
  identity: 'pronunciation-identity/1',
  evidence: 'pronunciation-evidence/1',
  observation: 'pronunciation-observation/1',
  rule: 'pronunciation-rule/1',
  resolved: 'pronunciation-resolved/1',
  manifest: 'pronunciation-manifest/1',
  checkpoint: 'pronunciation-checkpoint/1',
  approval: 'pronunciation-approval/1',
  display: 'pronunciation-display/1',
} as const;

export type PronunciationSchemaKey = keyof typeof PRONUNCIATION_SCHEMA;

/** 不透明 ID 格式：`ent_`/`lex_` + 小写 UUID。身份模块与校验器共用。 */
export const OPAQUE_ID_PATTERN =
  /^(?:ent|lex)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isOpaqueIdFormat(value: string): boolean {
  return OPAQUE_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 语法角色；`read` 按需拆分出的四个角色。 */
export type GrammarRole = 'base' | 'present' | 'past' | 'past-participle';

/** 转写类型；类型不明时为 `unknown`，不猜测。 */
export type Notation = 'phonemic' | 'phonetic' | 'unknown';

/** 完整性；非 `complete` 不参与默认读法。 */
export type Completeness =
  'complete' | 'fragment' | 'empty' | 'broken-delimiter' | 'control-character' | 'truncated';

/** 复核状态；到期不降级、仍保效。 */
export type ReviewStatus = 'active' | 'due' | 'pending-review' | 'revoked' | 'replaced';

/** 规则来源层级。 */
export type RuleOrigin = 'system' | 'user';

/** 来源在结果中的处置；观测层本身没有此标志。 */
export type ReadingDisposition = 'default' | 'supplemental' | 'evidence-only' | 'unresolved';

/** 口音类别。 */
export type AccentClass =
  'standard' | 'unspecified' | 'uk-unspecified' | 'us-unspecified' | 'regional' | 'unknown';

/** 使用状态（仅这三种视为使用状态标签，其他标签如实保留）。 */
export type UsageStatus = 'rare' | 'archaic' | 'obsolete';

// ---------------------------------------------------------------------------
// 适用范围：known / explicit-all(evidence) / unknown(reason)
// entry 与 lexeme 是两个独立维度。
// ---------------------------------------------------------------------------

/** 显式取值约束。 */
export interface KnownScope {
  readonly kind: 'known';
  readonly values: readonly string[];
}

/** 明确全适用范围，必须带证据引用；不得用缺失字段隐式表示。 */
export interface ExplicitAllScope {
  readonly kind: 'explicit-all';
  readonly evidence: readonly string[];
}

/** 未知范围，必须带原因；不得当作通配。 */
export interface UnknownScope {
  readonly kind: 'unknown';
  readonly reason: string;
}

export type ScopeConstraint = KnownScope | ExplicitAllScope | UnknownScope;

/** 适用范围维度键；`entry` 与 `lexeme` 独立建模。 */
export const SCOPE_DIMENSIONS = [
  'language',
  'entry',
  'lexeme',
  'role',
  'pos',
  'sense',
  'accent',
  'other',
] as const;

export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

/** 逐维度适用范围。 */
export type ApplicabilityScope = Readonly<Record<ScopeDimension, ScopeConstraint>>;

export function knownScope(values: readonly string[]): KnownScope {
  return { kind: 'known', values: [...values] };
}

export function explicitAllScope(evidence: readonly string[]): ExplicitAllScope {
  return { kind: 'explicit-all', evidence: [...evidence] };
}

export function unknownScope(reason: string): UnknownScope {
  return { kind: 'unknown', reason };
}

/** 构造一个「除指定维度外全部 unknown」的范围，避免隐式全范围。 */
export function scopeWith(
  overrides: Partial<Record<ScopeDimension, ScopeConstraint>>,
): ApplicabilityScope {
  const result = {} as Record<ScopeDimension, ScopeConstraint>;
  for (const dimension of SCOPE_DIMENSIONS) {
    result[dimension] = overrides[dimension] ?? unknownScope(`未指定 ${dimension}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 来源证据与许可
// ---------------------------------------------------------------------------

/** 数据许可与归因；Wiktionary 衍生数据为 CC BY-SA 4.0。 */
export interface SourceLicense {
  readonly spdx: string;
  readonly url: string;
  readonly attribution: string;
  readonly shareAlike: boolean;
  readonly changeNotice: string;
}

/** 一次来源观测对应的证据；重新渲染产生新证据，不覆盖旧证据。 */
export interface SourceEvidence {
  readonly schema: string;
  readonly evidenceId: string;
  readonly sourceSite: string;
  readonly language: string;
  readonly pageUrl: string;
  readonly historyUrl: string;
  readonly revision: string;
  readonly extractedAt: string;
  readonly requestVersion: string;
  readonly renderVersion: string;
  readonly extractorVersion: string;
  readonly tagRuleVersion: string;
  readonly responseContentHash: string;
  readonly ipaSemanticFingerprint: string;
  readonly license: SourceLicense;
  readonly cacheRef?: string;
  /** 测试夹具标记；synthetic 证据不得当作真实来源。 */
  readonly synthetic?: boolean;
}

// ---------------------------------------------------------------------------
// 来源观测
// ---------------------------------------------------------------------------

/**
 * 不可变来源观测；没有人工覆盖或「已生效」标志。
 * `rawIpa` / `normalizedIpa` 允许为空字符串（空/片段观测仍须保留为 evidence-only），
 * 因此不要求非空；其余字段要求非空。
 */
export interface PronunciationObservation {
  readonly schema: string;
  readonly observationId: string;
  readonly evidenceId: string;
  readonly language: string;
  readonly sourceSpelling: string;
  readonly rawIpa: string;
  readonly normalizedIpa: string;
  readonly notation: Notation;
  readonly completeness: Completeness;
  readonly rawTags: readonly string[];
  readonly rawQualifiers: readonly string[];
  readonly structuralPath: readonly string[];
  readonly applicability: ApplicabilityScope;
  readonly synthetic?: boolean;
}

// ---------------------------------------------------------------------------
// 修正规则
// ---------------------------------------------------------------------------

export type RuleField = 'word' | 'phonetic' | 'meaning';
export type RuleOperationKind = 'set' | 'clear' | 'suppress';

/**
 * 逐字段操作：
 * - `set` 必须带非空 `value`（空音标不得用 set 表达）；
 * - `clear` / `suppress` 不得带 `value`；空音标的有意清除/压制用 `suppress` 明确表达。
 */
export interface RuleOperation {
  readonly field: RuleField;
  readonly op: RuleOperationKind;
  readonly value?: string;
  readonly observationRefs?: readonly string[];
}

export type RuleTarget =
  | { readonly kind: 'entry'; readonly entryId: string }
  | { readonly kind: 'legacy-headword'; readonly word: string };

export interface PronunciationRule {
  readonly schema: string;
  readonly ruleId: string;
  readonly origin: RuleOrigin;
  readonly target: RuleTarget;
  readonly operations: readonly RuleOperation[];
  readonly conditions: ApplicabilityScope;
  readonly evidenceRefs: readonly string[];
  /**
   * 创建时间。旧的有效规则可能没有 timestamp；此时必须留空并给出
   * `createdAtUnknownReason`，保持 `pending-review` 且仍有效，不得伪填今天。
   */
  readonly createdAt?: string;
  /** `createdAt` 缺失时的明确原因；不得与 `createdAt` 同时出现。 */
  readonly createdAtUnknownReason?: string;
  readonly lastVerifiedAt?: string;
  readonly reviewDueAt?: string;
  readonly reviewStatus: ReviewStatus;
  readonly supersedesRuleId?: string;
  readonly revokedByRuleId?: string;
}

// ---------------------------------------------------------------------------
// 最终结果
// ---------------------------------------------------------------------------

export type ProvenanceSource = 'user' | 'system' | 'qualified-source' | 'legacy';

export interface FieldProvenance {
  readonly field: RuleField;
  readonly source: ProvenanceSource;
  readonly ref?: string;
}

/** 确定性解析产物；不是重新创造的来源证据。 */
export interface ResolvedPronunciation {
  readonly schema: string;
  readonly entryId: string;
  readonly conditions: ApplicabilityScope;
  readonly defaultReadingRefs: readonly string[];
  readonly supplementalReadingRefs: readonly string[];
  readonly retainedReadingRefs: readonly string[];
  readonly fieldProvenance: readonly FieldProvenance[];
  readonly unresolvedReasons: readonly string[];
  readonly excludedReasons: readonly string[];
  readonly reviewStatus: ReviewStatus;
  readonly suppression?: { readonly reason: string; readonly ruleId: string };
}

// ---------------------------------------------------------------------------
// 正式 manifest / 资产 / 兼容投影
// ---------------------------------------------------------------------------

export interface PublicationAsset {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly licenseSpdx: string;
}

export interface CompatibleProjectionEntry {
  readonly entryId: string;
  readonly legacyWord: string;
  readonly phonetic?: string;
  readonly notation?: Notation;
}

export interface LicenseAsset {
  readonly spdx: string;
  readonly url: string;
  readonly noticePath: string;
  readonly scope: 'wiktionary-derived' | 'application' | 'echdict-original';
}

/** 正式发布清单；候选不由此入口暴露。 */
export interface PublicationManifest {
  readonly schema: string;
  readonly manifestVersion: string;
  readonly identitySchemaVersion: string;
  readonly evidenceSchemaVersion: string;
  readonly observationSchemaVersion: string;
  readonly ruleSchemaVersion: string;
  readonly resolvedSchemaVersion: string;
  readonly candidateHash: string;
  readonly previousManifestVersion?: string;
  readonly assets: readonly PublicationAsset[];
  readonly perEntryResultVersions: Readonly<Record<string, string>>;
  readonly compatibleProjection: readonly CompatibleProjectionEntry[];
  readonly licenseAssets: readonly LicenseAsset[];
  readonly approvalId: string;
}

// ---------------------------------------------------------------------------
// 采集预算检查点
// ---------------------------------------------------------------------------

export type HeadState =
  | 'queued'
  | 'in-flight'
  | 'extracted'
  | 'missing'
  | 'no-qualified'
  | 'unresolved'
  | 'failed'
  | 'paused'
  | 'reported';

export type PauseReason =
  | 'head-limit'
  | 'byte-limit'
  | 'truncated'
  | 'ua-missing'
  | 'budget-unauthorized'
  | 'uncertain-consumption'
  | 'other';

export interface BudgetCheckpoint {
  readonly schema: string;
  readonly batchId: string;
  readonly schemaVersions: {
    readonly overlay: string;
    readonly extractor: string;
    readonly tagRule: string;
  };
  readonly approvedBudget: {
    readonly maxDistinctHeads: number;
    readonly maxDecompressedBytes: number;
    readonly authorized: boolean;
  };
  readonly queue: readonly string[];
  readonly headStates: Readonly<Record<string, HeadState>>;
  readonly startedDistinctHeads: readonly string[];
  readonly counts: {
    readonly requests: number;
    readonly retries: number;
    readonly auxiliaryRequests: number;
    readonly decompressedBytes: number;
    readonly networkBytes: number;
  };
  readonly lastCompletionEvidence?: string;
  readonly pauseReason?: PauseReason;
}

// ---------------------------------------------------------------------------
// 逐批批准
// ---------------------------------------------------------------------------

export interface ApprovalRecord {
  readonly schema: string;
  readonly approvalId: string;
  readonly candidateHash: string;
  readonly baseManifestVersion: string;
  readonly identitySchemaVersion: string;
  readonly evidenceSchemaVersion: string;
  readonly observationSchemaVersion: string;
  readonly ruleSchemaVersion: string;
  readonly resolvedSchemaVersion: string;
  readonly includedHeads: readonly string[];
  readonly excludedHeads: readonly string[];
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly action: 'approve-batch';
}

// ---------------------------------------------------------------------------
// 展示 DTO
// ---------------------------------------------------------------------------

export interface DisplayAttribution {
  readonly pageUrl: string;
  readonly historyUrl: string;
  readonly licenseUrl: string;
  readonly licenseSpdx: string;
  readonly changeNotice: string;
}

export interface PronunciationDisplayDto {
  readonly schema: string;
  readonly entryId: string;
  readonly role: GrammarRole;
  readonly word: string;
  readonly originalIpa: string;
  readonly notation: Notation;
  readonly accent: {
    readonly class: AccentClass;
    readonly label: string;
    readonly region?: string;
    readonly unspecified: boolean;
  };
  readonly usage: readonly UsageStatus[];
  readonly tier: ReadingDisposition;
  readonly reviewStatus: ReviewStatus;
  readonly origin: ProvenanceSource;
  readonly attribution: DisplayAttribution;
  readonly synthetic?: boolean;
}

// ---------------------------------------------------------------------------
// 校验基元
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

function result(issues: ValidationIssue[]): ValidationResult {
  return { valid: issues.length === 0, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pushIssue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    pushIssue(issues, `${path}.${key}`, 'required-string', `${key} 必须是非空字符串`);
  }
}

/** 要求是字符串，但允许空字符串（空观测保留用）。 */
function requireStringMaybeEmpty(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof record[key] !== 'string') {
    pushIssue(issues, `${path}.${key}`, 'required-string', `${key} 必须是字符串`);
  }
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = record[key];
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length === 0) {
    pushIssue(issues, `${path}.${key}`, 'optional-string', `${key} 若存在必须是非空字符串`);
  }
}

function requireNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    pushIssue(issues, `${path}.${key}`, 'required-number', `${key} 必须是非负有限数字`);
  }
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  options: { allowEmpty?: boolean } = {},
): void {
  const value = record[key];
  if (!Array.isArray(value)) {
    pushIssue(issues, `${path}.${key}`, 'required-array', `${key} 必须是数组`);
    return;
  }
  if (options.allowEmpty !== true && value.length === 0) {
    pushIssue(issues, `${path}.${key}`, 'empty-array', `${key} 不能为空数组`);
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      pushIssue(
        issues,
        `${path}.${key}[${String(index)}]`,
        'array-item',
        `${key} 元素必须是非空字符串`,
      );
    }
  });
}

function requireSchema(
  record: Record<string, unknown>,
  expected: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = record['schema'];
  if (value !== expected) {
    pushIssue(issues, `${path}.schema`, 'schema-version', `schema 必须为 ${expected}`);
  }
}

/** 校验某一层的 schema 版本字段必须等于对应常量。 */
function requireVersionField(
  record: Record<string, unknown>,
  key: string,
  expected: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (record[key] !== expected) {
    pushIssue(issues, `${path}.${key}`, 'schema-version', `${key} 必须为 ${expected}`);
  }
}

function requireEnum(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const value = record[key];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    pushIssue(issues, `${path}.${key}`, 'invalid-enum', `${key} 必须是 ${allowed.join(' | ')}`);
  }
}

/** 不透明 ID 字段校验。 */
function requireOpaqueId(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    pushIssue(issues, `${path}.${key}`, 'invalid-id', `${key} 必须是非空字符串`);
    return;
  }
  if (!isOpaqueIdFormat(value)) {
    pushIssue(issues, `${path}.${key}`, 'invalid-id', `${key} 必须是不透明 ID（ent_/lex_ + UUID）`);
  }
}

// ---------------------------------------------------------------------------
// 适用范围校验
// ---------------------------------------------------------------------------

/** 校验单个范围约束；`unknown` 与 `explicit-all` 不得互换，explicit-all 证据项须为非空字符串。 */
export function validateScopeConstraint(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'scope-object', '适用范围约束必须是对象');
    return;
  }
  const kind = value['kind'];
  if (kind === 'known') {
    const values = value['values'];
    if (!Array.isArray(values) || values.length === 0) {
      pushIssue(issues, `${path}.values`, 'scope-known-empty', 'known 约束必须给出至少一个取值');
    } else {
      values.forEach((item, index) => {
        if (typeof item !== 'string' || item.length === 0) {
          pushIssue(
            issues,
            `${path}.values[${String(index)}]`,
            'scope-known-item',
            'known 取值必须是非空字符串',
          );
        }
      });
    }
    return;
  }
  if (kind === 'explicit-all') {
    const evidence = value['evidence'];
    if (!Array.isArray(evidence) || evidence.length === 0) {
      pushIssue(issues, `${path}.evidence`, 'scope-all-evidence', 'explicit-all 必须带证据引用');
    } else {
      evidence.forEach((item, index) => {
        if (typeof item !== 'string' || item.length === 0) {
          pushIssue(
            issues,
            `${path}.evidence[${String(index)}]`,
            'scope-all-evidence-item',
            'explicit-all 证据项必须是非空字符串',
          );
        }
      });
    }
    return;
  }
  if (kind === 'unknown') {
    const reason = value['reason'];
    if (typeof reason !== 'string' || reason.length === 0) {
      pushIssue(issues, `${path}.reason`, 'scope-unknown-reason', 'unknown 必须给出原因');
    }
    return;
  }
  // 关键：未知范围不得当作 explicit-all；缺失字段不得隐式表示全范围。
  pushIssue(
    issues,
    `${path}.kind`,
    'scope-unknown-as-all',
    'kind 必须是 known | explicit-all | unknown',
  );
}

/** 校验八个维度的适用范围。 */
export function validateApplicabilityScope(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'scope-required', '适用范围必须是对象');
    return;
  }
  for (const dimension of SCOPE_DIMENSIONS) {
    if (!(dimension in value)) {
      pushIssue(issues, `${path}.${dimension}`, 'scope-missing-dimension', `缺少维度 ${dimension}`);
      continue;
    }
    validateScopeConstraint(value[dimension], `${path}.${dimension}`, issues);
  }
}

/** 收集范围内所有 explicit-all 的证据引用。 */
export function collectScopeEvidenceRefs(scope: unknown): readonly string[] {
  if (!isRecord(scope)) return [];
  const refs: string[] = [];
  for (const dimension of SCOPE_DIMENSIONS) {
    const constraint = scope[dimension];
    if (isRecord(constraint) && constraint['kind'] === 'explicit-all') {
      const evidence = constraint['evidence'];
      if (Array.isArray(evidence)) {
        for (const item of evidence) {
          if (typeof item === 'string') refs.push(item);
        }
      }
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// 各文档校验
// ---------------------------------------------------------------------------

export function validateSourceLicense(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'license-required', '缺少许可对象');
    return;
  }
  requireString(value, 'spdx', path, issues);
  requireString(value, 'url', path, issues);
  requireString(value, 'attribution', path, issues);
  requireString(value, 'changeNotice', path, issues);
  if (typeof value['shareAlike'] !== 'boolean') {
    pushIssue(issues, `${path}.shareAlike`, 'license-share-alike', 'shareAlike 必须是布尔值');
  }
}

export function validateSourceEvidence(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'evidence-required', '证据必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.evidence, path, issues);
  for (const key of [
    'evidenceId',
    'sourceSite',
    'language',
    'pageUrl',
    'historyUrl',
    'revision',
    'extractedAt',
    'requestVersion',
    'renderVersion',
    'extractorVersion',
    'tagRuleVersion',
    'responseContentHash',
    'ipaSemanticFingerprint',
  ]) {
    requireString(value, key, path, issues);
  }
  optionalString(value, 'cacheRef', path, issues);
  validateSourceLicense(value['license'], `${path}.license`, issues);
  // Wiktionary 衍生数据必须是 CC BY-SA 4.0 且同许可；不得把工具 MIT 当数据许可。
  const license = value['license'];
  if (isRecord(license) && value['sourceSite'] === 'wiktionary') {
    if (license['spdx'] !== 'CC-BY-SA-4.0') {
      pushIssue(
        issues,
        `${path}.license.spdx`,
        'license-spdx',
        'Wiktionary 衍生数据必须是 CC-BY-SA-4.0',
      );
    }
    if (license['shareAlike'] !== true) {
      pushIssue(
        issues,
        `${path}.license.shareAlike`,
        'license-share-alike',
        'Wiktionary 衍生数据必须声明同许可',
      );
    }
  }
}

export function validateObservation(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'observation-required', '观测必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.observation, path, issues);
  for (const key of ['observationId', 'evidenceId', 'language', 'sourceSpelling']) {
    requireString(value, key, path, issues);
  }
  // 空/片段观测保留：rawIpa / normalizedIpa 允许为空字符串。
  requireStringMaybeEmpty(value, 'rawIpa', path, issues);
  requireStringMaybeEmpty(value, 'normalizedIpa', path, issues);
  requireEnum(value, 'notation', ['phonemic', 'phonetic', 'unknown'], path, issues);
  requireEnum(
    value,
    'completeness',
    ['complete', 'fragment', 'empty', 'broken-delimiter', 'control-character', 'truncated'],
    path,
    issues,
  );
  requireStringArray(value, 'rawTags', path, issues, { allowEmpty: true });
  requireStringArray(value, 'rawQualifiers', path, issues, { allowEmpty: true });
  requireStringArray(value, 'structuralPath', path, issues, { allowEmpty: true });
  validateApplicabilityScope(value['applicability'], `${path}.applicability`, issues);
}

export function validateRule(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'rule-required', '规则必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.rule, path, issues);
  requireString(value, 'ruleId', path, issues);
  requireEnum(value, 'origin', ['system', 'user'], path, issues);
  requireEnum(
    value,
    'reviewStatus',
    ['active', 'due', 'pending-review', 'revoked', 'replaced'],
    path,
    issues,
  );
  // 旧有效规则可能无 timestamp：createdAt 可缺失，但须给出原因并保持待复核。
  const createdAt = value['createdAt'];
  const createdAtUnknownReason = value['createdAtUnknownReason'];
  if (createdAt === undefined) {
    if (typeof createdAtUnknownReason !== 'string' || createdAtUnknownReason.length === 0) {
      pushIssue(
        issues,
        `${path}.createdAt`,
        'rule-created-at-required',
        'createdAt 缺失时必须给出非空 createdAtUnknownReason（旧规则不得伪填时间）',
      );
    } else if (value['reviewStatus'] !== 'pending-review') {
      pushIssue(
        issues,
        `${path}.reviewStatus`,
        'rule-created-at-review',
        'createdAt 未知的旧规则必须保持 pending-review 且仍有效',
      );
    }
  } else if (typeof createdAt !== 'string' || createdAt.length === 0) {
    pushIssue(issues, `${path}.createdAt`, 'required-string', 'createdAt 若存在必须是非空字符串');
  } else if (createdAtUnknownReason !== undefined) {
    pushIssue(
      issues,
      `${path}.createdAtUnknownReason`,
      'rule-created-at-conflict',
      'createdAt 已知时不得再声明 createdAtUnknownReason',
    );
  }
  optionalString(value, 'createdAtUnknownReason', path, issues);
  optionalString(value, 'lastVerifiedAt', path, issues);
  optionalString(value, 'reviewDueAt', path, issues);
  optionalString(value, 'supersedesRuleId', path, issues);
  optionalString(value, 'revokedByRuleId', path, issues);
  requireStringArray(value, 'evidenceRefs', path, issues, { allowEmpty: true });

  const target = value['target'];
  if (!isRecord(target)) {
    pushIssue(issues, `${path}.target`, 'rule-target', '规则必须有 target');
  } else if (target['kind'] === 'entry') {
    requireOpaqueId(target, 'entryId', `${path}.target`, issues);
  } else if (target['kind'] === 'legacy-headword') {
    requireString(target, 'word', `${path}.target`, issues);
  } else {
    pushIssue(
      issues,
      `${path}.target.kind`,
      'rule-target-kind',
      'target.kind 必须是 entry | legacy-headword',
    );
  }

  const operations = value['operations'];
  if (!Array.isArray(operations) || operations.length === 0) {
    pushIssue(issues, `${path}.operations`, 'rule-operations', '规则必须至少有一个字段操作');
  } else {
    operations.forEach((operation, index) => {
      const operationPath = `${path}.operations[${String(index)}]`;
      if (!isRecord(operation)) {
        pushIssue(issues, operationPath, 'rule-operation', '操作必须是对象');
        return;
      }
      requireEnum(operation, 'field', ['word', 'phonetic', 'meaning'], operationPath, issues);
      requireEnum(operation, 'op', ['set', 'clear', 'suppress'], operationPath, issues);
      const op = operation['op'];
      const operationValue = operation['value'];
      if (op === 'set') {
        // set 不得用空值表达「清空」；空音标须用 suppress 明确表达。
        if (typeof operationValue !== 'string' || operationValue.length === 0) {
          pushIssue(
            issues,
            `${operationPath}.value`,
            'rule-op-set-empty',
            'set 操作必须带非空 value；空音标须用 suppress',
          );
        }
      } else if (operationValue !== undefined) {
        pushIssue(
          issues,
          `${operationPath}.value`,
          'rule-op-value-not-allowed',
          '非 set 操作不得带 value',
        );
      }
      const refs = operation['observationRefs'];
      if (refs !== undefined) {
        if (!Array.isArray(refs)) {
          pushIssue(
            issues,
            `${operationPath}.observationRefs`,
            'rule-operation-refs',
            'observationRefs 必须是数组',
          );
        } else {
          refs.forEach((ref, refIndex) => {
            if (typeof ref !== 'string' || ref.length === 0) {
              pushIssue(
                issues,
                `${operationPath}.observationRefs[${String(refIndex)}]`,
                'rule-operation-refs-item',
                'observationRefs 元素必须是非空字符串',
              );
            }
          });
        }
      }
    });
  }
  validateApplicabilityScope(value['conditions'], `${path}.conditions`, issues);
}

export function validateResolved(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'resolved-required', '结果必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.resolved, path, issues);
  requireOpaqueId(value, 'entryId', path, issues);
  requireEnum(
    value,
    'reviewStatus',
    ['active', 'due', 'pending-review', 'revoked', 'replaced'],
    path,
    issues,
  );
  requireStringArray(value, 'defaultReadingRefs', path, issues, { allowEmpty: true });
  requireStringArray(value, 'supplementalReadingRefs', path, issues, { allowEmpty: true });
  requireStringArray(value, 'retainedReadingRefs', path, issues, { allowEmpty: true });
  requireStringArray(value, 'unresolvedReasons', path, issues, { allowEmpty: true });
  requireStringArray(value, 'excludedReasons', path, issues, { allowEmpty: true });
  validateApplicabilityScope(value['conditions'], `${path}.conditions`, issues);

  const provenance = value['fieldProvenance'];
  if (!Array.isArray(provenance)) {
    pushIssue(
      issues,
      `${path}.fieldProvenance`,
      'resolved-provenance',
      'fieldProvenance 必须是数组',
    );
  } else {
    provenance.forEach((item, index) => {
      const itemPath = `${path}.fieldProvenance[${String(index)}]`;
      if (!isRecord(item)) {
        pushIssue(issues, itemPath, 'resolved-provenance-item', 'provenance 必须是对象');
        return;
      }
      requireEnum(item, 'field', ['word', 'phonetic', 'meaning'], itemPath, issues);
      requireEnum(
        item,
        'source',
        ['user', 'system', 'qualified-source', 'legacy'],
        itemPath,
        issues,
      );
      optionalString(item, 'ref', itemPath, issues);
    });
  }
}

export function validateManifest(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'manifest-required', 'manifest 必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.manifest, path, issues);
  for (const key of ['manifestVersion', 'candidateHash', 'approvalId']) {
    requireString(value, key, path, issues);
  }
  optionalString(value, 'previousManifestVersion', path, issues);
  // 各层版本必须是当前常量。
  requireVersionField(value, 'identitySchemaVersion', PRONUNCIATION_SCHEMA.identity, path, issues);
  requireVersionField(value, 'evidenceSchemaVersion', PRONUNCIATION_SCHEMA.evidence, path, issues);
  requireVersionField(
    value,
    'observationSchemaVersion',
    PRONUNCIATION_SCHEMA.observation,
    path,
    issues,
  );
  requireVersionField(value, 'ruleSchemaVersion', PRONUNCIATION_SCHEMA.rule, path, issues);
  requireVersionField(value, 'resolvedSchemaVersion', PRONUNCIATION_SCHEMA.resolved, path, issues);

  const assets = value['assets'];
  if (!Array.isArray(assets) || assets.length === 0) {
    pushIssue(issues, `${path}.assets`, 'manifest-assets', 'manifest 必须包含资产');
  } else {
    assets.forEach((asset, index) => {
      const assetPath = `${path}.assets[${String(index)}]`;
      if (!isRecord(asset)) {
        pushIssue(issues, assetPath, 'manifest-asset', '资产必须是对象');
        return;
      }
      requireString(asset, 'path', assetPath, issues);
      requireString(asset, 'sha256', assetPath, issues);
      requireString(asset, 'licenseSpdx', assetPath, issues);
      requireNumber(asset, 'bytes', assetPath, issues);
    });
  }

  const perEntry = value['perEntryResultVersions'];
  if (!isRecord(perEntry)) {
    pushIssue(
      issues,
      `${path}.perEntryResultVersions`,
      'manifest-per-entry',
      'perEntryResultVersions 必须是对象',
    );
  } else {
    for (const [entryId, version] of Object.entries(perEntry)) {
      if (!isOpaqueIdFormat(entryId)) {
        pushIssue(
          issues,
          `${path}.perEntryResultVersions.${entryId}`,
          'invalid-id',
          '结果版本键必须是不透明 ID',
        );
      }
      if (typeof version !== 'string' || version.length === 0) {
        pushIssue(
          issues,
          `${path}.perEntryResultVersions.${entryId}`,
          'manifest-per-entry-value',
          '结果版本必须是非空字符串',
        );
      }
    }
  }

  const projection = value['compatibleProjection'];
  if (!Array.isArray(projection)) {
    pushIssue(
      issues,
      `${path}.compatibleProjection`,
      'manifest-projection',
      'compatibleProjection 必须是数组',
    );
  } else {
    projection.forEach((entry, index) => {
      const entryPath = `${path}.compatibleProjection[${String(index)}]`;
      if (!isRecord(entry)) {
        pushIssue(issues, entryPath, 'manifest-projection-item', '投影项必须是对象');
        return;
      }
      requireOpaqueId(entry, 'entryId', entryPath, issues);
      requireString(entry, 'legacyWord', entryPath, issues);
      optionalString(entry, 'phonetic', entryPath, issues);
      if (entry['notation'] !== undefined) {
        requireEnum(entry, 'notation', ['phonemic', 'phonetic', 'unknown'], entryPath, issues);
      }
    });
  }

  const licenseAssets = value['licenseAssets'];
  if (!Array.isArray(licenseAssets) || licenseAssets.length === 0) {
    pushIssue(
      issues,
      `${path}.licenseAssets`,
      'manifest-license-assets',
      'manifest 必须包含许可资产',
    );
  } else {
    const wiktionaryLicenses: string[] = [];
    licenseAssets.forEach((asset, index) => {
      const assetPath = `${path}.licenseAssets[${String(index)}]`;
      if (!isRecord(asset)) {
        pushIssue(issues, assetPath, 'manifest-license-asset', '许可资产必须是对象');
        return;
      }
      requireString(asset, 'spdx', assetPath, issues);
      requireString(asset, 'url', assetPath, issues);
      requireString(asset, 'noticePath', assetPath, issues);
      requireEnum(
        asset,
        'scope',
        ['wiktionary-derived', 'application', 'echdict-original'],
        assetPath,
        issues,
      );
      if (asset['scope'] === 'wiktionary-derived') {
        if (asset['spdx'] !== 'CC-BY-SA-4.0') {
          pushIssue(
            issues,
            `${assetPath}.spdx`,
            'license-spdx',
            'Wiktionary 衍生许可资产必须是 CC-BY-SA-4.0',
          );
        } else {
          wiktionaryLicenses.push(asset['spdx']);
        }
      }
    });
    if (wiktionaryLicenses.length === 0) {
      pushIssue(
        issues,
        `${path}.licenseAssets`,
        'manifest-license-missing',
        '缺少 Wiktionary 衍生数据的 CC-BY-SA-4.0 许可资产',
      );
    }
  }
}

export function validateCheckpoint(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'checkpoint-required', 'checkpoint 必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.checkpoint, path, issues);
  requireString(value, 'batchId', path, issues);
  const versions = value['schemaVersions'];
  if (!isRecord(versions)) {
    pushIssue(issues, `${path}.schemaVersions`, 'checkpoint-versions', 'schemaVersions 必须是对象');
  } else {
    for (const key of ['overlay', 'extractor', 'tagRule']) {
      requireString(versions, key, `${path}.schemaVersions`, issues);
    }
  }
  const budget = value['approvedBudget'];
  if (!isRecord(budget)) {
    pushIssue(issues, `${path}.approvedBudget`, 'checkpoint-budget', 'approvedBudget 必须是对象');
  } else {
    requireNumber(budget, 'maxDistinctHeads', `${path}.approvedBudget`, issues);
    requireNumber(budget, 'maxDecompressedBytes', `${path}.approvedBudget`, issues);
    if (typeof budget['authorized'] !== 'boolean') {
      pushIssue(
        issues,
        `${path}.approvedBudget.authorized`,
        'checkpoint-budget-authorized',
        'authorized 必须是布尔值',
      );
    }
  }
  requireStringArray(value, 'queue', path, issues, { allowEmpty: true });
  requireStringArray(value, 'startedDistinctHeads', path, issues, { allowEmpty: true });
  const headStates = value['headStates'];
  if (!isRecord(headStates)) {
    pushIssue(issues, `${path}.headStates`, 'checkpoint-head-states', 'headStates 必须是对象');
  } else {
    const allowedStates = [
      'queued',
      'in-flight',
      'extracted',
      'missing',
      'no-qualified',
      'unresolved',
      'failed',
      'paused',
      'reported',
    ];
    for (const [head, state] of Object.entries(headStates)) {
      if (typeof state !== 'string' || !allowedStates.includes(state)) {
        pushIssue(issues, `${path}.headStates.${head}`, 'checkpoint-head-state', '词头状态非法');
      }
    }
  }
  const counts = value['counts'];
  if (!isRecord(counts)) {
    pushIssue(issues, `${path}.counts`, 'checkpoint-counts', 'counts 必须是对象');
  } else {
    for (const key of [
      'requests',
      'retries',
      'auxiliaryRequests',
      'decompressedBytes',
      'networkBytes',
    ]) {
      requireNumber(counts, key, `${path}.counts`, issues);
    }
  }
  optionalString(value, 'lastCompletionEvidence', path, issues);
  if (value['pauseReason'] !== undefined) {
    requireEnum(
      value,
      'pauseReason',
      [
        'head-limit',
        'byte-limit',
        'truncated',
        'ua-missing',
        'budget-unauthorized',
        'uncertain-consumption',
        'other',
      ],
      path,
      issues,
    );
  }
}

export function validateApproval(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'approval-required', '批准记录必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.approval, path, issues);
  for (const key of [
    'approvalId',
    'candidateHash',
    'baseManifestVersion',
    'approvedBy',
    'approvedAt',
  ]) {
    requireString(value, key, path, issues);
  }
  requireVersionField(value, 'identitySchemaVersion', PRONUNCIATION_SCHEMA.identity, path, issues);
  requireVersionField(value, 'evidenceSchemaVersion', PRONUNCIATION_SCHEMA.evidence, path, issues);
  requireVersionField(
    value,
    'observationSchemaVersion',
    PRONUNCIATION_SCHEMA.observation,
    path,
    issues,
  );
  requireVersionField(value, 'ruleSchemaVersion', PRONUNCIATION_SCHEMA.rule, path, issues);
  requireVersionField(value, 'resolvedSchemaVersion', PRONUNCIATION_SCHEMA.resolved, path, issues);
  requireStringArray(value, 'includedHeads', path, issues, { allowEmpty: true });
  requireStringArray(value, 'excludedHeads', path, issues, { allowEmpty: true });
  const action = value['action'];
  if (action !== 'approve-batch') {
    pushIssue(issues, `${path}.action`, 'approval-action', 'action 必须是 approve-batch');
  }
}

export function validateDisplay(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'display-required', '展示 DTO 必须是对象');
    return;
  }
  requireSchema(value, PRONUNCIATION_SCHEMA.display, path, issues);
  requireOpaqueId(value, 'entryId', path, issues);
  requireString(value, 'word', path, issues);
  requireStringMaybeEmpty(value, 'originalIpa', path, issues);
  requireEnum(value, 'role', ['base', 'present', 'past', 'past-participle'], path, issues);
  requireEnum(value, 'notation', ['phonemic', 'phonetic', 'unknown'], path, issues);
  requireEnum(
    value,
    'tier',
    ['default', 'supplemental', 'evidence-only', 'unresolved'],
    path,
    issues,
  );
  requireEnum(
    value,
    'reviewStatus',
    ['active', 'due', 'pending-review', 'revoked', 'replaced'],
    path,
    issues,
  );
  requireEnum(value, 'origin', ['user', 'system', 'qualified-source', 'legacy'], path, issues);
  requireStringArray(value, 'usage', path, issues, { allowEmpty: true });

  const accent = value['accent'];
  if (!isRecord(accent)) {
    pushIssue(issues, `${path}.accent`, 'display-accent', 'accent 必须是对象');
  } else {
    requireEnum(
      accent,
      'class',
      ['standard', 'unspecified', 'uk-unspecified', 'us-unspecified', 'regional', 'unknown'],
      `${path}.accent`,
      issues,
    );
    requireString(accent, 'label', `${path}.accent`, issues);
    optionalString(accent, 'region', `${path}.accent`, issues);
    if (typeof accent['unspecified'] !== 'boolean') {
      pushIssue(
        issues,
        `${path}.accent.unspecified`,
        'display-accent-unspecified',
        'unspecified 必须是布尔值',
      );
    }
    // 无口音不得伪装 UK/US：unspecified 时 class 必须是 unspecified。
    if (accent['unspecified'] === true && accent['class'] !== 'unspecified') {
      pushIssue(
        issues,
        `${path}.accent`,
        'display-accent-disguise',
        '未注明口音不得标为 UK/US 等具体口音',
      );
    }
  }

  const attribution = value['attribution'];
  if (!isRecord(attribution)) {
    pushIssue(issues, `${path}.attribution`, 'display-attribution', 'attribution 必须是对象');
  } else {
    for (const key of ['pageUrl', 'historyUrl', 'licenseUrl', 'licenseSpdx', 'changeNotice']) {
      requireString(attribution, key, `${path}.attribution`, issues);
    }
  }
}

// ---------------------------------------------------------------------------
// 文档集与引用完整性
// ---------------------------------------------------------------------------

/** 一个离线文档集：身份 ID 列表 + 各层记录 + 正式 manifest + 批准 + 检查点。 */
export interface OverlayDocumentSet {
  readonly identityEntryIds: readonly string[];
  readonly identityLexemeIds?: readonly string[];
  readonly evidence: readonly SourceEvidence[];
  readonly observations: readonly PronunciationObservation[];
  readonly rules: readonly PronunciationRule[];
  readonly resolved: readonly ResolvedPronunciation[];
  readonly manifest: PublicationManifest;
  readonly approvals: readonly ApprovalRecord[];
  readonly checkpoints: readonly BudgetCheckpoint[];
  readonly displays?: readonly PronunciationDisplayDto[];
}

/** 文档集中必须存在的列表字段；缺失不得默认为空数组。 */
const REQUIRED_DOCUMENT_LISTS = [
  'identityEntryIds',
  'evidence',
  'observations',
  'rules',
  'resolved',
  'approvals',
  'checkpoints',
] as const;

function collectIds(
  items: readonly Record<string, unknown>[],
  key: string,
  path: string,
  issues: ValidationIssue[],
): ReadonlyMap<string, number> {
  const ids = new Map<string, number>();
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    const id = item[key];
    if (typeof id !== 'string' || id.length === 0) return;
    const previous = ids.get(id);
    if (previous !== undefined) {
      pushIssue(issues, `${path}[${String(index)}].${key}`, 'duplicate-id', `重复 ID ${id}`);
      return;
    }
    ids.set(id, index);
  });
  return ids;
}

/** 校验完整文档集：形状 + 交叉引用 + 许可 + 批准绑定。 */
export function validateOverlayDocumentSet(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return result([{ path: '$', code: 'document-set-required', message: '文档集必须是对象' }]);
  }

  // 必需的列表字段缺失或类型错误 → 直接拒绝，不得默认空数组。
  for (const key of REQUIRED_DOCUMENT_LISTS) {
    if (!Array.isArray(value[key])) {
      pushIssue(issues, `$.${key}`, 'document-list-required', `${key} 必须是数组`);
    }
  }
  // 可选列表字段：若存在则必须是数组（不得静默丢弃非法类型）。
  for (const key of ['identityLexemeIds', 'displays'] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      pushIssue(issues, `$.${key}`, 'document-list-optional-array', `${key} 若存在必须是数组`);
    }
  }
  if (!isRecord(value['manifest'])) {
    pushIssue(issues, '$.manifest', 'manifest-required', 'manifest 必须是对象');
  }

  const evidenceList = Array.isArray(value['evidence']) ? (value['evidence'] as unknown[]) : [];
  const observations = Array.isArray(value['observations'])
    ? (value['observations'] as unknown[])
    : [];
  const rules = Array.isArray(value['rules']) ? (value['rules'] as unknown[]) : [];
  const resolvedList = Array.isArray(value['resolved']) ? (value['resolved'] as unknown[]) : [];
  const approvals = Array.isArray(value['approvals']) ? (value['approvals'] as unknown[]) : [];
  const checkpoints = Array.isArray(value['checkpoints'])
    ? (value['checkpoints'] as unknown[])
    : [];
  const displays = Array.isArray(value['displays']) ? (value['displays'] as unknown[]) : [];

  const identityEntryIds = Array.isArray(value['identityEntryIds'])
    ? (value['identityEntryIds'] as unknown[])
    : [];
  const identitySet = new Set<string>();
  identityEntryIds.forEach((id, index) => {
    if (typeof id !== 'string' || id.length === 0) {
      pushIssue(
        issues,
        `$.identityEntryIds[${String(index)}]`,
        'identity-id',
        '身份 ID 必须是非空字符串',
      );
      return;
    }
    if (!isOpaqueIdFormat(id) || !id.startsWith('ent_')) {
      pushIssue(
        issues,
        `$.identityEntryIds[${String(index)}]`,
        'invalid-id',
        'entry 身份 ID 必须是 ent_ 不透明 ID',
      );
    }
    if (identitySet.has(id)) {
      pushIssue(
        issues,
        `$.identityEntryIds[${String(index)}]`,
        'duplicate-id',
        `重复身份 ID ${id}`,
      );
    }
    identitySet.add(id);
  });

  // lexeme 身份：可选列表，但一旦存在必须校验前缀/重复，且供 known scope 引用核对。
  const identityLexemeList = Array.isArray(value['identityLexemeIds'])
    ? (value['identityLexemeIds'] as unknown[])
    : [];
  const identityLexemeSet = new Set<string>();
  identityLexemeList.forEach((id, index) => {
    if (typeof id !== 'string' || id.length === 0) {
      pushIssue(
        issues,
        `$.identityLexemeIds[${String(index)}]`,
        'identity-id',
        'lexeme 身份 ID 必须是非空字符串',
      );
      return;
    }
    if (!isOpaqueIdFormat(id) || !id.startsWith('lex_')) {
      pushIssue(
        issues,
        `$.identityLexemeIds[${String(index)}]`,
        'invalid-id',
        'lexeme 身份 ID 必须是 lex_ 不透明 ID',
      );
    }
    if (identityLexemeSet.has(id)) {
      pushIssue(
        issues,
        `$.identityLexemeIds[${String(index)}]`,
        'duplicate-id',
        `重复 lexeme 身份 ID ${id}`,
      );
    }
    identityLexemeSet.add(id);
  });

  evidenceList.forEach((item, index) => {
    validateSourceEvidence(item, `$.evidence[${String(index)}]`, issues);
  });
  observations.forEach((item, index) => {
    validateObservation(item, `$.observations[${String(index)}]`, issues);
  });
  rules.forEach((item, index) => {
    validateRule(item, `$.rules[${String(index)}]`, issues);
  });
  resolvedList.forEach((item, index) => {
    validateResolved(item, `$.resolved[${String(index)}]`, issues);
  });
  validateManifest(value['manifest'], '$.manifest', issues);
  approvals.forEach((item, index) => {
    validateApproval(item, `$.approvals[${String(index)}]`, issues);
  });
  checkpoints.forEach((item, index) => {
    validateCheckpoint(item, `$.checkpoints[${String(index)}]`, issues);
  });
  displays.forEach((item, index) => {
    validateDisplay(item, `$.displays[${String(index)}]`, issues);
  });

  const evidenceIds = collectIds(
    evidenceList as Record<string, unknown>[],
    'evidenceId',
    '$.evidence',
    issues,
  );
  const observationIds = collectIds(
    observations as Record<string, unknown>[],
    'observationId',
    '$.observations',
    issues,
  );
  const approvalIds = collectIds(
    approvals as Record<string, unknown>[],
    'approvalId',
    '$.approvals',
    issues,
  );
  const ruleIds = collectIds(rules as Record<string, unknown>[], 'ruleId', '$.rules', issues);

  const scopePaths: readonly (readonly [unknown, string])[] = [
    ...observations.map(
      (item, index) =>
        [
          isRecord(item) ? item['applicability'] : undefined,
          `$.observations[${String(index)}].applicability`,
        ] as const,
    ),
    ...rules.map(
      (item, index) =>
        [
          isRecord(item) ? item['conditions'] : undefined,
          `$.rules[${String(index)}].conditions`,
        ] as const,
    ),
    ...resolvedList.map(
      (item, index) =>
        [
          isRecord(item) ? item['conditions'] : undefined,
          `$.resolved[${String(index)}].conditions`,
        ] as const,
    ),
  ];

  // known 维度的 entry / lexeme 取值必须引用已声明身份（未知不得伪装为具体 ID）。
  for (const [scope, path] of scopePaths) {
    if (!isRecord(scope)) continue;
    const entryConstraint = scope['entry'];
    if (
      isRecord(entryConstraint) &&
      entryConstraint['kind'] === 'known' &&
      Array.isArray(entryConstraint['values'])
    ) {
      entryConstraint['values'].forEach((ref: unknown, refIndex: number) => {
        if (typeof ref === 'string' && !identitySet.has(ref)) {
          pushIssue(
            issues,
            `${path}.entry.values[${String(refIndex)}]`,
            'dangling-reference',
            `known entry 引用了不存在的条目 ${ref}`,
          );
        }
      });
    }
    const lexemeConstraint = scope['lexeme'];
    if (
      isRecord(lexemeConstraint) &&
      lexemeConstraint['kind'] === 'known' &&
      Array.isArray(lexemeConstraint['values'])
    ) {
      lexemeConstraint['values'].forEach((ref: unknown, refIndex: number) => {
        if (typeof ref === 'string' && !identityLexemeSet.has(ref)) {
          pushIssue(
            issues,
            `${path}.lexeme.values[${String(refIndex)}]`,
            'dangling-reference',
            `known lexeme 引用了不存在的 lexeme ${ref}`,
          );
        }
      });
    }
  }

  // 引用：观测 -> 证据
  observations.forEach((item, index) => {
    if (!isRecord(item)) return;
    const evidenceId = item['evidenceId'];
    if (typeof evidenceId === 'string' && !evidenceIds.has(evidenceId)) {
      pushIssue(
        issues,
        `$.observations[${String(index)}].evidenceId`,
        'dangling-reference',
        `引用了不存在的证据 ${evidenceId}`,
      );
    }
  });

  // 引用：范围内 explicit-all 证据必须存在
  for (const [scope, path] of scopePaths) {
    for (const ref of collectScopeEvidenceRefs(scope)) {
      if (!evidenceIds.has(ref)) {
        pushIssue(
          issues,
          path,
          'dangling-reference',
          `范围 explicit-all 引用了不存在的证据 ${ref}`,
        );
      }
    }
  }

  // 引用：规则 -> 证据 / 身份 / operation observationRefs
  rules.forEach((item, index) => {
    if (!isRecord(item)) return;
    const refs = item['evidenceRefs'];
    if (Array.isArray(refs)) {
      refs.forEach((ref, refIndex) => {
        if (typeof ref === 'string' && !evidenceIds.has(ref)) {
          pushIssue(
            issues,
            `$.rules[${String(index)}].evidenceRefs[${String(refIndex)}]`,
            'dangling-reference',
            `引用了不存在的证据 ${ref}`,
          );
        }
      });
    }
    const target = item['target'];
    if (isRecord(target) && target['kind'] === 'entry') {
      const entryId = target['entryId'];
      if (typeof entryId === 'string' && !identitySet.has(entryId)) {
        pushIssue(
          issues,
          `$.rules[${String(index)}].target.entryId`,
          'dangling-reference',
          `引用了不存在的条目 ${entryId}`,
        );
      }
    }
    const operations = item['operations'];
    if (Array.isArray(operations)) {
      operations.forEach((operation, opIndex) => {
        if (!isRecord(operation)) return;
        const opRefs = operation['observationRefs'];
        if (!Array.isArray(opRefs)) return;
        opRefs.forEach((ref, refIndex) => {
          if (typeof ref === 'string' && !observationIds.has(ref)) {
            pushIssue(
              issues,
              `$.rules[${String(index)}].operations[${String(opIndex)}].observationRefs[${String(refIndex)}]`,
              'dangling-reference',
              `引用了不存在的观测 ${ref}`,
            );
          }
        });
      });
    }
    // supersedes / revokedBy 必须引用存在的规则，且不得自引用。
    for (const key of ['supersedesRuleId', 'revokedByRuleId']) {
      const ref = item[key];
      if (typeof ref !== 'string') continue;
      if (ref === item['ruleId']) {
        pushIssue(
          issues,
          `$.rules[${String(index)}].${key}`,
          'self-reference',
          `${key} 不得引用自身`,
        );
      } else if (!ruleIds.has(ref)) {
        pushIssue(
          issues,
          `$.rules[${String(index)}].${key}`,
          'dangling-reference',
          `引用了不存在的规则 ${ref}`,
        );
      }
    }
  });

  // 引用：结果 -> 身份 / 观测 / 规则 / 证据
  resolvedList.forEach((item, index) => {
    if (!isRecord(item)) return;
    const entryId = item['entryId'];
    if (typeof entryId === 'string' && !identitySet.has(entryId)) {
      pushIssue(
        issues,
        `$.resolved[${String(index)}].entryId`,
        'dangling-reference',
        `引用了不存在的条目 ${entryId}`,
      );
    }
    for (const key of ['defaultReadingRefs', 'supplementalReadingRefs', 'retainedReadingRefs']) {
      const refs = item[key];
      if (!Array.isArray(refs)) continue;
      refs.forEach((ref, refIndex) => {
        if (typeof ref === 'string' && !observationIds.has(ref)) {
          pushIssue(
            issues,
            `$.resolved[${String(index)}].${key}[${String(refIndex)}]`,
            'dangling-reference',
            `引用了不存在的观测 ${ref}`,
          );
        }
      });
    }
    // 逐字段来源引用：user/system 指规则，qualified-source 指观测，legacy 允许证据/观测/规则。
    const provenance = item['fieldProvenance'];
    if (Array.isArray(provenance)) {
      provenance.forEach((entry, provIndex) => {
        if (!isRecord(entry)) return;
        const ref = entry['ref'];
        if (typeof ref !== 'string') return;
        const source = entry['source'];
        const mustBeRule = source === 'user' || source === 'system';
        if (mustBeRule && !ruleIds.has(ref)) {
          pushIssue(
            issues,
            `$.resolved[${String(index)}].fieldProvenance[${String(provIndex)}].ref`,
            'dangling-reference',
            `fieldProvenance 应按 source 引用规则 ${ref}`,
          );
        } else if (source === 'qualified-source' && !observationIds.has(ref)) {
          pushIssue(
            issues,
            `$.resolved[${String(index)}].fieldProvenance[${String(provIndex)}].ref`,
            'dangling-reference',
            `qualified-source 的 fieldProvenance 应引用观测 ${ref}`,
          );
        } else if (
          source === 'legacy' &&
          !(evidenceIds.has(ref) || observationIds.has(ref) || ruleIds.has(ref))
        ) {
          pushIssue(
            issues,
            `$.resolved[${String(index)}].fieldProvenance[${String(provIndex)}].ref`,
            'dangling-reference',
            `legacy 的 fieldProvenance 引用了不存在的来源 ${ref}`,
          );
        }
      });
    }
    // suppression.ruleId 必须引用存在的规则。
    const suppression = item['suppression'];
    if (isRecord(suppression)) {
      const ruleId = suppression['ruleId'];
      if (typeof ruleId === 'string' && !ruleIds.has(ruleId)) {
        pushIssue(
          issues,
          `$.resolved[${String(index)}].suppression.ruleId`,
          'dangling-reference',
          `suppression 引用了不存在的规则 ${ruleId}`,
        );
      }
    }
  });

  // 引用：检查点 lastCompletionEvidence 必须引用存在的证据。
  checkpoints.forEach((checkpoint, index) => {
    if (!isRecord(checkpoint)) return;
    const ref = checkpoint['lastCompletionEvidence'];
    if (typeof ref === 'string' && !evidenceIds.has(ref)) {
      pushIssue(
        issues,
        `$.checkpoints[${String(index)}].lastCompletionEvidence`,
        'dangling-reference',
        `引用了不存在的证据 ${ref}`,
      );
    }
  });

  // 引用：展示 DTO -> 身份
  displays.forEach((item, index) => {
    if (!isRecord(item)) return;
    const entryId = item['entryId'];
    if (typeof entryId === 'string' && !identitySet.has(entryId)) {
      pushIssue(
        issues,
        `$.displays[${String(index)}].entryId`,
        'dangling-reference',
        `引用了不存在的条目 ${entryId}`,
      );
    }
  });

  // 批准绑定：manifest.approvalId 必须存在，且候选 hash 与基线版本一致
  const manifest = value['manifest'];
  if (isRecord(manifest)) {
    const approvalId = manifest['approvalId'];
    if (typeof approvalId === 'string' && !approvalIds.has(approvalId)) {
      pushIssue(
        issues,
        '$.manifest.approvalId',
        'dangling-reference',
        `引用了不存在的批准 ${approvalId}`,
      );
    } else if (typeof approvalId === 'string') {
      const approvalIndex = approvalIds.get(approvalId);
      const approval = approvalIndex === undefined ? undefined : approvals[approvalIndex];
      if (isRecord(approval)) {
        if (approval['candidateHash'] !== manifest['candidateHash']) {
          pushIssue(
            issues,
            '$.manifest.candidateHash',
            'approval-mismatch',
            'manifest 与批准记录的 candidateHash 不一致',
          );
        }
        if (approval['baseManifestVersion'] !== manifest['previousManifestVersion']) {
          pushIssue(
            issues,
            '$.manifest.previousManifestVersion',
            'approval-mismatch',
            '批准绑定的 base manifest 与当前 baseline 不一致',
          );
        }
      }
    }
    const perEntry = manifest['perEntryResultVersions'];
    if (isRecord(perEntry)) {
      for (const entryId of Object.keys(perEntry)) {
        if (!identitySet.has(entryId)) {
          pushIssue(
            issues,
            `$.manifest.perEntryResultVersions.${entryId}`,
            'dangling-reference',
            `结果版本引用了不存在的条目 ${entryId}`,
          );
        }
      }
    }
    // 兼容投影的 entryId 必须引用已声明身份。
    const projection = manifest['compatibleProjection'];
    if (Array.isArray(projection)) {
      projection.forEach((entry, index) => {
        if (!isRecord(entry)) return;
        const entryId = entry['entryId'];
        if (typeof entryId === 'string' && !identitySet.has(entryId)) {
          pushIssue(
            issues,
            `$.manifest.compatibleProjection[${String(index)}].entryId`,
            'dangling-reference',
            `投影引用了不存在的条目 ${entryId}`,
          );
        }
      });
    }
  }

  return result(issues);
}

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

/** 计算观测的语义指纹：只覆盖 IPA + 标签 + 适用范围，顺序无关。 */
export function computeObservationFingerprint(observation: PronunciationObservation): string {
  return fingerprintJson({
    applicability: observation.applicability,
    notation: observation.notation,
    // 以规范化比较值参与指纹；不改写原始 rawIpa / normalizedIpa 的保存值。
    normalizedIpa: canonicalizeIpaForComparison(observation.normalizedIpa),
    rawIpa: canonicalizeIpaForComparison(observation.rawIpa),
    rawQualifiers: [...observation.rawQualifiers].sort(),
    rawTags: [...observation.rawTags].sort(),
  });
}

// ---------------------------------------------------------------------------
// IPA 比较规范化（仅用于比较/去重，绝不改写保存的原值）
// ---------------------------------------------------------------------------

/** 最小 HTML 实体解码表；未知实体会原样保留，不猜测。 */
const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/** 安全地把码点还原为字符；非法码点原样保留。 */
function codePointToString(codePoint: number): string | undefined {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return undefined;
  return String.fromCodePoint(codePoint);
}

/** 解码最小集合的 HTML 实体（含十进制/十六进制数字实体），未知实体保持原样。 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/gu, (match: string, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return codePointToString(Number.parseInt(body.slice(2), 16)) ?? match;
    }
    if (body.startsWith('#')) {
      return codePointToString(Number.parseInt(body.slice(1), 10)) ?? match;
    }
    return NAMED_HTML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * 语义比较规范化：解码 HTML 实体、Unicode NFC、去除字符串边界无关空白。
 * 只用于比较与真正重复去重，调用方仍完整保存原始 IPA。
 */
export function canonicalizeIpaForComparison(input: string): string {
  return decodeHtmlEntities(input).normalize('NFC').trim();
}
