/**
 * 人工复核纯函数（OpenSpec change `correct-dictionary-pronunciations` task 3.4）。
 *
 * 复核状态与有效性分离：到期或相关上游变化只把状态改为**待复核/到期**，
 * **不降优先级、不撤销、不 fallback、不自动替代**。撤销/替代必须由调用方提供
 * 明确确认与审计输入；到期本身绝不构成撤销依据。
 *
 * 时间规则（UTC 日历月，月末裁剪）：
 * - 基准时间 = `lastVerifiedAt`（若有）否则 `createdAt`；
 * - 复核到期 = 基准时间 + 6 个日历月（UTC），目标月无对应日时落在当月最后一天；
 * - 两者皆缺失时**不伪填今天**：返回未知基准、保留有效并待复核。
 *
 * 事件独立：创建 / 明确核验 / 采集 / 导入 / 渲染 / 批次批准是彼此独立的事件。
 * **只有明确逐项核验**会更新 `lastVerifiedAt` 并按新基准重算到期；其余事件不刷新人工核验时间。
 *
 * 语义变化比较：
 * - 关联由调用方给出的**明确稳定 `associationKey`**（页面/条目标识等，非 revid/时间/hash）判定：
 *   同关联即使 `evidenceId` 因新 render 而变，也比对注入的规范化指纹/实质 scope；
 *   明确不同关联可不触发；缺关联键时**不凭新 evidenceId 判无关**，保守 `unknown` 提示且不降级；
 * - **刻意忽略**无关页面文本、提取/渲染时间戳与 `revid` 内容 hash；
 * - 现有 `contracts.computeObservationFingerprint` 会把排版 tags 全量纳入 hash 且未规范
 *   `rawQualifiers`，直接使用会因无关排版变化误触发，因此本 lane **不调用它**，
 *   而由调用方**注入**后续正式 classifier lane 的规范化语义指纹（责任明确）。
 *   `RelatedSemanticSnapshot` 只读取注入语义字段，其余无关字段一概不读，从而实现隔离。
 *
 * 撤销/替代/明确核验均返回可持久化的结构化审计记录；确认严格要求 `confirmed === true`、
 * 非空且 trim 后有效的 actor/reason/auditRef 与合法 UTC 时间。
 *
 * 本模块为纯函数，不联网、不写正式结果、不写 resolver（逐字段优先级解析属后续 3.3）。
 */

import type {
  ApplicabilityScope,
  PronunciationRule,
  ReviewStatus,
  ScopeConstraint,
} from './contracts';

// ---------------------------------------------------------------------------
// UTC 日历月与月末裁剪
// ---------------------------------------------------------------------------

interface ParsedUtcInstant {
  readonly year: number;
  readonly month: number; // 1-based
  readonly day: number;
  /** ISO 时间部分（`T..Z`），日期仅到天时 undefined；原样保留以不丢失时分秒。 */
  readonly time: string | undefined;
  /** 对应 UTC 毫秒数，仅用于比较。 */
  readonly epochMs: number;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function pad4(value: number): string {
  return value.toString().padStart(4, '0');
}

/**
 * 严格解析 UTC ISO 时间：只接受 `YYYY-MM-DD`（当日 UTC 零点）或
 * `YYYY-MM-DDTHH:MM:SS(.sss)?Z`。**不接受时区偏移**（如 `-05:00`）或缺失 `Z` 的本地时间，
 * 避免按原日期保留 offset 而把日历月算错；调用方应先自行归一到 UTC。
 * 校验年份 1–9999、月份 1–12、真实日、时钟 00–23:00–59:00–59。
 */
function parseUtcInstant(value: string): ParsedUtcInstant | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z)?$/.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return undefined;
  const lastDay = daysInUtcMonth(year, month - 1);
  if (day < 1 || day > lastDay) return undefined;

  if (match[4] === undefined) {
    return { year, month, day, time: undefined, epochMs: Date.UTC(year, month - 1, day) };
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const fraction = match[7] ?? '';
  const millisecond = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, '0'));
  // match[0] 已受正则约束，slice(10) 即合法 `T..Z` 后缀。
  return {
    year,
    month,
    day,
    time: match[0].slice(10),
    epochMs: Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  };
}

/** 是否为合法 UTC ISO 时间（date-only 或带 `Z`）。供确认上下文/事件时间复用。 */
export function isValidUtcInstant(value: string): boolean {
  return typeof value === 'string' && parseUtcInstant(value) !== undefined;
}

/** 合法 UTC ISO 时间的毫秒数；非法返回 undefined。 */
export function utcInstantMs(value: string): number | undefined {
  return parseUtcInstant(value)?.epochMs;
}

function daysInUtcMonth(year: number, month0: number): number {
  // Date.UTC(year, month0+1, 0) 即 month0 月的最后一天。
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * 在 UTC 上增加 N 个日历月，月末裁剪到目标月最后一天。
 * 例：2026-01-31 + 6 = 2026-07-31；2026-08-31 + 6 = 2027-02-28。
 * `months` 必须是有限整数，日期必须是合法 UTC ISO（见 `parseUtcInstant`）；
 * 否则抛 `RangeError`，绝不静默返回今天或按 offset 算错。
 */
export function addCalendarMonthsUtc(value: string, months: number): string {
  if (!Number.isInteger(months)) {
    throw new RangeError(`addCalendarMonthsUtc: months 必须是有限整数（收到 ${String(months)}）`);
  }
  const parsed = parseUtcInstant(value);
  if (parsed === undefined) {
    throw new RangeError(
      `addCalendarMonthsUtc: 非法或非 UTC 时间 ${value}（仅接受 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM:SS(.sss)?Z，不接受时区偏移）`,
    );
  }
  const absoluteMonth = parsed.month - 1 + months;
  const targetYear = parsed.year + Math.floor(absoluteMonth / 12);
  if (targetYear < 1 || targetYear > 9999) {
    throw new RangeError(`addCalendarMonthsUtc: 结果年份越界 ${String(targetYear)}`);
  }
  const targetMonth0 = ((absoluteMonth % 12) + 12) % 12;
  const lastDay = daysInUtcMonth(targetYear, targetMonth0);
  const targetDay = Math.min(parsed.day, lastDay);
  const ymd = `${pad4(targetYear)}-${pad2(targetMonth0 + 1)}-${pad2(targetDay)}`;
  return parsed.time === undefined ? ymd : `${ymd}${parsed.time}`;
}

/** 默认复核周期：六个日历月。 */
export const REVIEW_PERIOD_MONTHS = 6;

// ---------------------------------------------------------------------------
// 复核时间计算
// ---------------------------------------------------------------------------

export type ReviewBaseSource = 'lastVerifiedAt' | 'createdAt' | 'unknown';

export interface ReviewTiming {
  readonly baseAt: string | undefined;
  readonly baseSource: ReviewBaseSource;
  readonly dueAt: string | undefined;
  /** 基准未知或非法时的保守原因；此时不得伪填时间。 */
  readonly unresolvedReason: string | undefined;
}

/**
 * 依据规则计算复核基准与到期时间。
 * `lastVerifiedAt` 优先于 `createdAt`；两者皆缺失或非法时返回 unknown（待复核、仍有效）。
 */
export function computeReviewTiming(rule: PronunciationRule): ReviewTiming {
  const candidates: readonly (readonly [ReviewBaseSource, string | undefined])[] = [
    ['lastVerifiedAt', rule.lastVerifiedAt],
    ['createdAt', rule.createdAt],
  ];
  for (const [source, baseAt] of candidates) {
    if (baseAt === undefined || baseAt.length === 0) continue;
    try {
      return {
        baseAt,
        baseSource: source,
        dueAt: addCalendarMonthsUtc(baseAt, REVIEW_PERIOD_MONTHS),
        unresolvedReason: undefined,
      };
    } catch {
      return {
        baseAt: undefined,
        baseSource: 'unknown',
        dueAt: undefined,
        unresolvedReason: `${source} 非法（${baseAt}），无法计算复核期，保持有效待复核`,
      };
    }
  }
  return {
    baseAt: undefined,
    baseSource: 'unknown',
    dueAt: undefined,
    unresolvedReason:
      rule.createdAtUnknownReason ?? '缺少 createdAt / lastVerifiedAt，无法计算复核期（不伪填今天）',
  };
}

/** 仅返回到期时间（无基准时为 undefined）。 */
export function computeReviewDueAt(rule: PronunciationRule): string | undefined {
  return computeReviewTiming(rule).dueAt;
}

// ---------------------------------------------------------------------------
// 语义变化比较（注入规范化指纹，不调用 contracts 的粗糙指纹）
// ---------------------------------------------------------------------------

/**
 * 调用方注入的关联语义快照。
 *
 * 关联判定使用**明确稳定的来源关联键** `associationKey`（如页面/条目标识，或调用方明确
 * 给出的关联标识），**不用** `evidenceId` / `revid` / 时间 / hash 判定关联——新一次 render/IPA
 * 变化必然会铸造新 evidence，用 evidenceId 判「无关」会漏掉真实语义变化。
 *
 * `pageText` / `revision` / `extractedAt` / `renderedAt` 为**刻意忽略**的无关信息，
 * 仅用于证明无关页面文本、时间戳与 revid 不触发复核；`evidenceId` 亦**不参与**关联判定。
 */
export interface RelatedSemanticSnapshot {
  /**
   * 明确稳定的来源关联键（非 revid/时间/hash）。两侧同键即同一关联，即使 evidenceId 已变；
   * 任一侧缺失则关联未知，保守提示而不凭 evidenceId 判无关。
   */
  readonly associationKey?: string;
  /** 仅作信息留存，**不参与**关联判定。 */
  readonly evidenceId?: string;
  readonly applicability: ApplicabilityScope;
  /**
   * 注入的规范化 IPA 语义指纹（来自后续正式 classifier lane 的 normalized semantic API）。
   * 本 lane 不使用 `contracts.computeObservationFingerprint`，避免排版 tags/未规范 qualifier 误触。
   */
  readonly ipaSemanticFingerprint?: string;
  readonly pageText?: string;
  readonly revision?: string;
  readonly extractedAt?: string;
  readonly renderedAt?: string;
}

export interface SemanticChangeDiff {
  readonly related: boolean;
  /** 缺少规范化语义指纹时的保守标记；为真时 related 亦为真（提示复核，但不撤销/降级）。 */
  readonly unknown: boolean;
  /** 发生变化的语义维度/字段。 */
  readonly changed: readonly string[];
  readonly reason: string;
}

/**
 * 维度语义键：只表达**范围语义**。
 * - known：排序后的取值集合；
 * - explicit-all：统一作 `explicit-all`，**证据引用变化**（换了一条 all 证据）不改变「明确全范围」语义；
 * - unknown：统一作 `unknown`，**原因措辞变化**不是范围语义变化。
 * 布局/来源证据的实质变动应由注入的分类 semantic fingerprint 负责，不在此重复判断。
 */
function constraintSemanticKey(constraint: ScopeConstraint): string {
  switch (constraint.kind) {
    case 'known':
      return `known:${[...new Set(constraint.values)].sort((a, b) => a.localeCompare(b)).join('\u0001')}`;
    case 'explicit-all':
      return 'explicit-all';
    case 'unknown':
      return 'unknown';
  }
}

function scopeSemanticKey(scope: ApplicabilityScope): string {
  return (Object.keys(scope) as (keyof ApplicabilityScope)[])
    .sort()
    .map((dimension) => `${dimension}=${constraintSemanticKey(scope[dimension])}`)
    .join('\u0002');
}

/**
 * 比较两次关联语义快照。
 * 关联由**明确 `associationKey`** 判定；只读 `applicability` 与注入的 `ipaSemanticFingerprint`；
 * 无关页面文本、时间戳、revid hash 与 `evidenceId` 一律不参与。
 *
 * - 两侧关联键明确且不同 → 不同关联，不触发；
 * - 任一侧缺少关联键 → 不凭新 `evidenceId` 判无关，**保守** `unknown` 提示且不降级；
 * - 同关联即使 `evidenceId` 变（新 render/IPA）也比对规范化指纹/实质 scope。
 */
export function diffRelatedSemantics(
  previous: RelatedSemanticSnapshot,
  next: RelatedSemanticSnapshot,
): SemanticChangeDiff {
  const previousKey = previous.associationKey;
  const nextKey = next.associationKey;
  const associationKnown = previousKey !== undefined && nextKey !== undefined;

  // 明确不同关联 → 不触发（evidenceId 不用于此判定）。
  if (associationKnown && previousKey !== nextKey) {
    return {
      related: false,
      unknown: false,
      changed: [],
      reason: '关联键不同，不属于同一来源关联，不触发复核',
    };
  }

  const changed: string[] = [];
  if (scopeSemanticKey(previous.applicability) !== scopeSemanticKey(next.applicability)) {
    changed.push('applicability');
  }

  const previousFingerprint = previous.ipaSemanticFingerprint;
  const nextFingerprint = next.ipaSemanticFingerprint;
  const fingerprintsComparable =
    previousFingerprint !== undefined && nextFingerprint !== undefined;
  if (fingerprintsComparable && previousFingerprint !== nextFingerprint) {
    changed.push('ipa-semantic');
  }

  if (!associationKnown) {
    // 缺少关联键：不可凭 evidenceId 判无关，保守提示；有效状态不降级。
    return {
      related: true,
      unknown: true,
      changed: [...changed, 'association-unknown'],
      reason:
        '缺少明确来源关联键，无法判定是否同一关联；保守提示复核（不凭新 evidenceId 判无关），不撤销/替代/降级',
    };
  }

  if (!fingerprintsComparable) {
    // 关联明确但缺规范化语义指纹：保守提示，不伪装确定变化。
    return {
      related: true,
      unknown: true,
      changed: [...changed, 'ipa-semantic-unknown'],
      reason: '缺少规范化语义指纹，保守提示复核；不据此撤销、替代或降级',
    };
  }

  if (changed.length === 0) {
    return {
      related: false,
      unknown: false,
      changed: [],
      reason: '同关联的语义与范围均未变化（无关页面文本、时间戳、revid、evidenceId 不计）',
    };
  }
  return {
    related: true,
    unknown: false,
    changed,
    reason: `关联语义变化：${changed.join('、')}`,
  };
}

// ---------------------------------------------------------------------------
// 复核状态评估
// ---------------------------------------------------------------------------

export interface ReviewEvaluationContext {
  readonly now: string;
  readonly semanticChange?: SemanticChangeDiff;
}

export interface ReviewEvaluation {
  readonly reviewStatus: ReviewStatus;
  readonly dueAt: string | undefined;
  readonly baseAt: string | undefined;
  readonly baseSource: ReviewBaseSource;
  /** 到期/提醒不降优先级。 */
  readonly priorityPreserved: true;
  /** 复核评估永不自动撤销。 */
  readonly revoked: false;
  /** 复核评估永不自动替代。 */
  readonly replaced: false;
  readonly reasons: readonly string[];
}

/**
 * 评估在当前时间与（可选）关联语义变化下的复核状态。
 *
 * 关键：以规则**当前状态**为基准，只有**明确核验**才能清除 `pending-review`/`due`：
 * - 既有 `pending-review`/`due` 一律保持，采集/导入/渲染/批准与「尚未到期」都不会把它清回 `active`；
 * - 既有 `active` 才按未知基准 / 到期 / 相关变化升级；
 * - 非法 `context.now` 不字符串 fallback 伪造有效，只记理由、不改判到期；
 * - `revoked`/`replaced` 不被复核重新激活；始终保优先级、不撤销、不替代。
 */
export function evaluateReviewStatus(
  rule: PronunciationRule,
  context: ReviewEvaluationContext,
): ReviewEvaluation {
  const timing = computeReviewTiming(rule);

  if (rule.reviewStatus === 'revoked' || rule.reviewStatus === 'replaced') {
    return {
      reviewStatus: rule.reviewStatus,
      dueAt: timing.dueAt,
      baseAt: timing.baseAt,
      baseSource: timing.baseSource,
      priorityPreserved: true,
      revoked: false,
      replaced: false,
      reasons: ['规则已撤销/替代，复核评估不将其重新激活'],
    };
  }

  const reasons: string[] = [];
  let reviewStatus: ReviewStatus = rule.reviewStatus;

  if (reviewStatus === 'pending-review') {
    reasons.push('保持既有 pending-review：只有明确逐项核验才清除，普通事件与到期不清除');
  } else if (reviewStatus === 'due') {
    reasons.push('保持既有 due：不因未来到期或普通事件自动清除');
  } else {
    // active：按基准未知 / 到期升级。
    if (timing.baseSource === 'unknown') {
      reviewStatus = 'pending-review';
      reasons.push(timing.unresolvedReason ?? '基准时间未知，保持有效待复核');
    } else if (timing.dueAt !== undefined) {
      const nowMs = utcInstantMs(context.now);
      const dueMs = utcInstantMs(timing.dueAt);
      if (nowMs === undefined) {
        // 非法当前时间：不得字符串 fallback 伪造成有效到期判定。
        reasons.push('当前时间非法，未能判定到期；保持原状态，不伪有效');
      } else if (dueMs !== undefined && nowMs >= dueMs) {
        reviewStatus = 'due';
        reasons.push('UTC 六个日历月到期，标记待复核；不降级、不撤销、不 fallback');
      }
    }
  }

  const semanticChange = context.semanticChange;
  if (semanticChange?.related) {
    if (reviewStatus === 'active') reviewStatus = 'pending-review';
    reasons.push(`相关语义变化提前触发复核：${semanticChange.reason}`);
    if (semanticChange.unknown) {
      reasons.push('语义指纹/关联未知，保守提示；不据此撤销、替代或自动降级');
    }
  }

  return {
    reviewStatus,
    dueAt: timing.dueAt,
    baseAt: timing.baseAt,
    baseSource: timing.baseSource,
    priorityPreserved: true,
    revoked: false,
    replaced: false,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// 独立事件
// ---------------------------------------------------------------------------

export type ReviewEventType =
  | 'created'
  | 'explicit-verification'
  | 'collection'
  | 'import'
  | 'render'
  | 'approval';

export interface ReviewEvent {
  readonly type: ReviewEventType;
  readonly at: string;
  readonly actor?: string;
  readonly note?: string;
  /** 明确核验的审计输入引用；`explicit-verification` 必填。 */
  readonly auditRef?: string;
}

/** 可持久化的审计记录（本 lane 只返回结构，不做存储实现）。 */
export interface ReviewAuditRecord {
  readonly ruleId: string;
  readonly action: 'explicit-verification' | 'revoke' | 'replace';
  readonly actor: string;
  readonly at: string;
  readonly reason: string;
  readonly auditRef: string;
  readonly supersedingRuleId?: string;
}

export interface ReviewEventApplication {
  readonly rule: PronunciationRule;
  /** 是否实际改变了规则（只有明确核验会改变 `lastVerifiedAt`/`reviewDueAt`）。 */
  readonly applied: boolean;
  readonly reason: string;
  /** 明确核验时的可持久化审计记录。 */
  readonly audit?: ReviewAuditRecord;
}

function isNonEmptyTrimmed(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 应用一个复核相关事件。
 * 仅 `explicit-verification` 更新 `lastVerifiedAt` 并按新基准重算 `reviewDueAt`；
 * 普通批准（`approval`）**不能**冒充核验。明确核验须带合法 UTC `at` 与非空 actor/auditRef，
 * 否则拒绝。采集/导入/渲染/批准**不**刷新人工核验时间，也不伪造 `createdAt`。
 */
export function applyReviewEvent(
  rule: PronunciationRule,
  event: ReviewEvent,
): ReviewEventApplication {
  if (rule.reviewStatus === 'revoked' || rule.reviewStatus === 'replaced') {
    return {
      rule,
      applied: false,
      reason: `规则已 ${rule.reviewStatus}，事件 ${event.type} 不改变其状态`,
    };
  }

  if (event.type !== 'explicit-verification') {
    return {
      rule,
      applied: false,
      reason: `事件 ${event.type} 只描述该事件本身，不构成明确核验，不刷新 lastVerifiedAt/reviewDueAt，也不伪造 createdAt`,
    };
  }

  // 明确逐项核验的确认上下文：合法时间 + actor + auditRef，缺一不可。
  if (!isValidUtcInstant(event.at)) {
    return { rule, applied: false, reason: `核验时间 ${event.at} 非法，拒绝更新` };
  }
  if (!isNonEmptyTrimmed(event.actor) || !isNonEmptyTrimmed(event.auditRef)) {
    return { rule, applied: false, reason: '明确核验缺少 actor/auditRef 审计输入，拒绝更新' };
  }

  // 明确逐项核验：更新时间并按新基准重算；不伪造 createdAt。
  const dueAt = addCalendarMonthsUtc(event.at, REVIEW_PERIOD_MONTHS);
  const updated: PronunciationRule = {
    ...rule,
    lastVerifiedAt: event.at,
    reviewDueAt: dueAt,
    // createdAt 未知的旧规则按合同仍须保持 pending-review，不得伪填创建时间。
    reviewStatus: rule.createdAt === undefined ? 'pending-review' : 'active',
  };
  return {
    rule: updated,
    applied: true,
    reason: '明确逐项核验：更新 lastVerifiedAt 并重算复核到期',
    audit: {
      ruleId: rule.ruleId,
      action: 'explicit-verification',
      actor: event.actor.trim(),
      at: event.at,
      reason: event.note?.trim() ? event.note.trim() : '明确逐项核验',
      auditRef: event.auditRef.trim(),
    },
  };
}

// ---------------------------------------------------------------------------
// 撤销 / 替代（须明确确认 + 审计输入）
// ---------------------------------------------------------------------------

export interface ReviewConfirmation {
  readonly confirmed: boolean;
  readonly actor: string;
  readonly at: string;
  readonly reason: string;
  /** 审计输入引用；必须明确给出。 */
  readonly auditRef: string;
}

export interface ReviewMutationResult {
  readonly rule: PronunciationRule;
  readonly applied: boolean;
  readonly reason: string;
  /** 生效时的可持久化审计记录（本 lane 只返回结构）。 */
  readonly audit?: ReviewAuditRecord;
}

/**
 * 确认上下文校验：`confirmed` 必须**严格为 true**（字符串 `'false'` 不算），
 * actor/reason/auditRef 必须 trim 后非空，`at` 必须是合法 UTC instant。
 */
function hasExplicitConfirmation(
  confirmation: ReviewConfirmation | undefined,
): confirmation is ReviewConfirmation {
  if (confirmation?.confirmed !== true) return false;
  return (
    isNonEmptyTrimmed(confirmation.actor) &&
    isNonEmptyTrimmed(confirmation.reason) &&
    isNonEmptyTrimmed(confirmation.auditRef) &&
    isValidUtcInstant(confirmation.at)
  );
}

/** 撤销规则；缺少明确确认/审计输入、或规则已撤销/替代时拒绝，返回原规则。 */
export function revokeRule(
  rule: PronunciationRule,
  confirmation: ReviewConfirmation | undefined,
): ReviewMutationResult {
  if (rule.reviewStatus === 'revoked' || rule.reviewStatus === 'replaced') {
    return { rule, applied: false, reason: `规则已 ${rule.reviewStatus}，无需再次撤销` };
  }
  if (!hasExplicitConfirmation(confirmation)) {
    return {
      rule,
      applied: false,
      reason: '缺少明确确认或审计输入（confirmed 须为 true，actor/reason/auditRef 非空，at 须为合法 UTC）',
    };
  }
  return {
    rule: { ...rule, reviewStatus: 'revoked' },
    applied: true,
    reason: `已确认撤销（审计：${confirmation.auditRef}）`,
    audit: {
      ruleId: rule.ruleId,
      action: 'revoke',
      actor: confirmation.actor.trim(),
      at: confirmation.at,
      reason: confirmation.reason.trim(),
      auditRef: confirmation.auditRef.trim(),
    },
  };
}

/** 以新规则替代旧规则；缺少明确确认/审计输入或替代 ID 非法/空白/自引用时拒绝。 */
export function replaceRule(
  rule: PronunciationRule,
  supersedingRuleId: string,
  confirmation: ReviewConfirmation | undefined,
): ReviewMutationResult {
  if (rule.reviewStatus === 'revoked' || rule.reviewStatus === 'replaced') {
    return { rule, applied: false, reason: `规则已 ${rule.reviewStatus}，无需再次替代` };
  }
  if (!hasExplicitConfirmation(confirmation)) {
    return {
      rule,
      applied: false,
      reason: '缺少明确确认或审计输入（confirmed 须为 true，actor/reason/auditRef 非空，at 须为合法 UTC）',
    };
  }
  if (!isNonEmptyTrimmed(supersedingRuleId)) {
    return { rule, applied: false, reason: '替代规则 ID 非法或空白，拒绝替代' };
  }
  const targetId = supersedingRuleId.trim();
  if (targetId === rule.ruleId) {
    return { rule, applied: false, reason: '替代规则 ID 不得引用自身，拒绝替代' };
  }
  return {
    rule: { ...rule, reviewStatus: 'replaced', revokedByRuleId: targetId },
    applied: true,
    reason: `已确认替代（审计：${confirmation.auditRef}）`,
    audit: {
      ruleId: rule.ruleId,
      action: 'replace',
      actor: confirmation.actor.trim(),
      at: confirmation.at,
      reason: confirmation.reason.trim(),
      auditRef: confirmation.auditRef.trim(),
      supersedingRuleId: targetId,
    },
  };
}
