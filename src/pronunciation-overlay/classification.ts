/**
 * 任务 3.2：版本化标签分类、准入、处置、排序、安全去重与语义指纹纯函数。
 *
 * 依 2.1 已验收合同（`contracts.ts`）。本模块**只做纯函数分类**：
 * - 完整保留原始 IPA / tags / qualifiers / 结构路径（不改 raw，不 trim，不删重音/长度/音节界/变音符/定界符）。
 * - 派生规范分类（accent / usage / 完整性 / notation / unknown 理由），版本化规则表。
 * - 严格三态 scope 校验；未知不得当通配，不得缺省为 true，不能用“已确认标记”绕过。
 * - 安全比较：HTML 实体解码 + Unicode NFC + 边界 trim；仅用于比较与真正重复去重，
 *   scope 身份值保持精确（不 lower、不移标点）。
 * - 不实现第 3.1 scope 解析器；分类只读取最终（可能已解析）的 scope 三态。
 *
 * 不联网、不采集、不发布。分类不产生正式结果，仅提供可审查解释与元信息。
 *
 * 说明：合同中 `computeObservationFingerprint` 仍把全部 rawTags 纳入且 qualifier 未做
 * NFC/实体归一；本模块提供**正确的语义指纹 API** `computeSemanticFingerprint`，不改旧合同
 * API；后续 3.4 / 6.4 集成应统一到本 API（见 evidence/07-classification.md）。
 */

import type {
  AccentClass,
  ApplicabilityScope,
  Completeness,
  Notation,
  PronunciationObservation,
  ReadingDisposition,
  ScopeConstraint,
  UsageStatus,
} from './contracts';
import { canonicalizeIpaForComparison, decodeHtmlEntities } from './contracts';
import { fingerprintJson } from './json';

export const CLASSIFICATION_RULE_VERSION = 'pronunciation-classification/3';

export type ScopeDimension =
  | 'language'
  | 'entry'
  | 'lexeme'
  | 'role'
  | 'pos'
  | 'sense'
  | 'accent'
  | 'other';

const ALL_SCOPE_DIMENSIONS: readonly ScopeDimension[] = [
  'language',
  'entry',
  'lexeme',
  'role',
  'pos',
  'sense',
  'accent',
  'other',
];

/** 默认要求已确认（非 unknown）的 scope 维度；调用方只能追加，不能缩减。
 * `other` 含在内：unknown 的其他限制不得当作“无限制”而放默认。 */
export const DEFAULT_REQUIRED_SCOPE_DIMENSIONS: readonly ScopeDimension[] = [
  'language',
  'entry',
  'lexeme',
  'role',
  'pos',
  'sense',
  'other',
];

// ---------------------------------------------------------------------------
// 标签规则表（版本化）
// ---------------------------------------------------------------------------

/** 已确认排版/结构：精确匹配表（不 broad-prefix，避免吞掉可能的 grammar 限制）。 */
const CONFIRMED_LAYOUT_TOKENS: ReadonlySet<string> = new Set([
  'ipa',
  'audio',
  'audiofile',
  'h-audio',
  'mw-audio',
  'media',
  'heading',
  // 已确认的 Wikimedia 结构 class（精确，不用 mw- 前缀泛化）
  'mw-heading',
  'mw-heading2',
  'mw-heading3',
  'mw-heading4',
  'mw-heading5',
  'mw-heading6',
  'mw-parser-output',
  'mw-editsection',
  'mw-empty-elt',
  'mw-content-text',
  'mw-cite-backlink',
  'mw-references-wrap',
  'mw-collapsible',
  'toc',
  'tocnumber',
  'toctext',
  'catlinks',
  'noprint',
  'reference',
  'references',
  'reflist',
  'hatnote',
  'sistersitebox',
  'interproject',
  'plainlist',
  'hlist',
  'navbar',
  'navbox',
  'metadata',
  'printfooter',
  // 纯 markup class（非语义限定）
  'qualifier-content',
  'qualifier',
  'ib-content',
  'label',
  'usage-label-sense',
  'usage-label-accent',
  'accent-label',
]);

/** 谨慎保留的结构前缀：仅 `heading:`（本工具自身生成的标题 tag），不使用 `mw-`。 */
const CAUTIOUS_LAYOUT_PREFIXES: readonly string[] = ['heading:'];

/** 明确“非限制信息”的版本化规则表：命中即保留为 unclassified 但可参与（不 unresolved）。 */
const NON_RESTRICTIVE_TAG_RULES: ReadonlySet<string> = new Set([
  'pronunciation',
  'enpr',
  'ipa-label',
]);

export function isLayoutToken(token: string): boolean {
  const raw = decodeHtmlEntities(token).normalize('NFC').trim().toLowerCase();
  if (raw.length === 0) return true;
  if (CONFIRMED_LAYOUT_TOKENS.has(raw)) return true;
  if (CAUTIOUS_LAYOUT_PREFIXES.some((prefix) => raw.startsWith(prefix))) return true;
  const spaced = raw.replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return CONFIRMED_LAYOUT_TOKENS.has(spaced);
}

interface AccentRule {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly family: 'standard';
}

const STANDARD_ACCENT_RULES: readonly AccentRule[] = [
  { canonical: 'RP', aliases: ['rp', 'received pronunciation', 'received-pronunciation'], family: 'standard' },
  { canonical: 'SSB', aliases: ['ssb', 'standard southern british'], family: 'standard' },
  { canonical: 'GA', aliases: ['ga', 'general american', 'general-american'], family: 'standard' },
];

const UK_UNSPECIFIED_ALIASES: readonly string[] = ['uk', 'united kingdom'];
const US_UNSPECIFIED_ALIASES: readonly string[] = ['us', 'united states'];

const REGION_ALIASES: readonly (readonly [string, string])[] = [
  ['scotland', 'Scotland'],
  ['scottish', 'Scotland'],
  ['northern england', 'Northern England'],
  ['northern-england', 'Northern England'],
  ['southern us', 'Southern US'],
  ['southern-us', 'Southern US'],
  ['southern united states', 'Southern US'],
  ['australia', 'Australia'],
  ['australian', 'Australia'],
  ['new zealand', 'New Zealand'],
  ['new-zealand', 'New Zealand'],
  ['canada', 'Canada'],
  ['canadian', 'Canada'],
  ['ireland', 'Ireland'],
  ['irish', 'Ireland'],
  ['south africa', 'South Africa'],
  ['south-africa', 'South Africa'],
];

const REGIONAL_UNSPECIFIED_ALIASES: readonly string[] = ['regional', 'dialectal', 'regional-label'];

const USAGE_ALIASES: readonly (readonly [string, UsageStatus])[] = [
  ['rare', 'rare'],
  ['archaic', 'archaic'],
  ['obsolete', 'obsolete'],
];

/** 已知但非 rare/archaic/obsolete、也非 accent/region 的限定标签（保守受限待核验）。 */
const OTHER_RESTRICTION_TOKENS: ReadonlySet<string> = new Set([
  'nonstandard',
  'informal',
  'formal',
  'colloquial',
  'slang',
  'dated',
  'literary',
  'poetic',
  'figurative',
  'idiomatic',
  'derogatory',
  'offensive',
  'humorous',
  'historical',
  'proscribed',
  'uncommon',
  'chiefly',
  'especially',
  'originally',
  'broadly',
  'loosely',
  'sometimes',
]);

// ---------------------------------------------------------------------------
// 比较规范化（仅比较；不改 raw）
// ---------------------------------------------------------------------------

/** 标签匹配用：lower + 连字符/标点归一为空格。**不用于 scope 身份值。** */
export function normalizeToken(text: string): string {
  return decodeHtmlEntities(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[()[\],;./·]+/gu, ' ')
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** scope 身份值比较规范化：仅 HTML 实体 + NFC + 边界 trim（不 lower、不移标点）。 */
export function compareNormalize(value: string): string {
  return decodeHtmlEntities(value).normalize('NFC').trim();
}

function hasControlCategory(text: string): boolean {
  return /\p{Cc}|\p{Cf}|\p{Cs}|\p{Co}|\p{Cn}/u.test(text);
}

function labelled(haystack: string, alias: string): boolean {
  const normalized = normalizeToken(alias);
  if (normalized.length === 0) return false;
  return haystack.includes(` ${normalized} `);
}

/** 派生 notation：仅看完整配对定界符，未知不猜；`[...]` 合法保留。 */
export function deriveNotation(rawIpa: string): Notation {
  const normalized = canonicalizeIpaForComparison(rawIpa);
  if (normalized.length >= 2 && normalized.startsWith('/') && normalized.endsWith('/')) {
    return 'phonemic';
  }
  if (normalized.length >= 2 && normalized.startsWith('[') && normalized.endsWith(']')) {
    return 'phonetic';
  }
  return 'unknown';
}

const NON_COMPLETE_DECLARED: ReadonlySet<Completeness> = new Set([
  'fragment',
  'empty',
  'broken-delimiter',
  'control-character',
  'truncated',
]);

/**
 * 派生 completeness：空 / 控制字符（raw 与解码后均查） / 截断 / 坏定界 / 片段 / 完整。
 * 不因出现闭定界符就宣称完整；`/x]/`、`/x/ /y/`、`/ /` 均非 complete。
 * 上游已声明 fragment/control/broken/empty/truncated 时**不得**凭外形升级为 complete；
 * 只有声明为 complete 而外形不成立时才降级。修正不一致需显式核验，不自动认证。
 */
export function deriveCompleteness(rawIpa: string, declared?: Completeness): Completeness {
  const normalized = canonicalizeIpaForComparison(rawIpa);
  const derived = deriveCompletenessStrict(rawIpa, normalized);
  if (declared !== undefined && NON_COMPLETE_DECLARED.has(declared)) {
    return declared;
  }
  return derived;
}

function deriveCompletenessStrict(rawIpa: string, normalized: string): Completeness {
  if (hasControlCategory(rawIpa) || hasControlCategory(normalized)) return 'control-character';
  if (normalized.length === 0) return 'empty';
  const notation = deriveNotation(rawIpa);
  if (notation === 'unknown') return 'broken-delimiter';
  const inner = normalized.slice(1, -1);
  if (inner.trim().length === 0) return 'fragment';
  if (/[/[\]]/u.test(inner)) return 'fragment';
  return 'complete';
}

// ---------------------------------------------------------------------------
// 标签扫描（整段解析：识别跨度 + 剩余限制）
// ---------------------------------------------------------------------------

interface LabelScan {
  readonly standardCanonicals: string[];
  readonly regions: string[];
  readonly usage: UsageStatus[];
  readonly hasUk: boolean;
  readonly hasUs: boolean;
  readonly hasRegionalUnspecified: boolean;
  readonly rawMatched: string[];
  readonly unclassified: string[];
  readonly nonRestrictive: string[];
  readonly restrictive: string[];
}

type ExactLabel =
  | { readonly kind: 'standard'; readonly value: string }
  | { readonly kind: 'region'; readonly value: string }
  | { readonly kind: 'uk'; readonly value: string }
  | { readonly kind: 'us'; readonly value: string }
  | { readonly kind: 'regional-unspecified'; readonly value: string }
  | { readonly kind: 'usage'; readonly value: UsageStatus };

const EXACT_TAG_INDEX: ReadonlyMap<string, ExactLabel> = buildExactTagIndex();

function buildExactTagIndex(): Map<string, ExactLabel> {
  const index = new Map<string, ExactLabel>();
  for (const rule of STANDARD_ACCENT_RULES) {
    for (const alias of rule.aliases) index.set(normalizeToken(alias), { kind: 'standard', value: rule.canonical });
  }
  for (const [alias, label] of REGION_ALIASES) index.set(normalizeToken(alias), { kind: 'region', value: label });
  for (const alias of UK_UNSPECIFIED_ALIASES) index.set(normalizeToken(alias), { kind: 'uk', value: 'UK' });
  for (const alias of US_UNSPECIFIED_ALIASES) index.set(normalizeToken(alias), { kind: 'us', value: 'US' });
  for (const alias of REGIONAL_UNSPECIFIED_ALIASES) {
    index.set(normalizeToken(alias), { kind: 'regional-unspecified', value: '地域未细分' });
  }
  for (const [alias, status] of USAGE_ALIASES) index.set(normalizeToken(alias), { kind: 'usage', value: status });
  return index;
}

function scanLabels(
  rawTags: readonly string[],
  rawQualifiers: readonly string[],
  scopeAccentLabels: readonly string[] = [],
): LabelScan {
  const standardCanonicals: string[] = [];
  const regions: string[] = [];
  const usage: UsageStatus[] = [];
  const rawMatched: string[] = [];
  const unclassified: string[] = [];
  const nonRestrictive: string[] = [];
  const restrictive: string[] = [];
  let hasUk = false;
  let hasUs = false;
  let hasRegionalUnspecified = false;

  const recordExact = (label: ExactLabel, raw: string): void => {
    switch (label.kind) {
      case 'standard':
        if (!standardCanonicals.includes(label.value)) standardCanonicals.push(label.value);
        break;
      case 'region':
        if (!regions.includes(label.value)) regions.push(label.value);
        break;
      case 'uk':
        hasUk = true;
        break;
      case 'us':
        hasUs = true;
        break;
      case 'regional-unspecified':
        hasRegionalUnspecified = true;
        break;
      case 'usage':
        if (!usage.includes(label.value)) usage.push(label.value);
        break;
    }
    rawMatched.push(raw);
  };

  const unknownSeen = new Set<string>();
  const recordUnknownToken = (token: string, raw: string = token): void => {
    const key = normalizeToken(token);
    if (key.length === 0 || isLayoutToken(token)) return;
    if (unknownSeen.has(key)) return;
    unknownSeen.add(key);
    unclassified.push(raw);
    if (NON_RESTRICTIVE_TAG_RULES.has(key)) nonRestrictive.push(raw);
    else restrictive.push(raw);
  };

  const cleanQualifierToken = (token: string): string =>
    token.replace(/^[()[\],;·\s]+/u, '').replace(/[()[\],;·\s]+$/u, '');

  const processSegment = (segment: string): void => {
    const exact = EXACT_TAG_INDEX.get(normalizeToken(segment));
    if (exact !== undefined) {
      recordExact(exact, segment);
      return;
    }
    // 整段内扫描已识别跨度，余下 token 记为未知（不被已识别跨度掩掉）。
    let work = ` ${normalizeToken(segment)} `;
    const matchedAliases: string[] = [];
    const apply = (alias: string, label: ExactLabel): void => {
      if (!labelled(work, alias)) return;
      matchedAliases.push(alias);
      recordExact(label, segment);
      work = work.split(` ${normalizeToken(alias)} `).join(' ');
    };
    for (const rule of STANDARD_ACCENT_RULES) {
      for (const alias of rule.aliases) apply(alias, { kind: 'standard', value: rule.canonical });
    }
    for (const [alias, regionLabel] of REGION_ALIASES) apply(alias, { kind: 'region', value: regionLabel });
    for (const alias of UK_UNSPECIFIED_ALIASES) apply(alias, { kind: 'uk', value: 'UK' });
    for (const alias of US_UNSPECIFIED_ALIASES) apply(alias, { kind: 'us', value: 'US' });
    for (const alias of REGIONAL_UNSPECIFIED_ALIASES) {
      apply(alias, { kind: 'regional-unspecified', value: '地域未细分' });
    }
    for (const [alias, status] of USAGE_ALIASES) apply(alias, { kind: 'usage', value: status });

    const leftovers = work
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (matchedAliases.length === 0) {
      recordUnknownToken(segment, cleanQualifierToken(segment));
    } else {
      for (const leftover of leftovers) {
        recordUnknownToken(leftover, cleanQualifierToken(leftover));
      }
    }
  };

  for (const tag of rawTags) {
    const exact = EXACT_TAG_INDEX.get(normalizeToken(tag));
    if (exact !== undefined) {
      recordExact(exact, tag);
      continue;
    }
    recordUnknownToken(tag);
  }

  const splitSegments = (value: string): string[] =>
    decodeHtmlEntities(value)
      .split(/[,;·/]+/u)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

  for (const qualifier of rawQualifiers) {
    for (const segment of splitSegments(qualifier)) processSegment(segment);
  }
  // scope accent known 值同样做整段解析（含 leftovers），不得因命中 GA 掩掉未知限制。
  for (const label of scopeAccentLabels) {
    for (const segment of splitSegments(label)) processSegment(segment);
  }

  usage.sort();
  return {
    standardCanonicals,
    regions,
    usage,
    hasUk,
    hasUs,
    hasRegionalUnspecified,
    rawMatched,
    unclassified,
    nonRestrictive,
    restrictive,
  };
}

// ---------------------------------------------------------------------------
// 分类结果
// ---------------------------------------------------------------------------

export interface AccentClassification {
  readonly family: AccentClass;
  /** 保留的具体名称（如 RP / SSB / GA / UK / Scotland / 地域未细分 / 未注明口音）。 */
  readonly label: string;
  /** 同口音分组键；不同标准名称不合并（RP≠SSB）；冲突时用组合键。 */
  readonly canonicalName: string;
  readonly region: string | null;
  readonly unspecified: boolean;
  /** 参与分类的原始标签/限定（保原样，不 trim）。 */
  readonly rawLabels: readonly string[];
  readonly unknownReason?: string;
}

export interface UnknownRestriction {
  readonly tag: string;
  readonly reason: string;
}

export interface ScopeEligibility {
  readonly eligible: boolean;
  readonly unresolvedReasons: readonly string[];
  readonly invalidReasons: readonly string[];
}

export type Qualification = 'qualified' | 'insufficient' | 'restricted';

export interface Classification {
  readonly ruleVersion: string;
  readonly notation: Notation;
  readonly notationConflict: boolean;
  readonly completeness: Completeness;
  readonly declaredCompleteness: Completeness | null;
  readonly preserved: {
    readonly rawIpa: string;
    readonly normalizedIpa: string;
    readonly rawTags: readonly string[];
    readonly rawQualifiers: readonly string[];
    readonly structuralPath: readonly string[];
  };
  readonly accent: AccentClassification;
  readonly usage: readonly UsageStatus[];
  readonly unclassifiedTags: readonly string[];
  readonly unknownRestrictions: readonly UnknownRestriction[];
  readonly qualification: Qualification;
  readonly scopeEligibility: ScopeEligibility;
  readonly reasons: readonly string[];
}

export interface ClassificationOptions {
  /** 追加要求的 scope 维度（不能缩减默认必需集）。 */
  readonly requiredScopeDimensions?: readonly ScopeDimension[];
  /**
   * 已确认的 scope 维度。**不会**把 unknown 变 known/explicit-all（无证据不得放开）；
   * 仅作为调用方声明，最终仍以 scope 三态为准。
   */
  readonly confirmedScopeDimensions?: readonly ScopeDimension[];
}

// ---------------------------------------------------------------------------
// accent 派生
// ---------------------------------------------------------------------------

function deriveAccent(scan: LabelScan): AccentClassification {
  const base = { rawLabels: scan.rawMatched };
  const conflict = (label: string, canonicalName: string, reason: string): AccentClassification => ({
    family: 'unknown',
    label,
    canonicalName,
    region: null,
    unspecified: false,
    unknownReason: reason,
    ...base,
  });

  if (scan.regions.length > 0 || scan.hasRegionalUnspecified) {
    const regionLabel = scan.regions.length > 0 ? scan.regions.join('+') : '地域未细分';
    const canonicalName = scan.regions.length > 0 ? scan.regions.join('+') : 'regional-unspecified';
    if (scan.standardCanonicals.length > 0) {
      // 标准通用口音 + 地域限定冲突：不得冒充通用，也不得丢标签。
      const label = [...scan.standardCanonicals, regionLabel].join('+');
      return conflict(label, label, 'conflicting-standard-region');
    }
    return {
      family: 'regional',
      label: regionLabel,
      canonicalName,
      region: scan.regions.length > 0 ? scan.regions[0] ?? null : null,
      unspecified: false,
      ...base,
    };
  }
  if (scan.standardCanonicals.length > 1) {
    // 多个标准名（RP/GA）不得合并为一个 general；保留全部并按 unresolved 处理。
    const label = scan.standardCanonicals.join('+');
    return conflict(label, label, 'multiple-standard-accents');
  }
  if (scan.standardCanonicals.length === 1) {
    const name = scan.standardCanonicals[0] ?? '';
    return { family: 'standard', label: name, canonicalName: name, region: null, unspecified: false, ...base };
  }
  if (scan.hasUk && scan.hasUs) {
    return conflict('未知口音', 'ambiguous-uk-us', 'ambiguous-uk-us');
  }
  if (scan.hasUk) {
    return { family: 'uk-unspecified', label: 'UK', canonicalName: 'UK', region: null, unspecified: false, ...base };
  }
  if (scan.hasUs) {
    return { family: 'us-unspecified', label: 'US', canonicalName: 'US', region: null, unspecified: false, ...base };
  }
  return {
    family: 'unspecified',
    label: '未注明口音',
    canonicalName: 'unspecified',
    region: null,
    unspecified: true,
    ...base,
  };
}

// ---------------------------------------------------------------------------
// scope 规范化（不丢维度；身份值精确）
// ---------------------------------------------------------------------------

function isStrictScopeConstraint(value: unknown): value is ScopeConstraint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (kind === 'known') {
    const values = record['values'];
    return (
      Array.isArray(values) &&
      values.length > 0 &&
      values.every((item) => typeof item === 'string' && item.length > 0)
    );
  }
  if (kind === 'explicit-all') {
    const evidence = record['evidence'];
    return (
      Array.isArray(evidence) &&
      evidence.length > 0 &&
      evidence.every((item) => typeof item === 'string' && item.length > 0)
    );
  }
  if (kind === 'unknown') {
    const reason = record['reason'];
    return typeof reason === 'string' && reason.length > 0;
  }
  return false;
}

export function canonicalScope(scope: ApplicabilityScope | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const dimension of ALL_SCOPE_DIMENSIONS) {
    const constraint = scope?.[dimension];
    if (!isStrictScopeConstraint(constraint)) {
      result[dimension] = { invalid: true };
      continue;
    }
    if (constraint.kind === 'known') {
      result[dimension] = {
        kind: 'known',
        values: [...constraint.values].map((value) => compareNormalize(value)).sort(),
      };
    } else if (constraint.kind === 'explicit-all') {
      result[dimension] = {
        kind: 'explicit-all',
        evidence: [...constraint.evidence].map((value) => compareNormalize(value)).sort(),
      };
    } else {
      result[dimension] = { kind: 'unknown', reason: compareNormalize(constraint.reason) };
    }
  }
  return result;
}

/** 语义 scope：**不丢任何维度**（8 维全包含，含 unknown 状态与 other 限制）。 */
export function semanticScope(scope: ApplicabilityScope | undefined): Record<string, unknown> {
  return canonicalScope(scope);
}

/**
 * 指纹用 scope：保留每维 **kind 状态**与 known 取值，但**不纳** unknown 的 reason 措辞、
 * 不纳 explicit-all 的 evidence 引用（它们是非范围实质变的描述/证据标识）。
 * 因此未知状态↔已知、known 取值变化、other 限制状态变化都会触发，而措辞/引用变化不会。
 */
export function fingerprintScope(scope: ApplicabilityScope | undefined): Record<string, unknown> {
  const canonical = canonicalScope(scope);
  const result: Record<string, unknown> = {};
  for (const dimension of ALL_SCOPE_DIMENSIONS) {
    const constraint = canonical[dimension];
    if (typeof constraint !== 'object' || constraint === null) {
      result[dimension] = constraint;
      continue;
    }
    const record = constraint as Record<string, unknown>;
    if (record['kind'] === 'known') {
      result[dimension] = { kind: 'known', values: record['values'] };
    } else if (record['kind'] === 'explicit-all') {
      result[dimension] = { kind: 'explicit-all' };
    } else if (record['kind'] === 'unknown') {
      result[dimension] = { kind: 'unknown' };
    } else {
      result[dimension] = constraint;
    }
  }
  return result;
}

function identityScope(scope: ApplicabilityScope | undefined): Record<string, unknown> {
  const canonical = canonicalScope(scope);
  const identity: Record<string, unknown> = {};
  for (const dimension of ['language', 'entry', 'lexeme', 'role', 'pos', 'sense'] as const) {
    identity[dimension] = canonical[dimension];
  }
  return identity;
}

function evaluateScope(
  scope: ApplicabilityScope,
  accent: AccentClassification,
  options: ClassificationOptions,
): ScopeEligibility {
  const invalidReasons: string[] = [];
  const unresolvedReasons: string[] = [];
  for (const dimension of ALL_SCOPE_DIMENSIONS) {
    if (!isStrictScopeConstraint(scope[dimension])) invalidReasons.push(`scope-invalid:${dimension}`);
  }
  const required = new Set<ScopeDimension>(DEFAULT_REQUIRED_SCOPE_DIMENSIONS);
  for (const dimension of options.requiredScopeDimensions ?? []) required.add(dimension);
  // confirmedScopeDimensions 不会把 unknown 放开；只有真正 known/explicit-all 才算已解析。
  for (const dimension of required) {
    const constraint = scope[dimension];
    if (!isStrictScopeConstraint(constraint)) continue;
    if (constraint.kind === 'unknown') unresolvedReasons.push(`scope-unresolved:${dimension}`);
  }
  const accentConstraint = scope.accent;
  if (isStrictScopeConstraint(accentConstraint) && accentConstraint.kind === 'unknown' && accent.family === 'unknown') {
    unresolvedReasons.push('scope-unresolved:accent');
  }
  return {
    eligible: invalidReasons.length === 0 && unresolvedReasons.length === 0,
    unresolvedReasons,
    invalidReasons,
  };
}

// ---------------------------------------------------------------------------
// 分类实现
// ---------------------------------------------------------------------------

export function classifyObservation(
  observation: PronunciationObservation,
  options: ClassificationOptions = {},
): Classification {
  const rawTags = [...observation.rawTags];
  const rawQualifiers = [...observation.rawQualifiers];
  const declaredNotation = observation.notation;
  const derivedNotation = deriveNotation(observation.rawIpa);
  // unknown notation 不得猜测；声明与 raw 冲突不得 upgrade。
  let notation: Notation;
  let notationConflict = false;
  if (declaredNotation === 'unknown') {
    notation = 'unknown';
  } else if (derivedNotation === 'unknown') {
    notation = 'unknown';
    notationConflict = true;
  } else if (declaredNotation !== derivedNotation) {
    notation = derivedNotation;
    notationConflict = true;
  } else {
    notation = derivedNotation;
  }
  const declared = observation.completeness;
  const completeness = deriveCompleteness(observation.rawIpa, declared);

  const scopeAccentLabels: string[] = [];
  const accentConstraint = observation.applicability.accent;
  if (isStrictScopeConstraint(accentConstraint) && accentConstraint.kind === 'known') {
    for (const value of accentConstraint.values) scopeAccentLabels.push(value);
  }
  const scan = scanLabels(rawTags, rawQualifiers, scopeAccentLabels);
  const accent = deriveAccent(scan);
  const scopeEligibility = evaluateScope(observation.applicability, accent, options);

  const unknownRestrictions: UnknownRestriction[] = scan.restrictive.map((tag) => ({
    tag,
    reason: OTHER_RESTRICTION_TOKENS.has(normalizeToken(tag))
      ? 'known-restriction-label-pending-semantics'
      : 'unclassified-possible-restriction',
  }));

  const reasons: string[] = [];
  if (declared !== completeness) {
    reasons.push(`completeness-declared-preserved:${declared}`);
  }
  if (declaredNotation === 'unknown') reasons.push('notation-declared-unknown');
  if (notationConflict) reasons.push('notation-declared-conflict');
  if (scan.nonRestrictive.length > 0) reasons.push('non-restrictive-unknown-preserved');
  for (const restriction of unknownRestrictions) reasons.push(`unknown:${restriction.reason}`);

  let qualification: Qualification;
  if (completeness !== 'complete' || notation === 'unknown') {
    qualification = 'insufficient';
  } else if (unknownRestrictions.length > 0) {
    qualification = 'restricted';
  } else {
    qualification = 'qualified';
  }

  return {
    ruleVersion: CLASSIFICATION_RULE_VERSION,
    notation,
    notationConflict,
    completeness,
    declaredCompleteness: declared,
    preserved: {
      rawIpa: observation.rawIpa,
      normalizedIpa: observation.normalizedIpa,
      rawTags,
      rawQualifiers,
      structuralPath: [...observation.structuralPath],
    },
    accent,
    usage: scan.usage,
    unclassifiedTags: [...scan.unclassified],
    unknownRestrictions,
    qualification,
    scopeEligibility,
    reasons,
  };
}

export interface ClassifiedObservation {
  readonly index: number;
  readonly observation: PronunciationObservation;
  readonly classification: Classification;
  readonly disposition: ReadingDisposition;
  readonly admitted: true;
}

export function disposeObservation(
  observation: PronunciationObservation,
  options: ClassificationOptions = {},
): ClassifiedObservation {
  const classification = classifyObservation(observation, options);
  let disposition: ReadingDisposition;
  if (classification.completeness !== 'complete' || classification.notation === 'unknown') {
    disposition = 'evidence-only';
  } else if (classification.notationConflict) {
    // 声明 notation 与 raw 冲突：不得 upgrade 为 default。
    disposition = 'unresolved';
  } else if (classification.usage.some((status) => status === 'archaic' || status === 'obsolete')) {
    disposition = 'supplemental';
  } else if (classification.unknownRestrictions.length > 0) {
    disposition = 'unresolved';
  } else if (!classification.scopeEligibility.eligible) {
    disposition = 'unresolved';
  } else if (classification.accent.family === 'unknown') {
    disposition = 'unresolved';
  } else {
    disposition = 'default';
  }
  return { index: -1, observation, classification, disposition, admitted: true };
}

// ---------------------------------------------------------------------------
// 安全去重
// ---------------------------------------------------------------------------

export interface DedupGroup {
  readonly key: string;
  readonly indices: readonly number[];
  readonly observation: PronunciationObservation;
  readonly classification: Classification;
  /** 若 normalizedIpa 与 rawIpa 不一致（stale），不参与合并。 */
  readonly stale: boolean;
}

/**
 * 真重复键：同证据 + **完整 scope（8 维，身份值精确）** + notation + completeness +
 * accent/usage/unknown 语义限制 + raw 派生的 normalized IPA。
 * 跨 evidence / role / accent / completeness 不合并；stale 归一不跨真实 IPA 合并。
 */
export function safeDedupKey(observation: PronunciationObservation): string {
  const classification = classifyObservation(observation);
  const rawDerived = canonicalizeIpaForComparison(observation.rawIpa);
  const normalizedGiven = canonicalizeIpaForComparison(observation.normalizedIpa);
  const stale = observation.normalizedIpa.length > 0 && normalizedGiven !== rawDerived;
  return fingerprintJson({
    evidenceId: observation.evidenceId,
    scope: canonicalScope(observation.applicability),
    notation: classification.notation,
    completeness: classification.completeness,
    accent: {
      family: classification.accent.family,
      canonicalName: classification.accent.canonicalName,
      region: classification.accent.region,
      unspecified: classification.accent.unspecified,
    },
    usage: classification.usage,
    unclassifiedTags: classification.unclassifiedTags.map((tag) => compareNormalize(tag)).sort(),
    unknownRestrictions: classification.unknownRestrictions.map((item) => compareNormalize(item.tag)).sort(),
    ipa: rawDerived,
    // stale 时用 observationId 强制唯一，避免拿 stale 归一跨真实 IPA 合并。
    staleId: stale ? observation.observationId : undefined,
  });
}

export function safeDedup(observations: readonly PronunciationObservation[]): DedupGroup[] {
  const groups = new Map<string, { indices: number[]; observation: PronunciationObservation; classification: Classification; stale: boolean }>();
  const order: string[] = [];
  observations.forEach((observation, index) => {
    const key = safeDedupKey(observation);
    const existing = groups.get(key);
    if (existing) {
      existing.indices.push(index);
      return;
    }
    const rawDerived = canonicalizeIpaForComparison(observation.rawIpa);
    const normalizedGiven = canonicalizeIpaForComparison(observation.normalizedIpa);
    groups.set(key, {
      indices: [index],
      observation,
      classification: classifyObservation(observation),
      stale: observation.normalizedIpa.length > 0 && normalizedGiven !== rawDerived,
    });
    order.push(key);
  });
  return order.map((key) => {
    const entry = groups.get(key);
    if (entry === undefined) throw new Error('unreachable');
    return {
      key,
      indices: entry.indices,
      observation: entry.observation,
      classification: entry.classification,
      stale: entry.stale,
    };
  });
}

// ---------------------------------------------------------------------------
// 排序 / 处置计划
// ---------------------------------------------------------------------------

export interface PlannedReading {
  readonly group: string;
  readonly identity: string;
  readonly indices: readonly number[];
  readonly observations: readonly PronunciationObservation[];
  /** 与 observations 一一对应的逐条分类（不丢 per-observation metadata）。 */
  readonly classifications: readonly Classification[];
  readonly accent: AccentClassification;
  readonly disposition: ReadingDisposition;
  readonly reasons: readonly string[];
}

export interface ReadingPlan {
  readonly ruleVersion: string;
  readonly defaults: readonly PlannedReading[];
  readonly supplementals: readonly PlannedReading[];
  readonly evidenceOnly: readonly PlannedReading[];
  readonly unresolved: readonly PlannedReading[];
  readonly explanations: readonly string[];
}

function requiredAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`index out of range: ${String(index)}`);
  return value;
}

const FAMILY_RANK: Readonly<Record<AccentClass, number>> = {
  standard: 0,
  'uk-unspecified': 1,
  'us-unspecified': 1,
  unspecified: 2,
  regional: 3,
  unknown: 4,
};

function planGroupKey(observation: PronunciationObservation, classification: Classification): string {
  return fingerprintJson({
    family: classification.accent.family,
    canonicalName: classification.accent.canonicalName,
    region: classification.accent.region,
    scope: canonicalScope(observation.applicability),
  });
}

export function buildReadingPlan(
  observations: readonly PronunciationObservation[],
  options: ClassificationOptions = {},
): ReadingPlan {
  const classified: ClassifiedObservation[] = observations.map((observation, index) => {
    const disposed = disposeObservation(observation, options);
    // 保留原始 input index（勿被 disposeObservation 的 -1 覆盖）。
    return { ...disposed, index };
  });

  const makeReading = (
    entry: ClassifiedObservation,
    disposition: ReadingDisposition,
    extraReasons: string[] = [],
  ): PlannedReading => ({
    group: planGroupKey(entry.observation, entry.classification),
    identity: fingerprintJson(identityScope(entry.observation.applicability)),
    indices: [entry.index],
    observations: [entry.observation],
    classifications: [entry.classification],
    accent: entry.classification.accent,
    disposition,
    reasons: [...entry.classification.reasons, ...extraReasons],
  });

  const evidenceOnly: PlannedReading[] = [];
  const unresolved: PlannedReading[] = [];
  const historical: PlannedReading[] = [];
  const eligible: ClassifiedObservation[] = [];

  for (const entry of classified) {
    if (entry.disposition === 'evidence-only') evidenceOnly.push(makeReading(entry, 'evidence-only'));
    else if (entry.disposition === 'supplemental') historical.push(makeReading(entry, 'supplemental'));
    else if (entry.disposition === 'unresolved') unresolved.push(makeReading(entry, 'unresolved'));
    else eligible.push(entry);
  }

  // 按 groupKey 分组 eligible（同 group = 同 derived accent + 同完整 scope）。
  interface Bucket {
    key: string;
    identity: string;
    accent: AccentClassification;
    indices: number[];
    observations: PronunciationObservation[];
    classifications: Classification[];
  }
  const buckets = new Map<string, Bucket>();
  const bucketOrder: string[] = [];
  for (const entry of eligible) {
    const key = planGroupKey(entry.observation, entry.classification);
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        key,
        identity: fingerprintJson(identityScope(entry.observation.applicability)),
        accent: entry.classification.accent,
        indices: [],
        observations: [],
        classifications: [],
      };
      buckets.set(key, bucket);
      bucketOrder.push(key);
    }
    bucket.indices.push(entry.index);
    bucket.observations.push(entry.observation);
    bucket.classifications.push(entry.classification);
  }
  const groupBuckets = bucketOrder
    .map((key) => buckets.get(key))
    .filter((bucket): bucket is Bucket => bucket !== undefined);

  groupBuckets.sort((left, right) => {
    const leftRank = FAMILY_RANK[left.accent.family];
    const rightRank = FAMILY_RANK[right.accent.family];
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.key.localeCompare(right.key);
  });

  // 仅同 identity（entry/lexeme/role/pos/sense/language）内比较 general，避免他词影响。
  const identitiesWithGeneral = new Set<string>();
  for (const bucket of groupBuckets) {
    if (bucket.accent.family !== 'regional') identitiesWithGeneral.add(bucket.identity);
  }

  const defaults: PlannedReading[] = [];
  const supplementals: PlannedReading[] = [...historical];
  const explanations: string[] = [];

  for (const bucket of groupBuckets) {
    const isRegional = bucket.accent.family === 'regional';
    if (isRegional && identitiesWithGeneral.has(bucket.identity)) {
      supplementals.push({
        group: bucket.key,
        identity: bucket.identity,
        indices: bucket.indices,
        observations: bucket.observations,
        classifications: bucket.classifications,
        accent: bucket.accent,
        disposition: 'supplemental',
        reasons: ['regional-supplemental:general-exists-in-identity'],
      });
      explanations.push(`regional-supplemental:${bucket.accent.label}`);
      continue;
    }
    // 仅“确定 accent + 完全相同 scope”才 phonemic 优先 phonetic；unspecified 不得冒充。
    const determinedAccent = bucket.accent.family !== 'unspecified' && bucket.accent.family !== 'unknown';
    const phonemicIndices: number[] = [];
    const phoneticIndices: number[] = [];
    bucket.classifications.forEach((classification, position) => {
      if (classification.notation === 'phonemic') phonemicIndices.push(position);
      else if (classification.notation === 'phonetic') phoneticIndices.push(position);
    });
    const planned = (
      positions: number[],
      disposition: ReadingDisposition,
      reasons: string[],
    ): PlannedReading => ({
      group: bucket.key,
      identity: bucket.identity,
      indices: positions.map((position) => requiredAt(bucket.indices, position)),
      observations: positions.map((position) => requiredAt(bucket.observations, position)),
      classifications: positions.map((position) => requiredAt(bucket.classifications, position)),
      accent: bucket.accent,
      disposition,
      reasons,
    });

    if (determinedAccent && phonemicIndices.length > 0) {
      defaults.push(planned(phonemicIndices, 'default', ['phonemic-preferred']));
      if (phoneticIndices.length > 0) {
        supplementals.push(planned(phoneticIndices, 'supplemental', ['phonetic-supplemental-of-phonemic']));
        explanations.push(`phonetic-supplemental:${bucket.accent.label}`);
      }
    } else {
      // unspecified/unknown accent：不假装“相同已确定口音”，两种 notation 各自保留完整。
      if (phonemicIndices.length > 0) {
        defaults.push(planned(phonemicIndices, 'default', ['phonemic-default-not-determinable-accent']));
      }
      if (phoneticIndices.length > 0) {
        defaults.push(planned(phoneticIndices, 'default', ['phonetic-default-not-determinable-accent']));
        explanations.push(`phonetic-default-only:${bucket.accent.label}`);
      }
    }
  }

  if (isRegionalOnlyDefaultNeeded(groupBuckets, identitiesWithGeneral)) {
    explanations.push('regional-only-default-allowed');
  }

  return {
    ruleVersion: CLASSIFICATION_RULE_VERSION,
    defaults,
    supplementals,
    evidenceOnly,
    unresolved,
    explanations,
  };
}

function isRegionalOnlyDefaultNeeded(
  buckets: readonly { identity: string; accent: AccentClassification }[],
  identitiesWithGeneral: ReadonlySet<string>,
): boolean {
  const identities = new Set(buckets.map((bucket) => bucket.identity));
  for (const identity of identities) {
    if (!identitiesWithGeneral.has(identity)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 语义指纹（正确的统一 API；不改合同旧 API）
// ---------------------------------------------------------------------------

/**
 * 语义指纹：覆盖全部 8 维 scope（含 unknown 状态与 other 限制）、比较用 normalized IPA
 * （由 raw 派生，避免 stale）、notation、completeness、accent、usage、unknown 限制。
 * **不含** layout class / 结构路径 / 全部 rawTags；因此 layout 变化不触发，而
 * IPA/accent/scope/usage/unknown 限制变化触发。比较前实体 + NFC + 边界 trim，原值不动。
 */
export function computeSemanticFingerprint(observation: PronunciationObservation): string {
  const classification = classifyObservation(observation);
  return fingerprintJson({
    ruleVersion: CLASSIFICATION_RULE_VERSION,
    ipa: canonicalizeIpaForComparison(observation.rawIpa),
    notation: classification.notation,
    completeness: classification.completeness,
    accent: {
      family: classification.accent.family,
      canonicalName: classification.accent.canonicalName,
      region: classification.accent.region,
      unspecified: classification.accent.unspecified,
    },
    usage: classification.usage,
    unclassifiedTags: classification.unclassifiedTags.map((tag) => compareNormalize(tag)).sort(),
    unknownRestrictions: classification.unknownRestrictions.map((item) => compareNormalize(item.tag)).sort(),
    scope: fingerprintScope(observation.applicability),
  });
}
