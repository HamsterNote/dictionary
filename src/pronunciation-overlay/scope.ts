/**
 * 适用范围匹配纯函数（OpenSpec change `correct-dictionary-pronunciations` task 3.1）。
 *
 * 目标：在八个维度（language / entry / lexeme / role / pos / sense / accent / other）上，
 * 对两个 `ApplicabilityScope` 给出 **可比的确定结论**，而不是用 truthy 或字符串相等冒充匹配：
 *
 * - 每个维度分别产出 `exact` / `left-subset` / `right-subset` / `overlap` / `disjoint`
 *   以及两种 `explicit-all` 覆盖关系；known 取值集合的精确信息（shared / leftOnly / rightOnly）
 *   一并暴露，供后续逐范围 resolve 使用，**不在此放大覆盖**。
 * - `unknown` **不是 wildcard**：任一方 unknown 则该维度 `unresolved`，不能据此宣称等价、覆盖或不相交。
 * - `explicit-all` 必须带证据（由既有 `validateApplicabilityScope` 保证），只是「来源明确声明全范围」
 *   的证据，**不是缺省值**，也不得由缺失字段隐式产生。
 * - 只要有任一维度**确定 disjoint**，整体即为 `disjoint`（即便其他维度 unknown）；
 *   否则若有 unresolved 则整体 `unresolved`；否则整体 `comparable`。
 * - 有交集**不等于**整 scope 等价或完整覆盖：`overlap` 只说明可比较且相交，精确覆盖判断留给后续
 *   逐范围 resolve。
 * - 匹配只依据 scope 维度本身：**不从 IPA、拼写（word）或释义（translation）推断身份或角色**，
 *   因此 `past` 与 `past-participle` 作为不同 known 取值天然 disjoint，不互相推导。
 * - **fail closed**：公开匹配 API 先用既有 validator 校验两侧范围，无效输入（空 `known.values`、
 *   空 `explicit-all.evidence`、缺维度、unknown 当全范围等）直接抛错，绝不返回 `comparable`；
 *   空 `dimensions` 抛 `RangeError`。`wholeScope` 标记是否比较了全部八维，`isExactScopeMatch`
 *   只有整 scope 全 `exact`/`all-both` 才为真，局部比较不构成等价或全覆盖。
 *
 * 本模块为纯数据 + 纯函数，不联网、不写正式结果；范围校验复用 contracts 的
 * `validateApplicabilityScope`，不重复实现校验、不修改 contracts 合同。
 */

import { SCOPE_DIMENSIONS, validateApplicabilityScope } from './contracts';
import type {
  ApplicabilityScope,
  ScopeConstraint,
  ScopeDimension,
  ValidationIssue,
  ValidationResult,
} from './contracts';

// ---------------------------------------------------------------------------
// 结果类型
// ---------------------------------------------------------------------------

/** 整体匹配结论。 */
export type ScopeMatchResult = 'comparable' | 'disjoint' | 'unresolved';

/**
 * 单维度关系：
 * - `exact`：双方 known 且取值集合完全相同；
 * - `left-subset`：left 的取值被 right 完整包含（right 更广）；
 * - `right-subset`：right 的取值被 left 完整包含（left 更广）；
 * - `overlap`：双方 known，交集非空但互不包含（可比较，但**不得**宣称等价/完整覆盖）；
 * - `disjoint`：双方 known，交集为空；
 * - `all-covers-left`：left 为 explicit-all（带证据），right 为 known；
 * - `all-covers-right`：right 为 explicit-all，left 为 known；
 * - `all-both`：双方均为 explicit-all；
 * - `unresolved`：任一方 unknown（unknown 不是通配，无法判定）。
 */
export type DimensionRelation =
  | 'exact'
  | 'left-subset'
  | 'right-subset'
  | 'overlap'
  | 'disjoint'
  | 'all-covers-left'
  | 'all-covers-right'
  | 'all-both'
  | 'unresolved';

/** 单维度匹配明细；`shared`/`leftOnly`/`rightOnly` 仅在双方 known 时有值。 */
export interface DimensionMatch {
  readonly dimension: ScopeDimension;
  readonly relation: DimensionRelation;
  readonly result: ScopeMatchResult;
  readonly reason: string;
  /** 双方 known 的交集取值（升序去重）。 */
  readonly shared: readonly string[];
  /** 只在 left 出现的取值（升序去重）。 */
  readonly leftOnly: readonly string[];
  /** 只在 right 出现的取值（升序去重）。 */
  readonly rightOnly: readonly string[];
}

/** 整体 scope 匹配结果。 */
export interface ScopeMatch {
  readonly result: ScopeMatchResult;
  readonly dimensions: readonly DimensionMatch[];
  /** 本次实际比较的维度（顺序与传入一致）。 */
  readonly comparedDimensions: readonly ScopeDimension[];
  /** 是否比较了**全部八维**；false 时结果只代表局部，不得据此宣称整 scope 等价/全覆盖。 */
  readonly wholeScope: boolean;
  /** 总体理由码（中文），便于形成冲突报告而非隐藏在格式化里。 */
  readonly reasons: readonly string[];
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function intersect(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return sortedUnique(left.filter((value) => rightSet.has(value)));
}

function difference(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return sortedUnique(left.filter((value) => !rightSet.has(value)));
}

const EMPTY_VALUES: readonly string[] = [];

/** 维度可见名（用于理由文本）。 */
function dimensionLabel(dimension: ScopeDimension): string {
  return dimension;
}

/**
 * 比较单个维度。
 * 内部约定：`unknown`（非通配）优先判为 unresolved；`explicit-all` 只在双方均 known 的
 * 集合运算之外单独判定，避免把「明确全范围」当成缺省值。
 */
function matchDimension(
  dimension: ScopeDimension,
  left: ScopeConstraint,
  right: ScopeConstraint,
): DimensionMatch {
  const base = {
    dimension,
    shared: EMPTY_VALUES,
    leftOnly: EMPTY_VALUES,
    rightOnly: EMPTY_VALUES,
  } as const;

  // unknown 不是 wildcard：无法判定，但绝不当作等价或不相交。
  if (left.kind === 'unknown' || right.kind === 'unknown') {
    const leftKind = left.kind === 'unknown' ? left.reason : left.kind;
    const rightKind = right.kind === 'unknown' ? right.reason : right.kind;
    return {
      ...base,
      relation: 'unresolved',
      result: 'unresolved',
      reason: `${dimensionLabel(dimension)}：范围未确定（left=${leftKind}，right=${rightKind}），unknown 不是通配，不判定等价或不相交`,
    };
  }

  // explicit-all：只有明确证据才表示全范围，作为关系而非缺省。
  if (left.kind === 'explicit-all' && right.kind === 'explicit-all') {
    return {
      ...base,
      relation: 'all-both',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：双方均为明确全范围（带证据），可比较但不得伪装为缺省`,
    };
  }
  if (left.kind === 'explicit-all') {
    return {
      ...base,
      relation: 'all-covers-left',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：left 明确全范围（带证据）覆盖 right known 取值`,
    };
  }
  if (right.kind === 'explicit-all') {
    return {
      ...base,
      relation: 'all-covers-right',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：right 明确全范围（带证据）覆盖 left known 取值`,
    };
  }

  const leftValues = sortedUnique(left.values);
  const rightValues = sortedUnique(right.values);
  const shared = intersect(leftValues, rightValues);
  const leftOnly = difference(leftValues, rightValues);
  const rightOnly = difference(rightValues, leftValues);
  const enriched = { ...base, shared, leftOnly, rightOnly };

  if (leftOnly.length === 0 && rightOnly.length === 0) {
    return {
      ...enriched,
      relation: 'exact',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：known 取值集合完全相同`,
    };
  }
  if (leftOnly.length === 0) {
    return {
      ...enriched,
      relation: 'left-subset',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：left 取值被 right 完整包含（right 更广）`,
    };
  }
  if (rightOnly.length === 0) {
    return {
      ...enriched,
      relation: 'right-subset',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：right 取值被 left 完整包含（left 更广）`,
    };
  }
  if (shared.length > 0) {
    return {
      ...enriched,
      relation: 'overlap',
      result: 'comparable',
      reason: `${dimensionLabel(dimension)}：known 取值部分相交（${shared.join('、')}），可比较但不构成整 scope 等价或完整覆盖`,
    };
  }
  return {
    ...enriched,
    relation: 'disjoint',
    result: 'disjoint',
    reason: `${dimensionLabel(dimension)}：known 取值无交集，确定 disjoint`,
  };
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 匹配两个适用范围的指定维度（默认全部八维）。
 *
 * **fail closed**：两侧 scope 先经既有 `validateApplicabilityScope` 校验；任一无效（含空
 * `explicit-all.evidence`、空 `known.values`、缺维度、unknown 当全范围等）即抛错，绝不把无效输入
 * 当成 `comparable`。`dimensions` 至少一个，否则抛 `RangeError`（不允许空比较冒充整 scope 等价）。
 *
 * @param dimensions 默认全部八维；迁移等场景可只比较部分维度（例如排除 `entry`），
 *                   但此时 `wholeScope === false`，结果只代表局部，**不得**据此宣称整 scope 等价或全覆盖。
 */
export function matchApplicabilityScopes(
  left: ApplicabilityScope,
  right: ApplicabilityScope,
  dimensions: readonly ScopeDimension[] = SCOPE_DIMENSIONS,
): ScopeMatch {
  if (dimensions.length === 0) {
    throw new RangeError('matchApplicabilityScopes: 至少需要一个比较维度，空比较不能冒充整 scope 等价');
  }
  const validation = validateScopeMatchInputs(left, right);
  if (!validation.valid) {
    const detail = validation.issues.map((issue) => `${issue.path}:${issue.code}`).join('; ');
    throw new Error(`matchApplicabilityScopes: 无效适用范围（fail closed）：${detail}`);
  }

  const dimensionMatches = dimensions.map((dimension) =>
    matchDimension(dimension, left[dimension], right[dimension]),
  );
  const comparedDimensions = [...dimensions];
  const wholeScope =
    comparedDimensions.length === SCOPE_DIMENSIONS.length &&
    SCOPE_DIMENSIONS.every((dimension) => comparedDimensions.includes(dimension));

  const disjointDimensions = dimensionMatches.filter((item) => item.result === 'disjoint');
  const unresolvedDimensions = dimensionMatches.filter((item) => item.result === 'unresolved');

  const reasons: string[] = [];
  let result: ScopeMatchResult;
  if (disjointDimensions.length > 0) {
    // 任一维度确定 disjoint 即可判整体 disjoint；其余 unknown 不改变该结论。
    result = 'disjoint';
    reasons.push(
      `确定 disjoint 维度：${disjointDimensions.map((item) => item.dimension).join('、')}`,
    );
    if (unresolvedDimensions.length > 0) {
      reasons.push(
        `另有未确定维度：${unresolvedDimensions.map((item) => item.dimension).join('、')}（不改变 disjoint 判定）`,
      );
    }
  } else if (unresolvedDimensions.length > 0) {
    result = 'unresolved';
    reasons.push(
      `无法确定维度：${unresolvedDimensions.map((item) => item.dimension).join('、')}`,
    );
  } else {
    result = 'comparable';
    reasons.push('所有比较维度均可确定，未发现 disjoint');
  }
  if (!wholeScope) {
    reasons.push('仅比较部分维度，结论只代表局部，不构成整 scope 等价或全覆盖');
  }

  return { result, dimensions: dimensionMatches, comparedDimensions, wholeScope, reasons };
}

/**
 * 是否为「整 scope 精确等价」：必须**比较了全部八维**（`wholeScope`），且各维关系均为
 * `exact` 或 `all-both`。局部比较、空比较或有交集（overlap）都**不**算整 scope 等价。
 */
export function isExactScopeMatch(match: ScopeMatch): boolean {
  return (
    match.wholeScope &&
    match.result === 'comparable' &&
    match.dimensions.every((item) => item.relation === 'exact' || item.relation === 'all-both')
  );
}

/** 是否确定互不相交（整体 disjoint）。 */
export function isDisjointScopeMatch(match: ScopeMatch): boolean {
  return match.result === 'disjoint';
}

/** 是否有无法确定的维度（整体 unresolved）。 */
export function isUnresolvedScopeMatch(match: ScopeMatch): boolean {
  return match.result === 'unresolved';
}

/**
 * 复用既有 contracts 校验器校验两个待匹配范围。
 * 本模块不重复实现范围校验；无效输入（如 unknown 当全范围、known 空取值）理由码与 contracts 一致。
 */
export function validateScopeMatchInputs(left: unknown, right: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateApplicabilityScope(left, 'left', issues);
  validateApplicabilityScope(right, 'right', issues);
  return { valid: issues.length === 0, issues };
}

/** 供报告/调试使用的紧凑描述。 */
export function describeScopeMatch(match: ScopeMatch): string {
  const parts = match.dimensions.map(
    (item) => `${item.dimension}=${item.relation}`,
  );
  return `${match.result} [${parts.join(', ')}]`;
}
