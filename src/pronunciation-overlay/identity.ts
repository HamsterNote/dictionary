/**
 * 稳定条目身份注册表（canonical `byId`）。
 *
 * - 单一持久真源 `byId`：entry 与 lexeme 是同一联合记录，不再维护重复注册表；
 *   检索索引、lexeme↔entry 关联等均为**派生 helper**，不重复持久化。
 * - ID 为不透明 UUID，带不具业务含义的类型前缀（`ent_` / `lex_`），只铸造一次并持久保存；
 *   无 `crypto.randomUUID` 时 **fail closed**，不用 Math.random 伪造 UUID。
 * - 拼写只是检索键；`spellingIndex` 由 `byId` 派生，可重建，不作为身份。
 * - 来源别名以「站点 + 语言 + exact page spelling + 锚点/结构路径 + grammar role」定位；
 *   锚点只是定位，不是永久身份；锚点变化不自动确认同一 ID，旧定位证据保留、冲突不覆盖。
 * - 音标、词性、拼写更新都不换 ID；IPA 相同也不合并身份。
 * - merge / split 为审计式变更：所有纠错范围按 ScopeConstraint 逐维重新核对，默认不迁移；
 *   只有完整可比且唯一有据时才迁移，否则 unresolved。
 *
 * 本模块为纯数据 + 纯函数，产出 JSON 可序列化的注册表，不联网、不写正式结果。
 */

import {
  PRONUNCIATION_SCHEMA,
  SCOPE_DIMENSIONS,
  isOpaqueIdFormat,
  knownScope,
  scopeWith,
  validateApplicabilityScope,
} from './contracts';
import type {
  ApplicabilityScope,
  GrammarRole,
  ScopeConstraint,
  ScopeDimension,
  ValidationIssue,
  ValidationResult,
} from './contracts';

export type IdentityRecordKind = 'entry' | 'lexeme';
export type IdentityLifecycleStatus = 'active' | 'retired';
export type IdentityIdFactory = (kind: IdentityRecordKind) => string;

/** 单个稳定条目记录。 */
export interface IdentityEntryRecord {
  readonly id: string;
  readonly kind: 'entry';
  readonly language: string;
  readonly exactSpelling: string;
  readonly aliases: readonly string[];
  readonly grammarRoles: readonly GrammarRole[];
  readonly partOfSpeech?: string;
  /** 展示用 IPA 观测引用；改这些引用不改变身份。 */
  readonly displayIpaRefs?: readonly string[];
  /** 明确多角色共享的观测引用。 */
  readonly sharedObservationIds?: readonly string[];
  readonly lexemeId?: string;
  /** 该条目声明的适用范围（用于 merge/split 逐维核对）。 */
  readonly applicability?: ApplicabilityScope;
  readonly status: IdentityLifecycleStatus;
  /** split 后的一对多后继；merge 的 redirect 不用此字段。 */
  readonly successorIds: readonly string[];
  /** merge 后的唯一重定向目标。 */
  readonly redirectTo?: string;
  readonly retiredReason?: string;
  readonly evidenceRefs: readonly string[];
  /** 测试夹具标记；真实条目不得默认置 true。 */
  readonly synthetic?: boolean;
}

/** lexeme 记录，仅表达有证据的关联；entry↔lexeme 关联由 entry.lexemeId 派生。 */
export interface IdentityLexemeRecord {
  readonly id: string;
  readonly kind: 'lexeme';
  readonly language: string;
  readonly synthetic?: boolean;
}

/** byId 值：entry | lexeme 的判别联合。 */
export type IdentityRecord = IdentityEntryRecord | IdentityLexemeRecord;

/** 来源别名定位键；anchor/scopePath/role 仅用于定位与消歧，不是永久身份。 */
export interface SourceAliasLocator {
  readonly sourceSite: string;
  readonly language: string;
  readonly pageSpelling: string;
  readonly anchor?: string;
  readonly scopePath?: readonly string[];
  readonly role?: GrammarRole;
}

export type SourceAliasStatus = 'confirmed' | 'pending-review' | 'historical';

/** 来源别名映射项。 */
export interface SourceAliasRecord extends SourceAliasLocator {
  readonly entryId: string;
  readonly status: SourceAliasStatus;
  readonly evidenceRefs: readonly string[];
}

/** canonical 身份注册表；`byId` 本身即身份真源。 */
export interface IdentityRegistry {
  readonly schema: typeof PRONUNCIATION_SCHEMA.identity;
  readonly byId: Readonly<Record<string, IdentityRecord>>;
  readonly sourceAliases: readonly SourceAliasRecord[];
  /**
   * 持久审计历史：merge / split 的旧 target / scope / fingerprint / decisions 一并保留，
   * 不依赖易丢失的临时返回值。属可选字段（旧数据缺失时视为空）。
   */
  readonly history?: readonly IdentityAuditRecord[];
}

export const READ_ROLE_ORDER: readonly GrammarRole[] = [
  'base',
  'present',
  'past',
  'past-participle',
];

// ---------------------------------------------------------------------------
// ID 铸造（严格不透明 UUID，fail closed）
// ---------------------------------------------------------------------------

interface CryptoWithRandomUuid {
  readonly randomUUID: () => string;
}

function readCryptoRandomUuid(): (() => string) | undefined {
  const candidate = (globalThis as { crypto?: Partial<CryptoWithRandomUuid> }).crypto;
  return typeof candidate?.randomUUID === 'function'
    ? candidate.randomUUID.bind(candidate)
    : undefined;
}

/** 严格判断是否为不透明 ID（与 contracts.OPAQUE_ID_PATTERN 一致）。 */
export function isOpaqueIdentityId(value: string): boolean {
  return isOpaqueIdFormat(value);
}

/**
 * 默认 ID 工厂：必须使用 `crypto.randomUUID`。
 * 缺失时 **fail closed**（抛错），绝不退化为 Math.random 伪造 UUID。
 */
export function defaultIdentityIdFactory(kind: IdentityRecordKind): string {
  const prefix = kind === 'entry' ? 'ent_' : 'lex_';
  const randomUuid = readCryptoRandomUuid();
  if (randomUuid === undefined) {
    throw new Error(
      'defaultIdentityIdFactory: 缺少 crypto.randomUUID，无法生成安全不透明 ID（fail closed）。请注入有效 UUID 工厂。',
    );
  }
  const id = `${prefix}${randomUuid()}`;
  if (!isOpaqueIdFormat(id)) {
    throw new Error(`defaultIdentityIdFactory: 生成的 ID 非法：${id}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// 构造与派生访问
// ---------------------------------------------------------------------------

export function createIdentityRegistry(): IdentityRegistry {
  return {
    schema: PRONUNCIATION_SCHEMA.identity,
    byId: {},
    sourceAliases: [],
    history: [],
  };
}

/** 读取任意记录。 */
export function getRecord(registry: IdentityRegistry, id: string): IdentityRecord | undefined {
  return registry.byId[id];
}

/** 按 ID 读取条目记录。 */
export function getEntry(registry: IdentityRegistry, id: string): IdentityEntryRecord | undefined {
  const record = registry.byId[id];
  return record?.kind === 'entry' ? record : undefined;
}

/** 按 ID 读取 lexeme 记录。 */
export function getLexeme(
  registry: IdentityRegistry,
  id: string,
): IdentityLexemeRecord | undefined {
  const record = registry.byId[id];
  return record?.kind === 'lexeme' ? record : undefined;
}

export function listEntries(registry: IdentityRegistry): readonly IdentityEntryRecord[] {
  return Object.values(registry.byId).filter(
    (record): record is IdentityEntryRecord => record.kind === 'entry',
  );
}

export function listLexemes(registry: IdentityRegistry): readonly IdentityLexemeRecord[] {
  return Object.values(registry.byId).filter(
    (record): record is IdentityLexemeRecord => record.kind === 'lexeme',
  );
}

/** 派生 lexeme 下的条目 ID（不持久化 entryIds，避免双写）。 */
export function listLexemeEntryIds(
  registry: IdentityRegistry,
  lexemeId: string,
): readonly string[] {
  return listEntries(registry)
    .filter((entry) => entry.lexemeId === lexemeId)
    .map((entry) => entry.id)
    .sort((left, right) => left.localeCompare(right));
}

export interface CreateEntryInput {
  readonly language: string;
  readonly exactSpelling: string;
  readonly grammarRoles?: readonly GrammarRole[];
  readonly partOfSpeech?: string;
  readonly lexemeId?: string;
  readonly aliases?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly applicability?: ApplicabilityScope;
  readonly id?: string;
  readonly synthetic?: boolean;
}

export interface CreateEntryResult {
  readonly registry: IdentityRegistry;
  readonly entryId: string;
}

export function createEntry(
  registry: IdentityRegistry,
  input: CreateEntryInput,
  factory: IdentityIdFactory = defaultIdentityIdFactory,
): CreateEntryResult {
  const entryId = input.id ?? factory('entry');
  // kind 前缀严格：entry 必须 ent_ 不透明 UUID（不得复用 lex_）。
  if (!isOpaqueIdFormat(entryId) || !entryId.startsWith('ent_')) {
    throw new Error(`createEntry: ID 必须是 ent_ 不透明 UUID：${entryId}`);
  }
  if (registry.byId[entryId] !== undefined) {
    throw new Error(`createEntry: 条目 ID 已存在 ${entryId}`);
  }
  if (typeof input.language !== 'string' || input.language.length === 0) {
    throw new Error('createEntry: language 必须是非空字符串');
  }
  if (typeof input.exactSpelling !== 'string' || input.exactSpelling.length === 0) {
    throw new Error('createEntry: exactSpelling 必须是非空字符串');
  }
  if (
    input.partOfSpeech !== undefined &&
    (typeof input.partOfSpeech !== 'string' || input.partOfSpeech.length === 0)
  ) {
    throw new Error('createEntry: partOfSpeech 若存在必须是非空字符串');
  }
  for (const role of input.grammarRoles ?? []) {
    if (!isValidGrammarRole(role)) {
      throw new Error(`createEntry: 非法 grammar role ${String(role)}`);
    }
  }
  for (const [label, values] of [
    ['aliases', input.aliases],
    ['evidenceRefs', input.evidenceRefs],
  ] as const) {
    if (values?.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error(`createEntry: ${label} 元素必须是非空字符串`);
    }
  }
  assertValidApplicability(input.applicability, 'createEntry');
  if (input.synthetic !== undefined && typeof input.synthetic !== 'boolean') {
    throw new Error('createEntry: synthetic 若存在必须是布尔值');
  }
  if (input.lexemeId !== undefined) {
    if (!isOpaqueIdFormat(input.lexemeId) || !input.lexemeId.startsWith('lex_')) {
      throw new Error(`createEntry: lexemeId 必须是 lex_ 不透明 UUID：${input.lexemeId}`);
    }
    const lexeme = registry.byId[input.lexemeId];
    if (lexeme?.kind !== 'lexeme') {
      throw new Error(`createEntry: lexeme 不存在 ${input.lexemeId}`);
    }
    // entry 与所属 lexeme 的语言必须一致。
    if (lexeme.language !== input.language) {
      throw new Error(
        `createEntry: entry 语言 ${input.language} 与 lexeme 语言 ${lexeme.language} 不一致`,
      );
    }
    // entry 与所属 lexeme 的 synthetic class 必须一致（缺省视为 false）。
    if ((input.synthetic ?? false) !== (lexeme.synthetic ?? false)) {
      throw new Error(
        `createEntry: entry synthetic=${String(input.synthetic ?? false)} 与 lexeme synthetic=${String(
          lexeme.synthetic ?? false,
        )} 不一致`,
      );
    }
  }
  const record: IdentityEntryRecord = {
    id: entryId,
    kind: 'entry',
    language: input.language,
    exactSpelling: input.exactSpelling,
    aliases: [...(input.aliases ?? [])],
    grammarRoles: [...(input.grammarRoles ?? [])],
    status: 'active',
    successorIds: [],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    ...(input.partOfSpeech === undefined ? {} : { partOfSpeech: input.partOfSpeech }),
    ...(input.lexemeId === undefined ? {} : { lexemeId: input.lexemeId }),
    ...(input.applicability === undefined ? {} : { applicability: input.applicability }),
    ...(input.synthetic === undefined ? {} : { synthetic: input.synthetic }),
  };
  return { registry: { ...registry, byId: { ...registry.byId, [entryId]: record } }, entryId };
}

/** 校验适用范围可选字段；非法时抛出（工厂 fail closed）。 */
function assertValidApplicability(input: ApplicabilityScope | undefined, label: string): void {
  if (input === undefined) return;
  const issues: ValidationIssue[] = [];
  validateApplicabilityScope(input, '$', issues);
  if (issues.length > 0) {
    throw new Error(`${label}: 适用范围非法：${issues.map((issue) => issue.message).join('; ')}`);
  }
}

export interface CreateLexemeInput {
  readonly language: string;
  readonly id?: string;
  readonly synthetic?: boolean;
}

export interface CreateLexemeResult {
  readonly registry: IdentityRegistry;
  readonly lexemeId: string;
}

export function createLexeme(
  registry: IdentityRegistry,
  input: CreateLexemeInput,
  factory: IdentityIdFactory = defaultIdentityIdFactory,
): CreateLexemeResult {
  const lexemeId = input.id ?? factory('lexeme');
  // kind 前缀严格：lexeme 必须 lex_ 不透明 UUID（不得复用 ent_）。
  if (!isOpaqueIdFormat(lexemeId) || !lexemeId.startsWith('lex_')) {
    throw new Error(`createLexeme: ID 必须是 lex_ 不透明 UUID：${lexemeId}`);
  }
  if (registry.byId[lexemeId] !== undefined) {
    throw new Error(`createLexeme: lexeme ID 已存在 ${lexemeId}`);
  }
  if (typeof input.language !== 'string' || input.language.length === 0) {
    throw new Error('createLexeme: language 必须是非空字符串');
  }
  if (input.synthetic !== undefined && typeof input.synthetic !== 'boolean') {
    throw new Error('createLexeme: synthetic 若存在必须是布尔值');
  }
  const record: IdentityLexemeRecord = {
    id: lexemeId,
    kind: 'lexeme',
    language: input.language,
    ...(input.synthetic === undefined ? {} : { synthetic: input.synthetic }),
  };
  return { registry: { ...registry, byId: { ...registry.byId, [lexemeId]: record } }, lexemeId };
}

// ---------------------------------------------------------------------------
// 检索与派生索引
// ---------------------------------------------------------------------------

/** 搜索键规范化：NFKC + 压缩空白 + en-US 小写；与旧查询体验一致。 */
export function normalizeSpellingKey(spelling: string): string {
  return spelling.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

/** 由 `byId` 派生 spellingIndex：searchKey → entryIds[]（可重建，不作身份）。 */
export function buildSpellingIndex(
  registry: IdentityRegistry,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const entry of listEntries(registry)) {
    if (entry.status !== 'active') continue;
    const keys = new Set<string>([
      normalizeSpellingKey(entry.exactSpelling),
      ...entry.aliases.map((alias) => normalizeSpellingKey(alias)),
    ]);
    for (const key of keys) {
      const list = index.get(key) ?? [];
      if (!list.includes(entry.id)) list.push(entry.id);
      index.set(key, list);
    }
  }
  for (const list of index.values()) {
    list.sort((left, right) => left.localeCompare(right));
  }
  return index;
}

export interface SpellingLookupResult {
  readonly searchKey: string;
  readonly entryIds: readonly string[];
}

/** 按检索拼写查询条目；大小写/Unicode 碰撞返回多个候选，不全局合并。 */
export function lookupEntryIdsBySpelling(
  registry: IdentityRegistry,
  spelling: string,
): SpellingLookupResult {
  const searchKey = normalizeSpellingKey(spelling);
  const entryIds = buildSpellingIndex(registry).get(searchKey) ?? [];
  return { searchKey, entryIds };
}

// ---------------------------------------------------------------------------
// 属性更新（不换 ID）
// ---------------------------------------------------------------------------

export interface EntryAttributePatch {
  readonly exactSpelling?: string;
  readonly aliases?: readonly string[];
  readonly partOfSpeech?: string;
  readonly displayIpaRefs?: readonly string[];
  readonly applicability?: ApplicabilityScope;
}

/** 更新展示属性：拼写、词性、IPA 引用变化均**不**改变 ID；旧拼写保留为 alias。 */
export function updateEntryAttributes(
  registry: IdentityRegistry,
  entryId: string,
  patch: EntryAttributePatch,
): IdentityRegistry {
  const entry = getEntry(registry, entryId);
  if (entry === undefined) {
    throw new Error(`updateEntryAttributes: 条目不存在 ${entryId}`);
  }
  if (entry.status !== 'active') {
    throw new Error(`updateEntryAttributes: 已停用条目不可更新 ${entryId}`);
  }
  let aliases = [...entry.aliases];
  if (patch.exactSpelling !== undefined && patch.exactSpelling !== entry.exactSpelling) {
    const previous = entry.exactSpelling;
    if (!aliases.includes(previous)) aliases = [...aliases, previous];
  }
  if (patch.aliases !== undefined) {
    for (const alias of patch.aliases) {
      if (!aliases.includes(alias)) aliases = [...aliases, alias];
    }
  }
  const record: IdentityEntryRecord = {
    ...entry,
    aliases,
    exactSpelling: patch.exactSpelling ?? entry.exactSpelling,
    ...(patch.partOfSpeech === undefined ? {} : { partOfSpeech: patch.partOfSpeech }),
    ...(patch.displayIpaRefs === undefined ? {} : { displayIpaRefs: [...patch.displayIpaRefs] }),
    ...(patch.applicability === undefined ? {} : { applicability: patch.applicability }),
  };
  return { ...registry, byId: { ...registry.byId, [entryId]: record } };
}

// ---------------------------------------------------------------------------
// 来源别名
// ---------------------------------------------------------------------------

function pathsEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 完整定位键比较（含 anchor / scopePath / role 消歧）。 */
export function sourceAliasLocatorEquals(
  left: SourceAliasLocator,
  right: SourceAliasLocator,
): boolean {
  return (
    left.sourceSite === right.sourceSite &&
    left.language === right.language &&
    left.pageSpelling === right.pageSpelling &&
    (left.anchor ?? '') === (right.anchor ?? '') &&
    (left.role ?? '') === (right.role ?? '') &&
    pathsEqual(left.scopePath, right.scopePath)
  );
}

/** locator 的 language/role 必须与目标 entry 身份兼容：en alias 不得指向 de entry。 */
function entryAllowsLocator(entry: IdentityEntryRecord, locator: SourceAliasLocator): boolean {
  if (entry.language !== locator.language) return false;
  if (locator.role !== undefined && !entry.grammarRoles.includes(locator.role)) return false;
  return true;
}

function findAliasIndex(registry: IdentityRegistry, locator: SourceAliasLocator): number {
  return registry.sourceAliases.findIndex((alias) => sourceAliasLocatorEquals(alias, locator));
}

/**
 * 同页同语言同 role 但定位键不同的相关别名位置（忽略 anchor / scopePath 变化）。
 * 用于锚点/结构路径变化时保持 pending，而不是误判为新绑定或已确认。
 */
function findRelatedAliasIndexes(
  registry: IdentityRegistry,
  locator: SourceAliasLocator,
): readonly number[] {
  const indexes: number[] = [];
  registry.sourceAliases.forEach((alias, index) => {
    const samePageIdentity =
      alias.sourceSite === locator.sourceSite &&
      alias.language === locator.language &&
      alias.pageSpelling === locator.pageSpelling &&
      (alias.role ?? '') === (locator.role ?? '');
    if (samePageIdentity && !sourceAliasLocatorEquals(alias, locator)) {
      indexes.push(index);
    }
  });
  return indexes;
}

export interface AddSourceAliasInput extends SourceAliasLocator {
  readonly entryId: string;
  readonly evidenceRefs: readonly string[];
}

export interface AddSourceAliasResult {
  readonly registry: IdentityRegistry;
  readonly action: 'added' | 'exists' | 'conflict' | 'invalid' | 'review-required';
}

/** 证据引用必须为非空数组且每项为非空白字符串。 */
function hasValidEvidence(refs: readonly string[]): boolean {
  return refs.length > 0 && refs.every((ref) => typeof ref === 'string' && ref.trim() !== '');
}

/**
 * 登记来源别名：与 `reconcileSourceAlias` 使用**同一套相关 locator 逻辑**。
 * - 精确 locator 已存在且同条目 → exists（pending 保持 pending，不回 confirmed）；
 * - 精确 locator 已存在但不同条目 → conflict；
 * - 无精确匹配但存在同 site/language/spelling/role 的相关 locator（锚点/路径变化）→
 *   新增 pending-review 并保留旧记录，返回 review-required，不自动 confirmed；
 * - 全新且无相关 → added（confirmed）。
 */
export function addSourceAlias(
  registry: IdentityRegistry,
  input: AddSourceAliasInput,
): AddSourceAliasResult {
  if (!hasValidEvidence(input.evidenceRefs)) {
    throw new Error('addSourceAlias: 登记别名必须带非空白证据');
  }
  // locator 必须与目标身份兼容（语言一致、role 属于该 entry）。
  const target = getEntry(registry, input.entryId);
  if (target?.status !== 'active' || !entryAllowsLocator(target, input)) {
    return { registry, action: 'invalid' };
  }
  const index = findAliasIndex(registry, input);
  if (index === -1) {
    if (findRelatedAliasIndexes(registry, input).length > 0) {
      const pending = buildAliasRecord(input, 'pending-review');
      return {
        registry: { ...registry, sourceAliases: [...registry.sourceAliases, pending] },
        action: 'review-required',
      };
    }
    const alias = buildAliasRecord(input, 'confirmed');
    return {
      registry: { ...registry, sourceAliases: [...registry.sourceAliases, alias] },
      action: 'added',
    };
  }
  const existing = registry.sourceAliases[index];
  if (existing?.entryId === input.entryId) {
    return { registry, action: 'exists' };
  }
  return { registry, action: 'conflict' };
}

/** 显式构造别名记录，避免把 anchorChanged 等控制字段写进持久记录。 */
function buildAliasRecord(
  input: SourceAliasLocator & { entryId: string; evidenceRefs: readonly string[] },
  status: SourceAliasStatus,
): SourceAliasRecord {
  return {
    sourceSite: input.sourceSite,
    language: input.language,
    pageSpelling: input.pageSpelling,
    ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    ...(input.scopePath === undefined ? {} : { scopePath: [...input.scopePath] }),
    ...(input.role === undefined ? {} : { role: input.role }),
    entryId: input.entryId,
    status,
    evidenceRefs: [...input.evidenceRefs],
  };
}

export interface ReconcileAliasInput extends SourceAliasLocator {
  readonly entryId: string;
  readonly evidenceRefs: readonly string[];
  /** 上游锚点是否变化。变化时不自动确认同一 ID。 */
  readonly anchorChanged: boolean;
}

export interface ReconcileAliasResult {
  readonly registry: IdentityRegistry;
  readonly action: 'bound' | 'unchanged' | 'conflict' | 'review-required' | 'invalid';
  readonly entryId: string;
}

/**
 * 核对来源别名：
 * - locator 与目标 entry 身份不兼容或缺证据 → invalid（不绑定）；
 * - 精确定位键存在且同条目：pending 保持 pending（不因重复报告/anchor 变化转确认），
 *   已确认则合并证据返回 unchanged；
 * - 精确定位键存在但不同条目 → conflict（不覆盖）；
 * - anchor/scopePath 变化或存在同页同 role 相关别名 → 新增 pending-review 并保留旧记录，
 *   返回 review-required，**不**自动确认；
 * - 全新且无相关的定位键 → bound（confirmed）。
 */
export function reconcileSourceAlias(
  registry: IdentityRegistry,
  input: ReconcileAliasInput,
): ReconcileAliasResult {
  const target = getEntry(registry, input.entryId);
  if (target?.status !== 'active' || !entryAllowsLocator(target, input)) {
    return { registry, action: 'invalid', entryId: input.entryId };
  }
  if (!hasValidEvidence(input.evidenceRefs)) {
    return { registry, action: 'invalid', entryId: input.entryId };
  }
  const index = findAliasIndex(registry, input);
  if (index !== -1) {
    const existing = registry.sourceAliases[index];
    if (existing === undefined) {
      return { registry, action: 'conflict', entryId: input.entryId };
    }
    if (existing.entryId !== input.entryId) {
      return { registry, action: 'conflict', entryId: existing.entryId };
    }
    const mergedEvidence = [...new Set([...existing.evidenceRefs, ...input.evidenceRefs])];
    // 声明锚点变化（即使定位键相同）不得走快捷 confirmed：转 pending 待核。
    if (input.anchorChanged) {
      const updated: SourceAliasRecord = {
        ...existing,
        status: 'pending-review',
        evidenceRefs: mergedEvidence,
      };
      const sourceAliases = [...registry.sourceAliases];
      sourceAliases[index] = updated;
      return {
        registry: { ...registry, sourceAliases },
        action: 'review-required',
        entryId: existing.entryId,
      };
    }
    // pending 记录保持 pending，绝不因重复报告自动确认。
    if (existing.status === 'pending-review') {
      const updated: SourceAliasRecord = { ...existing, evidenceRefs: mergedEvidence };
      const sourceAliases = [...registry.sourceAliases];
      sourceAliases[index] = updated;
      return {
        registry: { ...registry, sourceAliases },
        action: 'review-required',
        entryId: existing.entryId,
      };
    }
    const updated: SourceAliasRecord = { ...existing, evidenceRefs: mergedEvidence };
    const sourceAliases = [...registry.sourceAliases];
    sourceAliases[index] = updated;
    return {
      registry: { ...registry, sourceAliases },
      action: 'unchanged',
      entryId: existing.entryId,
    };
  }

  if (input.anchorChanged || findRelatedAliasIndexes(registry, input).length > 0) {
    // 锚点/结构路径变化：新增待核对记录，保留旧记录与证据，不覆盖、不自动确认。
    const pending = buildAliasRecord(input, 'pending-review');
    return {
      registry: { ...registry, sourceAliases: [...registry.sourceAliases, pending] },
      action: 'review-required',
      entryId: input.entryId,
    };
  }

  const alias = buildAliasRecord(input, 'confirmed');
  return {
    registry: { ...registry, sourceAliases: [...registry.sourceAliases, alias] },
    action: 'bound',
    entryId: input.entryId,
  };
}

export interface ConfirmSourceAliasResult {
  readonly registry: IdentityRegistry;
  readonly action:
    'confirmed' | 'unchanged' | 'conflict' | 'missing' | 'missing-evidence' | 'invalid';
}

/** 明确人工确认待核对别名；必须带非空新确认证据，冲突时不覆盖。 */
export function confirmSourceAlias(
  registry: IdentityRegistry,
  locator: SourceAliasLocator,
  entryId: string,
  evidenceRefs: readonly string[],
): ConfirmSourceAliasResult {
  // 明确确认必须有非空且非空白的新证据，不得空/坏确认冒充 new confirmation。
  if (!hasValidEvidence(evidenceRefs)) return { registry, action: 'missing-evidence' };
  const target = getEntry(registry, entryId);
  if (target?.status !== 'active' || !entryAllowsLocator(target, locator)) {
    return { registry, action: 'invalid' };
  }
  const index = findAliasIndex(registry, locator);
  if (index === -1) return { registry, action: 'missing' };
  const existing = registry.sourceAliases[index];
  if (existing === undefined) return { registry, action: 'missing' };
  if (existing.entryId !== entryId) return { registry, action: 'conflict' };
  if (existing.status === 'confirmed') return { registry, action: 'unchanged' };
  // 必须有**实质新**证据（至少一项此前不存在），否则不得冒充新 confirmation。
  const hasNewEvidence = evidenceRefs.some((ref) => !existing.evidenceRefs.includes(ref));
  if (!hasNewEvidence) return { registry, action: 'missing-evidence' };
  const updated: SourceAliasRecord = {
    ...existing,
    status: 'confirmed',
    evidenceRefs: [...new Set([...existing.evidenceRefs, ...evidenceRefs])],
  };
  const sourceAliases = [...registry.sourceAliases];
  sourceAliases[index] = updated;
  return { registry: { ...registry, sourceAliases }, action: 'confirmed' };
}

// ---------------------------------------------------------------------------
// read 四角色身份（幂等、可持久往返）
// ---------------------------------------------------------------------------

function entryHasSpelling(entry: IdentityEntryRecord, spelling: string): boolean {
  return entry.exactSpelling === spelling || entry.aliases.includes(spelling);
}

/**
 * 复用资格：只有 active、同 synthetic、partOfSpeech 为 verb 且有身份证据的条目才算合格 verb 身份；
 * 且其所属 lexeme 自身也必须 language/synthetic class 与请求一致（不能仅凭 entry 标记）。
 */
function isReusableVerbEntry(
  registry: IdentityRegistry,
  entry: IdentityEntryRecord,
  language: string,
  spelling: string,
  synthetic: boolean,
): boolean {
  if (
    entry.status !== 'active' ||
    entry.language !== language ||
    !entryHasSpelling(entry, spelling) ||
    entry.partOfSpeech !== 'verb' ||
    (entry.synthetic ?? false) !== synthetic ||
    entry.evidenceRefs.length === 0
  ) {
    return false;
  }
  if (entry.lexemeId === undefined) return true;
  const lexeme = getLexeme(registry, entry.lexemeId);
  if (lexeme === undefined) return false;
  // 直接校 lexeme 自己的 language / synthetic（缺省 false），不接受假布尔强转。
  return lexeme.language === language && (lexeme.synthetic ?? false) === synthetic;
}

function findLexemeForSpelling(
  registry: IdentityRegistry,
  language: string,
  spelling: string,
  synthetic: boolean,
): string | undefined {
  const lexemeIds = new Set<string>();
  for (const entry of listEntries(registry)) {
    // 只考虑合格 active verb 身份；retired/merged/noun/无据/synthetic 混标均不得作为复用来源。
    if (!isReusableVerbEntry(registry, entry, language, spelling, synthetic)) continue;
    if (entry.lexemeId === undefined) continue;
    lexemeIds.add(entry.lexemeId);
  }
  if (lexemeIds.size === 0) return undefined;
  // 多个合格 lexeme 不得任取 first；无法唯一定位即报错，等人工核对。
  if (lexemeIds.size > 1) {
    throw new Error(`findLexemeForSpelling: 拼写 ${spelling} 关联多个合格 verb lexeme，无法确定`);
  }
  const only = [...lexemeIds][0];
  return only;
}

/**
 * 在指定 lexeme 下按 role 找**唯一**合格 active verb 条目。
 * 同 role 多个合格候选无法唯一确定时抛错（不取 first）。
 */
function findActiveRoleEntry(
  registry: IdentityRegistry,
  lexemeId: string,
  role: GrammarRole,
  language: string,
  spelling: string,
  synthetic: boolean,
): IdentityEntryRecord | undefined {
  const candidates = listEntries(registry).filter(
    (entry) =>
      isReusableVerbEntry(registry, entry, language, spelling, synthetic) &&
      entry.lexemeId === lexemeId &&
      entry.grammarRoles.includes(role),
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    throw new Error(
      `findActiveRoleEntry: lexeme ${lexemeId} 的 role ${role} 有多个合格候选，无法唯一确定`,
    );
  }
  return candidates[0];
}

/** 明确多角色身份支持：同一证据显式覆盖这些 role 时，才可据此创建对应角色。 */
export interface ReadMultiRoleEvidence {
  readonly evidenceRefs: readonly string[];
  readonly roles: readonly GrammarRole[];
}

export interface EstablishReadInput {
  readonly spelling?: string;
  readonly language?: string;
  readonly partOfSpeech?: string;
  /** 必须显式声明；真实条目用 false，合成夹具用 true。 */
  readonly synthetic: boolean;
  /** 逐 role 的明确证据。 */
  readonly evidenceByRole?: Partial<Record<GrammarRole, readonly string[]>>;
  /** 明确多角色身份支持；不能用任意单一证据默认认证全部四个 role。 */
  readonly multiRoleEvidence?: ReadMultiRoleEvidence;
  readonly idFactory?: IdentityIdFactory;
}

export interface EstablishReadResult {
  readonly registry: IdentityRegistry;
  /** 无任何角色建立且无既有 lexeme 时为 undefined；不铸造无据 lexeme。 */
  readonly lexemeId?: string;
  readonly ids: Readonly<Partial<Record<GrammarRole, string>>>;
  readonly reusedRoles: readonly GrammarRole[];
  readonly createdRoles: readonly GrammarRole[];
  readonly missingRoles: readonly GrammarRole[];
}

/**
 * 为 `read` 建立 base / present / past / past-participle 四个独立稳定 ID，关联同一 verb lexeme。
 * 幂等：已有 active lexeme/角色复用原 ID（排除 retired/merged），缺角色仅在**充分证据**下按需补；
 * 不按可变拼写 hash 生成。base 与 present 永不合并，即使 IPA 相同；role 是显式属性。
 * 无任何 role 证据时不铸造无据 lexeme。
 */
export function establishReadIdentities(
  registry: IdentityRegistry,
  input: EstablishReadInput,
): EstablishReadResult {
  const spelling = input.spelling ?? 'read';
  const language = input.language ?? 'en';
  // 本函数只为 verb 身份建四 role；不得把 read 四 role 造成 noun。
  if (input.partOfSpeech !== undefined && input.partOfSpeech !== 'verb') {
    throw new Error(
      `establishReadIdentities: partOfSpeech 只能为 verb，收到 ${input.partOfSpeech}`,
    );
  }
  const partOfSpeech = 'verb';
  const factory = input.idFactory ?? defaultIdentityIdFactory;
  let next = registry;

  const existingLexemeId = findLexemeForSpelling(next, language, spelling, input.synthetic);

  const roleEvidenceOf = (role: GrammarRole): readonly string[] =>
    input.evidenceByRole?.[role] ??
    (input.multiRoleEvidence?.roles.includes(role) ? input.multiRoleEvidence.evidenceRefs : []);

  const reuse: Partial<Record<GrammarRole, string>> = {};
  const toCreate: GrammarRole[] = [];
  const missingRoles: GrammarRole[] = [];

  for (const role of READ_ROLE_ORDER) {
    const existing =
      existingLexemeId === undefined
        ? undefined
        : findActiveRoleEntry(next, existingLexemeId, role, language, spelling, input.synthetic);
    if (existing !== undefined) {
      reuse[role] = existing.id;
      continue;
    }
    if (roleEvidenceOf(role).length === 0) {
      missingRoles.push(role);
      continue;
    }
    toCreate.push(role);
  }

  const ids: Partial<Record<GrammarRole, string>> = { ...reuse };
  const reusedRoles = Object.keys(reuse) as GrammarRole[];

  // 无新角色可建：不铸造无据 lexeme，直接返回复用结果。
  if (toCreate.length === 0) {
    return {
      registry: next,
      ...(existingLexemeId === undefined ? {} : { lexemeId: existingLexemeId }),
      ids,
      reusedRoles,
      createdRoles: [],
      missingRoles,
    };
  }

  let lexemeId = existingLexemeId;
  if (lexemeId === undefined) {
    const created = createLexeme(next, { language, synthetic: input.synthetic }, factory);
    next = created.registry;
    lexemeId = created.lexemeId;
  }

  const createdRoles: GrammarRole[] = [];
  for (const role of toCreate) {
    const roleEvidence = roleEvidenceOf(role);
    if (!input.synthetic && roleEvidence.some((ref) => ref.startsWith('synthetic:'))) {
      throw new Error(`establishReadIdentities: 真实条目不得使用 synthetic 证据（role=${role}）`);
    }
    const created = createEntry(
      next,
      {
        language,
        exactSpelling: spelling,
        grammarRoles: [role],
        partOfSpeech,
        lexemeId,
        evidenceRefs: roleEvidence,
        synthetic: input.synthetic,
      },
      factory,
    );
    next = created.registry;
    createdRoles.push(role);
    ids[role] = created.entryId;
  }

  return {
    registry: next,
    lexemeId,
    ids,
    reusedRoles,
    createdRoles,
    missingRoles,
  };
}

// ---------------------------------------------------------------------------
// 多角色共享证据
// ---------------------------------------------------------------------------

export interface ShareRoleEvidenceInput {
  readonly observationId: string;
  readonly roles: readonly GrammarRole[];
  /** 来源明确覆盖的适用范围；role 维度必须显式覆盖所有目标角色。 */
  readonly applicability: ApplicabilityScope;
  readonly evidenceRefs: readonly string[];
}

export interface ShareRoleEvidenceResult {
  readonly registry: IdentityRegistry;
  readonly entryIds: readonly string[];
  readonly uncoveredRoles: readonly GrammarRole[];
}

/** 判断约束是否「显式」：known 非空或 explicit-all 带证据；unknown 一律非显式。 */
function isExplicitConstraint(constraint: ScopeConstraint): boolean {
  if (constraint.kind === 'known') return constraint.values.length > 0;
  if (constraint.kind === 'explicit-all') return constraint.evidence.length > 0;
  return false;
}

type ShareCoverageRelation = 'covered' | 'disjoint' | 'ambiguous';

/**
 * 单维关系（方向：目标范围 ⊆ 证据范围，即证据覆盖目标）：
 * - 证据 explicit-all → covered；
 * - 目标 explicit-all 而证据非 explicit-all → ambiguous；
 * - 证据 unknown → ambiguous；目标 unknown 而证据非 explicit-all → ambiguous（不猜）；
 * - 双方 known：目标取值全部落入证据 → covered；全不相交 → disjoint；仅部分 → ambiguous。
 */
function constraintCoverageRelation(
  source: ScopeConstraint,
  target: ScopeConstraint,
): ShareCoverageRelation {
  if (target.kind === 'explicit-all') {
    return source.kind === 'explicit-all' && source.evidence.length > 0 ? 'covered' : 'ambiguous';
  }
  if (source.kind === 'explicit-all') {
    return source.evidence.length > 0 ? 'covered' : 'ambiguous';
  }
  if (source.kind === 'unknown' || target.kind === 'unknown') return 'ambiguous';
  const sourceValues = new Set(source.values);
  if (target.values.every((value) => sourceValues.has(value))) return 'covered';
  return target.values.some((value) => sourceValues.has(value)) ? 'ambiguous' : 'disjoint';
}

/**
 * 从 entry 权威字段构造该 role 的目标范围：language/entry/lexeme/role/POS 以 entry 权威值覆盖；
 * entry.applicability 已有的 sense/accent/other（及未提供权威值时对应维度）保留其 known/explicit-all/unknown，
 * 不强行置 unknown。返回 contradiction=true 表示原 scope 与权威字段矛盾（不得据此共享）。
 */
function buildTargetScopeForRole(
  entry: IdentityEntryRecord,
  role: GrammarRole,
): { scope: ApplicabilityScope; contradiction: boolean } {
  const base = entry.applicability ?? scopeWith({});
  const knownExcludes = (constraint: ScopeConstraint, value: string): boolean =>
    constraint.kind === 'known' && !constraint.values.includes(value);
  let contradiction = false;
  if (knownExcludes(base.language, entry.language)) contradiction = true;
  if (knownExcludes(base.entry, entry.id)) contradiction = true;
  if (entry.lexemeId !== undefined && knownExcludes(base.lexeme, entry.lexemeId))
    contradiction = true;
  if (knownExcludes(base.role, role)) contradiction = true;
  if (entry.partOfSpeech !== undefined && knownExcludes(base.pos, entry.partOfSpeech)) {
    contradiction = true;
  }
  const scope = scopeWith({
    language: knownScope([entry.language]),
    entry: knownScope([entry.id]),
    lexeme: entry.lexemeId === undefined ? base.lexeme : knownScope([entry.lexemeId]),
    role: knownScope([role]),
    pos: entry.partOfSpeech === undefined ? base.pos : knownScope([entry.partOfSpeech]),
    // entry.applicability 已有的 sense/accent/other 原样保留（known/explicit-all/unknown）。
    sense: base.sense,
    accent: base.accent,
    other: base.other,
  });
  return { scope, contradiction };
}

/**
 * 判定证据范围是否覆盖该 entry 的该 role 目标：必须逐维覆盖（含 entry 维与真实 target ID），
 * 任一维 unknown/仅部分 → ambiguous，双方 known 全不相交 → disjoint；原 scope 矛盾 → ambiguous。
 */
function classifyShareCoverage(
  source: ApplicabilityScope,
  entry: IdentityEntryRecord,
  role: GrammarRole,
): ShareCoverageRelation {
  const { scope: target, contradiction } = buildTargetScopeForRole(entry, role);
  if (contradiction) return 'ambiguous';
  const relations = SCOPE_DIMENSIONS.map((dimension) =>
    constraintCoverageRelation(source[dimension], target[dimension]),
  );
  if (relations.includes('disjoint')) return 'disjoint';
  if (relations.every((relation) => relation === 'covered')) return 'covered';
  return 'ambiguous';
}

/**
 * 在**明确覆盖多个 role 的 applicability** 下共享一条观测/证据。
 * 必须核对完整 8 维（含 entry 维）：语言/lexeme 不匹配、role 未显式覆盖、目标未知、
 * 证据未覆盖真实 target ID、或同 role 有多条无法唯一确定时，默认不应用（返回 uncoveredRoles）。
 * 即使只有单条候选，也必须逐维证明证据覆盖目标，不猜测、不取 first。
 */
export function shareRoleEvidence(
  registry: IdentityRegistry,
  lexemeId: string,
  input: ShareRoleEvidenceInput,
): ShareRoleEvidenceResult {
  const lexeme = getLexeme(registry, lexemeId);
  const scope = input.applicability;
  const roleConstraint = scope.role;
  const roleCovered = (role: GrammarRole): boolean => {
    if (roleConstraint.kind === 'explicit-all') return roleConstraint.evidence.length > 0;
    if (roleConstraint.kind === 'known') return roleConstraint.values.includes(role);
    return false;
  };
  const roleUncovered = input.roles.filter((role) => !roleCovered(role));
  // 全部维度必须显式；unknown 不能扩大为覆盖。
  const allExplicit = SCOPE_DIMENSIONS.every((dimension) => isExplicitConstraint(scope[dimension]));
  const languageOk =
    scope.language.kind === 'explicit-all'
      ? scope.language.evidence.length > 0
      : scope.language.kind === 'known' &&
        lexeme !== undefined &&
        scope.language.values.includes(lexeme.language);
  const lexemeOk =
    scope.lexeme.kind === 'explicit-all'
      ? scope.lexeme.evidence.length > 0
      : scope.lexeme.kind === 'known' && scope.lexeme.values.includes(lexemeId);
  if (!allExplicit || !languageOk || !lexemeOk || roleUncovered.length > 0) {
    return {
      registry,
      entryIds: [],
      uncoveredRoles: [...new Set([...roleUncovered, ...input.roles])],
    };
  }
  if (input.evidenceRefs.length === 0) {
    throw new Error('shareRoleEvidence: 共享证据必须带来源证据引用');
  }

  // 逐 role 唯一确定目标条目；每条候选（含唯一候选）都必须逐维证明证据覆盖真实 target。
  const chosen: string[] = [];
  const uncovered: GrammarRole[] = [];
  for (const role of input.roles) {
    const candidates = listEntries(registry).filter(
      (entry) =>
        entry.status === 'active' &&
        entry.lexemeId === lexemeId &&
        entry.grammarRoles.includes(role),
    );
    const classified = candidates.map((entry) => ({
      entry,
      relation: classifyShareCoverage(scope, entry, role),
    }));
    const covered = classified.filter((item) => item.relation === 'covered');
    const othersDisjoint = classified
      .filter((item) => item.relation !== 'covered')
      .every((item) => item.relation === 'disjoint');
    const onlyCovered = covered[0];
    if (covered.length === 1 && onlyCovered !== undefined && othersDisjoint) {
      chosen.push(onlyCovered.entry.id);
    } else {
      uncovered.push(role);
    }
  }
  if (uncovered.length > 0) {
    return { registry, entryIds: [], uncoveredRoles: uncovered };
  }

  let next = registry;
  const entryIds: string[] = [];
  for (const entryId of chosen) {
    const entry = getEntry(next, entryId);
    if (entry === undefined) continue;
    const sharedObservations = [
      ...new Set([...(entry.sharedObservationIds ?? []), input.observationId]),
    ];
    const evidenceRefs = [...new Set([...entry.evidenceRefs, ...input.evidenceRefs])];
    const updated: IdentityEntryRecord = {
      ...entry,
      sharedObservationIds: sharedObservations,
      evidenceRefs,
    };
    next = { ...next, byId: { ...next.byId, [entry.id]: updated } };
    entryIds.push(entry.id);
  }
  return { registry: next, entryIds, uncoveredRoles: [] };
}

// ---------------------------------------------------------------------------
// 范围逐维核对（merge / split 共用）
// ---------------------------------------------------------------------------

export type ScopeCompatibility = 'compatible' | 'conflict' | 'unknown';

export interface DimensionComparison {
  readonly dimension: ScopeDimension;
  readonly result: ScopeCompatibility;
  readonly detail: string;
}

/** merge/split 迁移时比较的维度；`entry` 因目标重映射而排除。 */
export const MIGRATION_DIMENSIONS: readonly ScopeDimension[] = [
  'language',
  'lexeme',
  'role',
  'pos',
  'sense',
  'accent',
  'other',
];

/**
 * 逐维比较 `left`（纠错/来源条件）能否被 `right`（目标范围）**完整覆盖**：
 * - 只有 `left` 的每个取值都落在 `right` 的 known 取值内（left ⊆ right）才 `compatible`；
 * - `right` 为 `explicit-all`（带证据）视为覆盖一切 → `compatible`；
 * - 双方 known 但取值完全不相交 → `conflict`（确定 disjoint）；
 * - 其余（任一方 unknown、`left` 为 explicit-all 而 `right` 为 known、或仅部分相交）→ `unknown`
 *   （既非完整覆盖也非确定 disjoint，不得据此迁移，也不得据此宣称唯一）。
 * 交集非空**不等于**完整覆盖，避免迁移放大或缩小未覆盖条件。
 */
export function evaluateScopeCompatibility(
  left: ApplicabilityScope,
  right: ApplicabilityScope,
  dimensions: readonly ScopeDimension[] = MIGRATION_DIMENSIONS,
): readonly DimensionComparison[] {
  return dimensions.map((dimension) => {
    const leftConstraint = left[dimension];
    const rightConstraint = right[dimension];
    if (leftConstraint.kind === 'unknown' || rightConstraint.kind === 'unknown') {
      return {
        dimension,
        result: 'unknown' as const,
        detail: `${leftConstraint.kind}/${rightConstraint.kind}`,
      };
    }
    if (rightConstraint.kind === 'explicit-all') {
      return { dimension, result: 'compatible' as const, detail: '目标明确全范围覆盖' };
    }
    if (leftConstraint.kind === 'explicit-all') {
      // 目标为 known，无法保证覆盖来源声明的全范围。
      return {
        dimension,
        result: 'unknown' as const,
        detail: '来源 explicit-all 无法由目标 known 覆盖',
      };
    }
    const rightValues = new Set(rightConstraint.values);
    const fullyCovered = leftConstraint.values.every((value) => rightValues.has(value));
    if (fullyCovered) {
      return { dimension, result: 'compatible' as const, detail: '来源取值被目标完整覆盖' };
    }
    const overlap = leftConstraint.values.some((value) => rightValues.has(value));
    return overlap
      ? { dimension, result: 'unknown' as const, detail: '来源取值仅部分被目标覆盖' }
      : { dimension, result: 'conflict' as const, detail: 'known 取值确定不相交' };
  });
}

export function overallScopeResult(
  comparisons: readonly DimensionComparison[],
): ScopeCompatibility {
  if (comparisons.some((item) => item.result === 'conflict')) return 'conflict';
  if (comparisons.some((item) => item.result === 'unknown')) return 'unknown';
  return 'compatible';
}

/** 旧纠错/规则的条目范围记录；范围未归属时保持 unresolved。 */
export interface CorrectionScopeRecord {
  readonly correctionId: string;
  readonly targetEntryId: string;
  /** 完整八维适用范围；迁移须逐维核对。 */
  readonly scope: ApplicabilityScope;
  readonly fingerprint: string;
}

export interface CorrectionMigrationDecision {
  readonly migrate: boolean;
  readonly reason: string;
  readonly dimensions: readonly DimensionComparison[];
}

/** 迁移核对回调（bounded API）；默认不迁。 */
export type CorrectionScopeMatcher = (
  correction: CorrectionScopeRecord,
  targetScope: ApplicabilityScope | undefined,
) => CorrectionMigrationDecision;

/**
 * 默认迁移核对：要求所有比较维度都为 known 且兼容，完整可证才迁移；
 * 缺目标范围/未知/冲突一律不迁。后续 3.1 matcher 可替换。
 */
export const defaultCorrectionScopeMatcher: CorrectionScopeMatcher = (correction, targetScope) => {
  if (targetScope === undefined) {
    return { migrate: false, reason: '缺少可比对的目标范围，保持 unresolved', dimensions: [] };
  }
  const dimensions = evaluateScopeCompatibility(correction.scope, targetScope);
  const overall = overallScopeResult(dimensions);
  return {
    migrate: overall === 'compatible',
    reason: `范围逐维核对结果：${overall}`,
    dimensions,
  };
};

// ---------------------------------------------------------------------------
// merge / split 审计式生命周期
// ---------------------------------------------------------------------------

export interface CorrectionMigrationOutcome {
  readonly correctionId: string;
  readonly migrate: boolean;
  readonly reason: string;
  readonly dimensions: readonly DimensionComparison[];
  /** 迁移前旧 target / scope / fingerprint，历史审计必须保留。 */
  readonly previousTargetEntryId: string;
  readonly previousScope: ApplicabilityScope;
  readonly previousFingerprint: string;
  /** 迁移后目标；未迁移时等于 previousTargetEntryId。 */
  readonly resultingTargetEntryId: string;
}

export interface IdentityAuditRecord {
  readonly action: 'merge' | 'split';
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly fromIds: readonly string[];
  readonly toIds: readonly string[];
  readonly migratedCorrectionIds: readonly string[];
  readonly unresolvedCorrectionIds: readonly string[];
  /** 逐条迁移决定（含旧 scope/target/fingerprint），持久保存不依赖临时返回。 */
  readonly decisions: readonly CorrectionMigrationOutcome[];
}

export interface IdentityChangeResult {
  readonly registry: IdentityRegistry;
  readonly corrections: readonly CorrectionScopeRecord[];
  readonly audit: IdentityAuditRecord;
}

export interface MergeInput {
  readonly canonicalId: string;
  readonly mergedIds: readonly string[];
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface MergeOptions {
  readonly matcher?: CorrectionScopeMatcher;
}

export interface MergeResult extends IdentityChangeResult {
  readonly decisions: readonly CorrectionMigrationOutcome[];
}

/**
 * 有据重映射迁移纠错的 `scope.entry`：仅当旧 entry 约束恰为单个旧 ID 时替换为新 ID，
 * 其他维度原样保留；多值或非 known 无法唯一确定 → undefined（不迁移）。
 */
function remapCorrectionEntryScope(
  scope: ApplicabilityScope,
  oldEntryId: string,
  newEntryId: string,
): ApplicabilityScope | undefined {
  const entry = scope.entry;
  if (entry.kind !== 'known' || entry.values.length !== 1 || entry.values[0] !== oldEntryId) {
    return undefined;
  }
  return { ...scope, entry: { kind: 'known', values: [newEntryId] } };
}

/**
 * split 持久化 successor applicability：`entry` 必须为单个旧 predecessor ID，
 * 持久时重映射为新 successor ID（其他维度原样）；非 single old → fail closed（throw）。
 * 并核对 language/lexeme/role/POS 与 successor 权威字段不矛盾。
 */
function persistSuccessorScope(
  scope: ApplicabilityScope,
  predecessorId: string,
  successorId: string,
  authoritative: {
    readonly language: string;
    readonly lexemeId?: string;
    readonly role: GrammarRole;
    readonly partOfSpeech?: string;
  },
): ApplicabilityScope {
  const entry = scope.entry;
  if (entry.kind !== 'known' || entry.values.length !== 1 || entry.values[0] !== predecessorId) {
    throw new Error(
      'splitEntry: successor.applicability.entry 必须是单个旧 predecessor ID，才能唯一重映射',
    );
  }
  const knownExcludes = (constraint: ScopeConstraint, value: string): boolean =>
    constraint.kind === 'known' && !constraint.values.includes(value);
  if (knownExcludes(scope.language, authoritative.language)) {
    throw new Error('splitEntry: successor.applicability.language 与 successor 权威语言矛盾');
  }
  if (authoritative.lexemeId !== undefined && knownExcludes(scope.lexeme, authoritative.lexemeId)) {
    throw new Error('splitEntry: successor.applicability.lexeme 与 successor 权威 lexeme 矛盾');
  }
  if (knownExcludes(scope.role, authoritative.role)) {
    throw new Error('splitEntry: successor.applicability.role 与 successor 权威 role 矛盾');
  }
  if (
    authoritative.partOfSpeech !== undefined &&
    knownExcludes(scope.pos, authoritative.partOfSpeech)
  ) {
    throw new Error('splitEntry: successor.applicability.pos 与 successor 权威 POS 矛盾');
  }
  return { ...scope, entry: { kind: 'known', values: [successorId] } };
}

/**
 * 有据合并：保留一个 canonical ID，其余变为带审计原因的 redirect。
 * 纠错迁移要求 `scope.entry` 可唯一重映射，且完整范围被 canonical 完整覆盖才迁移；
 * 冲突/未知/仅部分相交/多值 entry 都不迁移；旧 scope/target/fingerprint 与 decisions 持久保留。
 * 不因 canonical 唯一就迁移，也不借 merge 绕过审批。
 */
export function mergeEntries(
  registry: IdentityRegistry,
  corrections: readonly CorrectionScopeRecord[],
  input: MergeInput,
  options: MergeOptions = {},
): MergeResult {
  if (!hasValidEvidence(input.evidenceRefs)) {
    throw new Error('mergeEntries: 合并必须有身份证据');
  }
  if (input.reason.trim().length === 0 || input.mergedIds.length === 0) {
    throw new Error('mergeEntries: 合并必须有原因');
  }
  const canonical = getEntry(registry, input.canonicalId);
  if (canonical?.status !== 'active') {
    throw new Error(`mergeEntries: canonical 条目不存在或非 active：${input.canonicalId}`);
  }
  if (input.mergedIds.includes(input.canonicalId)) {
    throw new Error('mergeEntries: canonical 不能同时作为被合并条目');
  }
  const mergedSet = new Set(input.mergedIds);
  const byId = { ...registry.byId };
  for (const mergedId of input.mergedIds) {
    const merged = getEntry(registry, mergedId);
    if (merged?.status !== 'active') {
      throw new Error(`mergeEntries: 被合并条目不存在或非 active：${mergedId}`);
    }
    byId[mergedId] = {
      ...merged,
      status: 'retired',
      redirectTo: input.canonicalId,
      retiredReason: input.reason,
      evidenceRefs: [...merged.evidenceRefs, ...input.evidenceRefs],
    };
  }

  const migratedCorrectionIds: string[] = [];
  const unresolvedCorrectionIds: string[] = [];
  const decisions: CorrectionMigrationOutcome[] = [];
  const nextCorrections = corrections.map((correction) => {
    if (!mergedSet.has(correction.targetEntryId)) return correction;
    const previousTargetEntryId = correction.targetEntryId;
    const base = {
      correctionId: correction.correctionId,
      previousTargetEntryId,
      previousScope: correction.scope,
      previousFingerprint: correction.fingerprint,
    };
    const remappedScope = remapCorrectionEntryScope(
      correction.scope,
      previousTargetEntryId,
      input.canonicalId,
    );
    if (remappedScope === undefined) {
      unresolvedCorrectionIds.push(correction.correctionId);
      decisions.push({
        ...base,
        migrate: false,
        reason: 'scope.entry 非单一旧条目，无法唯一重映射，保持 unresolved',
        dimensions: [],
        resultingTargetEntryId: previousTargetEntryId,
      });
      return correction;
    }
    // 内部 default gate 是下限：注入 matcher 只能收紧，不能放宽。
    const internalDecision = defaultCorrectionScopeMatcher(
      { ...correction, scope: remappedScope },
      canonical.applicability,
    );
    if (!internalDecision.migrate) {
      unresolvedCorrectionIds.push(correction.correctionId);
      decisions.push({
        ...base,
        migrate: false,
        reason: internalDecision.reason,
        dimensions: internalDecision.dimensions,
        resultingTargetEntryId: previousTargetEntryId,
      });
      return correction;
    }
    const decision = options.matcher
      ? options.matcher({ ...correction, scope: remappedScope }, canonical.applicability)
      : internalDecision;
    if (!decision.migrate) {
      unresolvedCorrectionIds.push(correction.correctionId);
      decisions.push({
        ...base,
        migrate: false,
        reason: decision.reason,
        dimensions: decision.dimensions,
        resultingTargetEntryId: previousTargetEntryId,
      });
      return correction;
    }
    migratedCorrectionIds.push(correction.correctionId);
    decisions.push({
      ...base,
      migrate: true,
      reason: decision.reason,
      dimensions: decision.dimensions,
      resultingTargetEntryId: input.canonicalId,
    });
    return { ...correction, targetEntryId: input.canonicalId, scope: remappedScope };
  });

  const audit: IdentityAuditRecord = {
    action: 'merge',
    reason: input.reason,
    evidenceRefs: [...input.evidenceRefs],
    fromIds: [...input.mergedIds],
    toIds: [input.canonicalId],
    migratedCorrectionIds,
    unresolvedCorrectionIds,
    decisions,
  };

  const sourceAliases = registry.sourceAliases.map((alias) =>
    mergedSet.has(alias.entryId) ? { ...alias, status: 'historical' as const } : alias,
  );

  return {
    registry: { ...registry, byId, sourceAliases, history: [...(registry.history ?? []), audit] },
    corrections: nextCorrections,
    decisions,
    audit,
  };
}

export interface SplitSuccessorInput {
  readonly role: GrammarRole;
  readonly scope: ApplicabilityScope;
  readonly evidenceRefs: readonly string[];
  readonly id?: string;
  readonly partOfSpeech?: string;
}

export interface SplitInput {
  readonly entryId: string;
  readonly successors: readonly SplitSuccessorInput[];
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface SplitResult extends IdentityChangeResult {
  readonly successorIds: readonly string[];
  readonly decisions: readonly CorrectionMigrationOutcome[];
}

/**
 * 一对多拆分：原条目 retired 并记录 successorIds（不伪装成普通 redirect）。
 * 纠错仅在其完整范围被**恰一个**后继完整覆盖、且**其他后继均确定 disjoint**、
 * 且 `scope.entry` 可唯一重映射时才迁移；否则 unresolved，不自动复制。
 */
export function splitEntry(
  registry: IdentityRegistry,
  corrections: readonly CorrectionScopeRecord[],
  input: SplitInput,
  factory: IdentityIdFactory = defaultIdentityIdFactory,
): SplitResult {
  if (!hasValidEvidence(input.evidenceRefs) || input.reason.trim().length === 0) {
    throw new Error('splitEntry: 拆分必须有身份证据');
  }
  if (input.successors.length < 2) {
    throw new Error('splitEntry: 拆分至少需要两个后继');
  }
  const original = getEntry(registry, input.entryId);
  if (original?.status !== 'active') {
    throw new Error(`splitEntry: 原条目不存在或非 active：${input.entryId}`);
  }

  let next = registry;
  const successorIds: string[] = [];
  for (const successor of input.successors) {
    // 先铸造 successor ID，以便把 applicability.entry 从旧 predecessor 重映射为新 ID。
    const successorId = successor.id ?? factory('entry');
    const successorPos = successor.partOfSpeech ?? original.partOfSpeech;
    const applicability = persistSuccessorScope(successor.scope, input.entryId, successorId, {
      language: original.language,
      ...(original.lexemeId === undefined ? {} : { lexemeId: original.lexemeId }),
      role: successor.role,
      ...(successorPos === undefined ? {} : { partOfSpeech: successorPos }),
    });
    const created = createEntry(
      next,
      {
        language: original.language,
        exactSpelling: original.exactSpelling,
        grammarRoles: [successor.role],
        ...(original.lexemeId === undefined ? {} : { lexemeId: original.lexemeId }),
        evidenceRefs: successor.evidenceRefs,
        applicability,
        id: successorId,
        ...(successorPos === undefined ? {} : { partOfSpeech: successorPos }),
        ...(original.synthetic === undefined ? {} : { synthetic: original.synthetic }),
      },
      factory,
    );
    next = created.registry;
    successorIds.push(created.entryId);
  }
  const byId = { ...next.byId };
  byId[input.entryId] = {
    ...original,
    status: 'retired',
    successorIds,
    retiredReason: input.reason,
    evidenceRefs: [...original.evidenceRefs, ...input.evidenceRefs],
  };

  const migratedCorrectionIds: string[] = [];
  const unresolvedCorrectionIds: string[] = [];
  const decisions: CorrectionMigrationOutcome[] = [];
  const nextCorrections = corrections.map((correction) => {
    if (correction.targetEntryId !== input.entryId) return correction;
    const previousTargetEntryId = correction.targetEntryId;
    const base = {
      correctionId: correction.correctionId,
      previousTargetEntryId,
      previousScope: correction.scope,
      previousFingerprint: correction.fingerprint,
    };
    const relations = input.successors.map((successor, index) => ({
      index,
      relation: overallScopeResult(evaluateScopeCompatibility(correction.scope, successor.scope)),
      evidenceOk: successor.evidenceRefs.length > 0,
    }));
    const allDimensions = input.successors.flatMap((successor) => [
      ...evaluateScopeCompatibility(correction.scope, successor.scope),
    ]);
    const covering = relations.filter((item) => item.relation === 'compatible' && item.evidenceOk);

    const unresolved = (reason: string) => {
      unresolvedCorrectionIds.push(correction.correctionId);
      decisions.push({
        ...base,
        migrate: false,
        reason,
        dimensions: allDimensions,
        resultingTargetEntryId: previousTargetEntryId,
      });
      return correction;
    };

    if (covering.length === 0) {
      return unresolved('无完整覆盖且唯一有据的后继，保持 unresolved');
    }
    if (covering.length > 1) {
      return unresolved('多个后继完整覆盖，无法唯一确定，保持 unresolved');
    }
    const candidate = covering[0];
    if (candidate === undefined) {
      return unresolved('无完整覆盖且唯一有据的后继，保持 unresolved');
    }
    // 唯一覆盖者之外，其他后继必须**确定 disjoint**，否则可能同样匹配。
    const othersDisjoint = relations.every(
      (item) => item.index === candidate.index || item.relation === 'conflict',
    );
    if (!othersDisjoint) {
      return unresolved('其他后继未被确定为 disjoint，无法唯一确定，保持 unresolved');
    }
    const successorId = successorIds[candidate.index];
    const remappedScope =
      successorId === undefined
        ? undefined
        : remapCorrectionEntryScope(correction.scope, previousTargetEntryId, successorId);
    if (successorId === undefined || remappedScope === undefined) {
      return unresolved('scope.entry 非单一旧条目，无法唯一重映射，保持 unresolved');
    }
    migratedCorrectionIds.push(correction.correctionId);
    decisions.push({
      ...base,
      migrate: true,
      reason: '完整覆盖且其他后继确定 disjoint，唯一有据',
      dimensions: allDimensions,
      resultingTargetEntryId: successorId,
    });
    return { ...correction, targetEntryId: successorId, scope: remappedScope };
  });

  const audit: IdentityAuditRecord = {
    action: 'split',
    reason: input.reason,
    evidenceRefs: [...input.evidenceRefs],
    fromIds: [input.entryId],
    toIds: successorIds,
    migratedCorrectionIds,
    unresolvedCorrectionIds,
    decisions,
  };

  // 旧 alias 指向被 retired 的原条目 → 显式历史状态（保留 locator 可追溯），不删除。
  const sourceAliases = next.sourceAliases.map((alias) =>
    alias.entryId === input.entryId ? { ...alias, status: 'historical' as const } : alias,
  );

  return {
    registry: { ...next, byId, sourceAliases, history: [...(next.history ?? []), audit] },
    corrections: nextCorrections,
    successorIds,
    decisions,
    audit,
  };
}

// ---------------------------------------------------------------------------
// JSON 持久往返
// ---------------------------------------------------------------------------

export function serializeIdentityRegistry(registry: IdentityRegistry): string {
  return JSON.stringify(registry);
}

/** 从 JSON 恢复注册表；调用方应随后用 `validateIdentityRegistry` 校验。 */
export function deserializeIdentityRegistry(json: string): IdentityRegistry {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('deserializeIdentityRegistry: 顶层必须是对象');
  }
  return parsed as IdentityRegistry;
}

// ---------------------------------------------------------------------------
// 注册表校验（对未知数据稳健，不 throw）
// ---------------------------------------------------------------------------

function pushIssue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isValidGrammarRole(value: unknown): value is GrammarRole {
  return value === 'base' || value === 'present' || value === 'past' || value === 'past-participle';
}

/**
 * 校验注册表结构与生命周期不变量，对任意未知输入都稳健返回（不 throw）：
 * byId 类型/ID/语言、entry.lexemeId 双向、redirect 循环/悬垂、successor 悬垂、
 * 别名引用与定位，缺字段一律 invalid。
 */
export function validateIdentityRegistry(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      valid: false,
      issues: [{ path: '$', code: 'registry-required', message: '注册表必须是对象' }],
    };
  }
  const registry = value as Partial<IdentityRegistry>;
  if (registry.schema !== PRONUNCIATION_SCHEMA.identity) {
    pushIssue(
      issues,
      '$.schema',
      'schema-version',
      `schema 必须为 ${PRONUNCIATION_SCHEMA.identity}`,
    );
  }
  const byIdValue: unknown = registry.byId;
  if (typeof byIdValue !== 'object' || byIdValue === null || Array.isArray(byIdValue)) {
    pushIssue(issues, '$.byId', 'registry-by-id', 'byId 必须是对象，且必须存在');
    return { valid: false, issues };
  }
  const byId = byIdValue as Record<string, unknown>;
  const entryIds = new Set<string>();
  const lexemeIds = new Set<string>();

  for (const [key, record] of Object.entries(byId)) {
    if (!isOpaqueIdFormat(key)) {
      pushIssue(issues, `$.byId.${key}`, 'invalid-id', 'byId 键必须是不透明 ID');
    }
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      pushIssue(issues, `$.byId.${key}`, 'invalid-record', '记录必须是对象');
      continue;
    }
    const item = record as Record<string, unknown>;
    if (item['id'] !== key) {
      pushIssue(issues, `$.byId.${key}.id`, 'id-mismatch', '记录 id 必须与键一致');
    }
    // kind 前缀严格：ent_ 键必须是 entry，lex_ 键必须是 lexeme。
    if (key.startsWith('ent_') && item['kind'] !== 'entry') {
      pushIssue(
        issues,
        `$.byId.${key}.kind`,
        'kind-prefix-mismatch',
        'ent_ 前缀键的 kind 必须是 entry',
      );
    }
    if (key.startsWith('lex_') && item['kind'] !== 'lexeme') {
      pushIssue(
        issues,
        `$.byId.${key}.kind`,
        'kind-prefix-mismatch',
        'lex_ 前缀键的 kind 必须是 lexeme',
      );
    }
    if (item['kind'] === 'entry') {
      entryIds.add(key);
      if (typeof item['language'] !== 'string' || item['language'] === '') {
        pushIssue(issues, `$.byId.${key}.language`, 'entry-language', 'language 不能为空');
      }
      if (typeof item['exactSpelling'] !== 'string' || item['exactSpelling'] === '') {
        pushIssue(
          issues,
          `$.byId.${key}.exactSpelling`,
          'entry-spelling',
          'exactSpelling 不能为空',
        );
      }
      const aliases = item['aliases'];
      if (
        !Array.isArray(aliases) ||
        aliases.some((alias) => typeof alias !== 'string' || alias.trim() === '')
      ) {
        pushIssue(issues, `$.byId.${key}.aliases`, 'entry-aliases', 'aliases 必须是字符串数组');
      }
      const roles = item['grammarRoles'];
      if (!Array.isArray(roles) || roles.some((role) => !isValidGrammarRole(role))) {
        pushIssue(
          issues,
          `$.byId.${key}.grammarRoles`,
          'entry-roles',
          'grammarRoles 必须是合法角色数组',
        );
      }
      const status = item['status'];
      if (status !== 'active' && status !== 'retired') {
        pushIssue(issues, `$.byId.${key}.status`, 'entry-status', 'status 必须是 active | retired');
      }
      const evidenceRefs = item['evidenceRefs'];
      if (
        !Array.isArray(evidenceRefs) ||
        evidenceRefs.some((ref) => typeof ref !== 'string' || ref.trim() === '')
      ) {
        pushIssue(
          issues,
          `$.byId.${key}.evidenceRefs`,
          'entry-evidence',
          'evidenceRefs 必须是字符串数组',
        );
      }
      const successorIds = item['successorIds'];
      if (!Array.isArray(successorIds) || successorIds.some((id) => typeof id !== 'string')) {
        pushIssue(
          issues,
          `$.byId.${key}.successorIds`,
          'entry-successors',
          'successorIds 必须是字符串数组',
        );
      }
      if (Array.isArray(successorIds) && new Set(successorIds).size !== successorIds.length) {
        pushIssue(issues, `$.byId.${key}.successorIds`, 'duplicate-successor', '后继不得重复');
      }
      if (item['synthetic'] !== undefined && typeof item['synthetic'] !== 'boolean') {
        pushIssue(issues, `$.byId.${key}.synthetic`, 'entry-synthetic', 'synthetic 必须是布尔值');
      }
      const lexemeId = item['lexemeId'];
      if (lexemeId !== undefined && (typeof lexemeId !== 'string' || !isOpaqueIdFormat(lexemeId))) {
        pushIssue(issues, `$.byId.${key}.lexemeId`, 'invalid-id', 'lexemeId 必须是不透明 ID');
      } else if (typeof lexemeId === 'string' && !lexemeId.startsWith('lex_')) {
        pushIssue(issues, `$.byId.${key}.lexemeId`, 'invalid-id', 'lexemeId 必须是 lex_ 前缀');
      }
      // 可选数组字段：存在时必须为字符串数组。
      for (const arrayKey of ['sharedObservationIds', 'displayIpaRefs'] as const) {
        const arrayValue = item[arrayKey];
        if (
          arrayValue !== undefined &&
          (!Array.isArray(arrayValue) || arrayValue.some((entry) => typeof entry !== 'string'))
        ) {
          pushIssue(
            issues,
            `$.byId.${key}.${arrayKey}`,
            'entry-array',
            `${arrayKey} 必须是字符串数组`,
          );
        }
      }
      // 可选 applicability：形状非法即拒。
      if (item['applicability'] !== undefined) {
        validateApplicabilityScope(item['applicability'], `$.byId.${key}.applicability`, issues);
      }
    } else if (item['kind'] === 'lexeme') {
      lexemeIds.add(key);
      if (typeof item['language'] !== 'string' || item['language'] === '') {
        pushIssue(issues, `$.byId.${key}.language`, 'lexeme-language', 'language 不能为空');
      }
      if (item['synthetic'] !== undefined && typeof item['synthetic'] !== 'boolean') {
        pushIssue(
          issues,
          `$.byId.${key}.synthetic`,
          'lexeme-synthetic',
          'synthetic 若存在必须是布尔值',
        );
      }
    } else {
      pushIssue(issues, `$.byId.${key}.kind`, 'invalid-kind', 'kind 必须是 entry | lexeme');
    }
  }

  // 引用与生命周期不变量
  for (const [key, record] of Object.entries(byId)) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) continue;
    const item = record as Record<string, unknown>;
    if (item['kind'] !== 'entry') continue;
    const lexemeId = item['lexemeId'];
    if (typeof lexemeId === 'string' && !lexemeIds.has(lexemeId)) {
      pushIssue(
        issues,
        `$.byId.${key}.lexemeId`,
        'dangling-reference',
        `lexeme 不存在 ${lexemeId}`,
      );
    } else if (typeof lexemeId === 'string') {
      // entry 必须与所属 lexeme 的 language / synthetic class 一致（缺省视为 false）。
      const lexemeRecord = byId[lexemeId];
      if (typeof lexemeRecord === 'object' && lexemeRecord !== null) {
        const lexeme = lexemeRecord as Record<string, unknown>;
        if (
          typeof item['language'] === 'string' &&
          typeof lexeme['language'] === 'string' &&
          item['language'] !== lexeme['language']
        ) {
          pushIssue(
            issues,
            `$.byId.${key}.language`,
            'lexeme-language-mismatch',
            'entry 语言必须与所属 lexeme 一致',
          );
        }
        if ((item['synthetic'] ?? false) !== (lexeme['synthetic'] ?? false)) {
          pushIssue(
            issues,
            `$.byId.${key}.synthetic`,
            'lexeme-synthetic-mismatch',
            'entry 与所属 lexeme 的 synthetic 必须一致',
          );
        }
      }
    }
    const successorIds = item['successorIds'];
    if (Array.isArray(successorIds)) {
      successorIds.forEach((successorId, index) => {
        if (typeof successorId === 'string' && !entryIds.has(successorId)) {
          pushIssue(
            issues,
            `$.byId.${key}.successorIds[${String(index)}]`,
            'dangling-reference',
            `后继不存在 ${successorId}`,
          );
        }
      });
    }
    const redirectTo = item['redirectTo'];
    if (redirectTo !== undefined && (typeof redirectTo !== 'string' || !entryIds.has(redirectTo))) {
      const redirectLabel = typeof redirectTo === 'string' ? redirectTo : '(非字符串)';
      pushIssue(
        issues,
        `$.byId.${key}.redirectTo`,
        'dangling-reference',
        `redirect 目标不存在 ${redirectLabel}`,
      );
    }
    const status = item['status'];
    const hasRedirect = typeof redirectTo === 'string';
    const hasSuccessors = Array.isArray(successorIds) && successorIds.length > 0;
    const retiredReason = item['retiredReason'];
    if (status === 'active') {
      // active 条目不得携带 redirect / successor / retiredReason。
      if (hasRedirect) {
        pushIssue(
          issues,
          `$.byId.${key}.redirectTo`,
          'active-has-redirect',
          'active 条目不得带 redirectTo',
        );
      }
      if (hasSuccessors) {
        pushIssue(
          issues,
          `$.byId.${key}.successorIds`,
          'active-has-successors',
          'active 条目不得带 successorIds',
        );
      }
      if (retiredReason !== undefined) {
        pushIssue(
          issues,
          `$.byId.${key}.retiredReason`,
          'active-has-retired-reason',
          'active 条目不得带 retiredReason',
        );
      }
    } else if (status === 'retired') {
      // 目标必须二选一互斥；链式 redirect 到 retired 仍可追溯，但不得指向 split 一对多。
      if (hasRedirect === hasSuccessors) {
        pushIssue(
          issues,
          `$.byId.${key}`,
          'retired-exclusive-target',
          '被停用条目必须恰好带 redirectTo 或 successorIds 之一',
        );
      }
      if (typeof retiredReason !== 'string' || retiredReason.trim() === '') {
        pushIssue(
          issues,
          `$.byId.${key}.retiredReason`,
          'retired-reason-required',
          '被停用条目必须给出 retiredReason',
        );
      }
      if (typeof redirectTo === 'string') {
        const targetRecord = byId[redirectTo];
        if (
          typeof targetRecord === 'object' &&
          targetRecord !== null &&
          (targetRecord as Record<string, unknown>)['status'] === 'retired' &&
          Array.isArray((targetRecord as Record<string, unknown>)['successorIds']) &&
          ((targetRecord as Record<string, unknown>)['successorIds'] as unknown[]).length > 0
        ) {
          pushIssue(
            issues,
            `$.byId.${key}.redirectTo`,
            'redirect-to-successor-set',
            'redirect 不得指向 split 的一对多目标（不得把一对多伪装成普通 redirect）',
          );
        }
      }
    }
  }

  // redirect 循环检测
  for (const startId of entryIds) {
    const visited = new Set<string>();
    let current: string | undefined = startId;
    while (current !== undefined) {
      if (visited.has(current)) {
        pushIssue(
          issues,
          `$.byId.${startId}.redirectTo`,
          'redirect-cycle',
          `redirect 循环：${current}`,
        );
        break;
      }
      visited.add(current);
      const currentRecord: unknown = byId[current];
      const redirectValue: unknown =
        typeof currentRecord === 'object' && currentRecord !== null
          ? (currentRecord as Record<string, unknown>)['redirectTo']
          : undefined;
      current = typeof redirectValue === 'string' ? redirectValue : undefined;
    }
  }

  // successor 链循环检测（DFS 三色，避免把 DAG 误判为环）。
  const successorColor = new Map<string, 0 | 1 | 2>();
  const visitSuccessors = (id: string): boolean => {
    const color = successorColor.get(id) ?? 0;
    if (color === 1) return true;
    if (color === 2) return false;
    successorColor.set(id, 1);
    const record: unknown = byId[id];
    const successors =
      typeof record === 'object' && record !== null
        ? (record as Record<string, unknown>)['successorIds']
        : undefined;
    if (Array.isArray(successors)) {
      for (const successor of successors) {
        if (
          typeof successor === 'string' &&
          entryIds.has(successor) &&
          visitSuccessors(successor)
        ) {
          successorColor.set(id, 2);
          return true;
        }
      }
    }
    successorColor.set(id, 2);
    return false;
  };
  for (const startId of entryIds) {
    if (visitSuccessors(startId)) {
      pushIssue(
        issues,
        `$.byId.${startId}.successorIds`,
        'successor-cycle',
        `successor 链出现循环，涉及 ${startId}`,
      );
      break;
    }
  }

  // 来源别名
  const sourceAliases = registry.sourceAliases;
  if (!Array.isArray(sourceAliases)) {
    pushIssue(issues, '$.sourceAliases', 'aliases-required', 'sourceAliases 必须是数组');
  } else {
    const locatorToEntry = new Map<string, string>();
    sourceAliases.forEach((alias, index) => {
      const path = `$.sourceAliases[${String(index)}]`;
      if (typeof alias !== 'object' || alias === null || Array.isArray(alias)) {
        pushIssue(issues, path, 'alias-record', '别名必须是对象');
        return;
      }
      const item = alias as Record<string, unknown>;
      for (const field of ['sourceSite', 'language', 'pageSpelling']) {
        if (typeof item[field] !== 'string' || item[field] === '') {
          pushIssue(issues, `${path}.${field}`, 'alias-field', `${field} 不能为空`);
        }
      }
      const status = item['status'];
      if (status !== 'confirmed' && status !== 'pending-review' && status !== 'historical') {
        pushIssue(
          issues,
          `${path}.status`,
          'alias-status',
          'status 必须是 confirmed | pending-review | historical',
        );
      }
      // 所有状态：evidenceRefs 必须是非空数组，且每项为 trim 非空字符串。
      const evidenceRefs = item['evidenceRefs'];
      const evidenceValid =
        Array.isArray(evidenceRefs) &&
        evidenceRefs.length > 0 &&
        evidenceRefs.every((ref) => typeof ref === 'string' && ref.trim() !== '');
      if (!evidenceValid) {
        pushIssue(
          issues,
          `${path}.evidenceRefs`,
          'alias-evidence',
          'evidenceRefs 必须是非空数组且每项为非空白字符串',
        );
      }
      // role 若存在必须合法；scopePath 若存在必须是字符串数组。
      if (item['role'] !== undefined && !isValidGrammarRole(item['role'])) {
        pushIssue(issues, `${path}.role`, 'alias-role', 'role 若存在必须是合法 grammar role');
      }
      if (
        item['scopePath'] !== undefined &&
        (!Array.isArray(item['scopePath']) ||
          item['scopePath'].some((segment) => typeof segment !== 'string'))
      ) {
        pushIssue(
          issues,
          `${path}.scopePath`,
          'alias-scope-path',
          'scopePath 若存在必须是字符串数组',
        );
      }
      const entryId = item['entryId'];
      if (typeof entryId !== 'string' || !entryIds.has(entryId)) {
        pushIssue(issues, `${path}.entryId`, 'dangling-reference', '别名 entryId 不存在');
      } else {
        // locator language/role 必须与目标身份兼容（en alias 不得指向 de entry）。
        const entryRecord = byId[entryId];
        if (typeof entryRecord === 'object' && entryRecord !== null) {
          const entry = entryRecord as Record<string, unknown>;
          if (
            typeof entry['language'] === 'string' &&
            typeof item['language'] === 'string' &&
            entry['language'] !== item['language']
          ) {
            pushIssue(
              issues,
              `${path}.language`,
              'alias-locator-incompatible',
              '别名 language 必须与目标条目一致',
            );
          }
          const role = item['role'];
          const roles = Array.isArray(entry['grammarRoles']) ? entry['grammarRoles'] : [];
          if (isValidGrammarRole(role) && !roles.includes(role)) {
            pushIssue(
              issues,
              `${path}.role`,
              'alias-locator-incompatible',
              '别名 role 必须属于目标条目的 grammarRoles',
            );
          }
          // 普通 confirmed / pending 目标必须 active；historical 允许指向 retired（审计保留）。
          if (
            (status === 'confirmed' || status === 'pending-review') &&
            entry['status'] !== 'active'
          ) {
            pushIssue(
              issues,
              `${path}.entryId`,
              'alias-target-not-active',
              'confirmed/pending 别名目标必须是 active 条目',
            );
          }
        }
      }
      // 精确 locator 重复 / 冲突。
      const anchorKey = typeof item['anchor'] === 'string' ? item['anchor'] : '';
      const roleKey = isValidGrammarRole(item['role']) ? item['role'] : '';
      const scopeKey = Array.isArray(item['scopePath']) ? item['scopePath'].join('\u0000') : '';
      const locatorKey = [
        item['sourceSite'],
        item['language'],
        item['pageSpelling'],
        anchorKey,
        roleKey,
        scopeKey,
      ].join('\u0001');
      const previousEntry = locatorToEntry.get(locatorKey);
      if (previousEntry !== undefined) {
        if (previousEntry !== entryId) {
          pushIssue(issues, path, 'alias-conflict', '同一 locator 指向不同条目');
        } else {
          pushIssue(issues, path, 'duplicate-alias', '重复的 locator');
        }
      } else {
        locatorToEntry.set(locatorKey, typeof entryId === 'string' ? entryId : '');
      }
    });
  }

  // 审计历史：深度校验 action/reason/evidence/from-to/decisions 与列表一致性。
  const history = registry.history;
  if (history !== undefined) {
    if (!Array.isArray(history)) {
      pushIssue(issues, '$.history', 'history-required', 'history 必须是数组');
    } else {
      history.forEach((entry, index) => {
        const path = `$.history[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          pushIssue(issues, path, 'history-record', 'history 项必须是对象');
          return;
        }
        const item = entry as Record<string, unknown>;
        if (item['action'] !== 'merge' && item['action'] !== 'split') {
          pushIssue(issues, `${path}.action`, 'history-action', 'action 必须是 merge | split');
        }
        if (typeof item['reason'] !== 'string' || item['reason'] === '') {
          pushIssue(issues, `${path}.reason`, 'history-reason', 'reason 不能为空');
        }
        const historyEvidence = item['evidenceRefs'];
        if (
          !Array.isArray(historyEvidence) ||
          historyEvidence.length === 0 ||
          historyEvidence.some((ref) => typeof ref !== 'string' || ref.trim() === '')
        ) {
          pushIssue(
            issues,
            `${path}.evidenceRefs`,
            'history-evidence',
            'evidenceRefs 必须是非空非空白字符串数组',
          );
        }
        const idArrayValid = (arr: unknown, label: string): void => {
          if (!Array.isArray(arr) || arr.length === 0) {
            pushIssue(issues, `${path}.${label}`, 'history-field', `${label} 必须是非空数组`);
            return;
          }
          arr.forEach((id, idIndex) => {
            if (typeof id !== 'string' || !isOpaqueIdFormat(id)) {
              pushIssue(
                issues,
                `${path}.${label}[${String(idIndex)}]`,
                'history-id',
                `${label} 项必须是不透明 ID`,
              );
            }
          });
        };
        idArrayValid(item['fromIds'], 'fromIds');
        idArrayValid(item['toIds'], 'toIds');
        const toIdSet = new Set(
          Array.isArray(item['toIds'])
            ? item['toIds'].filter((id): id is string => typeof id === 'string')
            : [],
        );
        const decisions = item['decisions'];
        const migratedFromDecisions: string[] = [];
        const unresolvedFromDecisions: string[] = [];
        if (!Array.isArray(decisions)) {
          pushIssue(issues, `${path}.decisions`, 'history-field', 'decisions 必须是数组');
        } else {
          decisions.forEach((decision, dIndex) => {
            const dPath = `${path}.decisions[${String(dIndex)}]`;
            if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) {
              pushIssue(issues, dPath, 'history-decision', 'decision 必须是对象');
              return;
            }
            const d = decision as Record<string, unknown>;
            if (typeof d['correctionId'] !== 'string' || d['correctionId'] === '') {
              pushIssue(
                issues,
                `${dPath}.correctionId`,
                'history-decision-field',
                'correctionId 必须是非空字符串',
              );
            }
            if (typeof d['migrate'] !== 'boolean') {
              pushIssue(
                issues,
                `${dPath}.migrate`,
                'history-decision-field',
                'migrate 必须是布尔值',
              );
            }
            if (
              typeof d['previousTargetEntryId'] !== 'string' ||
              !isOpaqueIdFormat(d['previousTargetEntryId'])
            ) {
              pushIssue(
                issues,
                `${dPath}.previousTargetEntryId`,
                'history-decision-field',
                'previousTargetEntryId 必须是不透明 ID',
              );
            }
            if (
              typeof d['resultingTargetEntryId'] !== 'string' ||
              !isOpaqueIdFormat(d['resultingTargetEntryId'])
            ) {
              pushIssue(
                issues,
                `${dPath}.resultingTargetEntryId`,
                'history-decision-field',
                'resultingTargetEntryId 必须是不透明 ID',
              );
            }
            if (typeof d['previousFingerprint'] !== 'string' || d['previousFingerprint'] === '') {
              pushIssue(
                issues,
                `${dPath}.previousFingerprint`,
                'history-decision-field',
                'previousFingerprint 必须是非空字符串',
              );
            }
            if (d['previousScope'] === undefined) {
              pushIssue(
                issues,
                `${dPath}.previousScope`,
                'history-decision-field',
                'previousScope 必须存在',
              );
            } else {
              validateApplicabilityScope(d['previousScope'], `${dPath}.previousScope`, issues);
            }
            const dimensions = d['dimensions'];
            if (!Array.isArray(dimensions)) {
              pushIssue(
                issues,
                `${dPath}.dimensions`,
                'history-decision-field',
                'dimensions 必须是数组',
              );
            } else {
              dimensions.forEach((dimension, dimIndex) => {
                const dimPath = `${dPath}.dimensions[${String(dimIndex)}]`;
                if (
                  typeof dimension !== 'object' ||
                  dimension === null ||
                  Array.isArray(dimension)
                ) {
                  pushIssue(issues, dimPath, 'history-dimension', 'dimension 必须是对象');
                  return;
                }
                const dd = dimension as Record<string, unknown>;
                if (!SCOPE_DIMENSIONS.includes(dd['dimension'] as ScopeDimension)) {
                  pushIssue(
                    issues,
                    `${dimPath}.dimension`,
                    'history-dimension',
                    'dimension 必须是合法维度',
                  );
                }
                if (
                  dd['result'] !== 'compatible' &&
                  dd['result'] !== 'conflict' &&
                  dd['result'] !== 'unknown'
                ) {
                  pushIssue(
                    issues,
                    `${dimPath}.result`,
                    'history-dimension',
                    'result 必须是 compatible|conflict|unknown',
                  );
                }
              });
            }
            const correctionId = typeof d['correctionId'] === 'string' ? d['correctionId'] : '';
            if (d['migrate'] === true) {
              migratedFromDecisions.push(correctionId);
              if (
                typeof d['resultingTargetEntryId'] === 'string' &&
                !toIdSet.has(d['resultingTargetEntryId'])
              ) {
                pushIssue(
                  issues,
                  `${dPath}.resultingTargetEntryId`,
                  'history-target',
                  'migrate 目标必须属于 toIds',
                );
              }
            } else if (d['migrate'] === false) {
              unresolvedFromDecisions.push(correctionId);
              if (d['resultingTargetEntryId'] !== d['previousTargetEntryId']) {
                pushIssue(
                  issues,
                  `${dPath}.resultingTargetEntryId`,
                  'history-target',
                  '未迁移时 resultingTarget 必须等于 previousTarget',
                );
              }
            }
          });
        }
        const migratedList = Array.isArray(item['migratedCorrectionIds'])
          ? (item['migratedCorrectionIds'] as unknown[]).filter(
              (value): value is string => typeof value === 'string',
            )
          : [];
        const unresolvedList = Array.isArray(item['unresolvedCorrectionIds'])
          ? (item['unresolvedCorrectionIds'] as unknown[]).filter(
              (value): value is string => typeof value === 'string',
            )
          : [];
        if (!Array.isArray(item['migratedCorrectionIds'])) {
          pushIssue(
            issues,
            `${path}.migratedCorrectionIds`,
            'history-field',
            'migratedCorrectionIds 必须是数组',
          );
        }
        if (!Array.isArray(item['unresolvedCorrectionIds'])) {
          pushIssue(
            issues,
            `${path}.unresolvedCorrectionIds`,
            'history-field',
            'unresolvedCorrectionIds 必须是数组',
          );
        }
        const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
          left.length === right.length &&
          left.every((value) => right.includes(value)) &&
          right.every((value) => left.includes(value));
        if (Array.isArray(decisions)) {
          if (!sameSet(migratedList, migratedFromDecisions)) {
            pushIssue(
              issues,
              `${path}.migratedCorrectionIds`,
              'history-consistency',
              'migratedCorrectionIds 必须与 decisions 一致',
            );
          }
          if (!sameSet(unresolvedList, unresolvedFromDecisions)) {
            pushIssue(
              issues,
              `${path}.unresolvedCorrectionIds`,
              'history-consistency',
              'unresolvedCorrectionIds 必须与 decisions 一致',
            );
          }
        }
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
