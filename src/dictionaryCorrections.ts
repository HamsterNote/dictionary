import type { DictionaryDetail } from './dictionaryData';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';

/**
 * 单个词条的纠错补丁。JSON 以「原始词头字符串」为键，
 * 字段缺省表示沿用词典原始值；查找、导航与历史始终使用原始词头，
 * 纠错后的拼写只影响展示。
 */
export interface DictionaryCorrectionPatch {
  readonly meaning?: string;
  readonly phonetic?: string;
  readonly word?: string;
}

/** 词条纠错表：键为原始词头字符串，值为该词的补丁。 */
export type DictionaryCorrectionMap = Readonly<Record<string, DictionaryCorrectionPatch>>;

/** 视图层消费的纠错配置：user > system > 原文，disabled 时完全停用。 */
export interface DictionaryCorrectionViewConfig {
  readonly disabled?: boolean;
  readonly system?: DictionaryCorrectionMap | undefined;
  readonly user?: DictionaryCorrectionMap | undefined;
}

/** 纠错补丁中可编辑的字段名，顺序即展示顺序。 */
export const DICTIONARY_CORRECTION_FIELDS = ['word', 'phonetic', 'meaning'] as const;

export type DictionaryCorrectionField = (typeof DICTIONARY_CORRECTION_FIELDS)[number];

export type DictionaryCorrectionFieldValues = Readonly<Record<DictionaryCorrectionField, string>>;

/** 宿主纠错数据。不提供 user 时组件内部使用默认本地存储。 */
export interface DictionaryCorrectionsControl {
  readonly disabled?: boolean;
  readonly onChange?: ((word: string, patch: DictionaryCorrectionPatch | null) => void) | undefined;
  readonly system?: DictionaryCorrectionMap;
  readonly user?: DictionaryCorrectionMap | undefined;
}

/** 解析后的纠错控制：editable 为 false 时只应用补丁、隐藏编辑入口，绝不静默保存。 */
export interface ResolvedDictionaryCorrectionsControl {
  readonly disabled: boolean;
  readonly editable: boolean;
  readonly managed: boolean;
  readonly onChange: DictionaryCorrectionsControl['onChange'];
  readonly system: DictionaryCorrectionMap;
  readonly user: DictionaryCorrectionMap;
}

/** 词条纠错视图的通用形状：词、音标、释义与展示级变化列表。 */
export interface DictionaryCorrectionEntryLike {
  readonly definition?: string;
  readonly phonetic?: string;
  readonly sources?: readonly { readonly meanings: readonly { readonly definition: string }[] }[];
  readonly word: string;
}

export interface DictionaryCorrectionFieldViews {
  readonly meaning: string;
  readonly phonetic: string;
  readonly word: string;
}

export interface DictionaryCorrectionViews {
  readonly corrected: DictionaryCorrectionFieldViews;
  readonly original: DictionaryCorrectionFieldViews;
}

/** 单个补丁的来源层级：用户纠错 > 系统纠错 > 词典原文。 */
export type DictionaryCorrectionOrigin = 'user' | 'system';

export interface ResolvedDictionaryCorrection {
  /** 逐字段来源，用户字段与系统字段可在同一词条共存。 */
  readonly fieldOrigins: Partial<Record<DictionaryCorrectionField, DictionaryCorrectionOrigin>>;
  readonly key: string;
  readonly origin: DictionaryCorrectionOrigin;
  readonly patch: DictionaryCorrectionPatch;
}

export interface DictionaryCorrectedField {
  readonly after: string;
  readonly before: string;
  readonly field: DictionaryCorrectionField;
  readonly origin: DictionaryCorrectionOrigin;
}

export interface DictionaryCorrectedSummary {
  readonly changes: readonly DictionaryCorrectedField[];
  /** 未打补丁的原始词头，用于查找、提交与展开。 */
  readonly originalWord: string;
  readonly summary: DictionaryEntrySummary;
}

export interface DictionaryCorrectedDetail {
  readonly changes: readonly DictionaryCorrectedField[];
  readonly detail: DictionaryDetail;
}

/** 词条纠错的最小存储合同，默认实现使用 localStorage，宿主可注入自己的后端。 */
export interface DictionaryCorrectionStore {
  readonly load: () => DictionaryCorrectionMap;
  readonly save: (map: DictionaryCorrectionMap) => void;
}

export const DICTIONARY_CORRECTION_STORAGE_KEY = 'hamster-dictionary-corrections/v1';

const CORRECTION_KEY_MAX_LENGTH = 300;
const CORRECTION_FIELD_MAX_LENGTH = 1000;

/**
 * 纠错键的规范化：NFKC + trim + 压缩空白；拉丁词头额外按 en-US 小写，
 * 与词典查找的大小写处理保持一致。
 */
export function normalizeDictionaryCorrectionKey(word: string): string {
  const normalized = word.trim().normalize('NFKC').replace(/\s+/gu, ' ');
  return /[\p{Script=Han}]/u.test(normalized) ? normalized : normalized.toLocaleLowerCase('en-US');
}

function isPatchRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePatchField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > CORRECTION_FIELD_MAX_LENGTH) return undefined;
  return text;
}

/** 逐字段清理补丁；无有效字段时返回 undefined。 */
export function sanitizeDictionaryCorrectionPatch(
  patch: DictionaryCorrectionPatch,
): DictionaryCorrectionPatch | undefined {
  const word = sanitizePatchField(patch.word);
  const phonetic = sanitizePatchField(patch.phonetic);
  const meaning = sanitizePatchField(patch.meaning);
  if (word === undefined && phonetic === undefined && meaning === undefined) return undefined;
  return {
    ...(word === undefined ? {} : { word }),
    ...(phonetic === undefined ? {} : { phonetic }),
    ...(meaning === undefined ? {} : { meaning }),
  };
}

/** 解析外部提供的纠错表（宿主注入或 JSON 文件），丢弃非法键与字段。 */
export function sanitizeDictionaryCorrectionMap(raw: unknown): DictionaryCorrectionMap {
  if (!isPatchRecord(raw)) return {};
  const result: Record<string, DictionaryCorrectionPatch> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.length === 0 || key.length > CORRECTION_KEY_MAX_LENGTH || !isPatchRecord(value))
      continue;
    const patch = sanitizePatchField(value['word']);
    const phonetic = sanitizePatchField(value['phonetic']);
    const meaning = sanitizePatchField(value['meaning']);
    if (patch === undefined && phonetic === undefined && meaning === undefined) continue;
    result[key] = {
      ...(patch === undefined ? {} : { word: patch }),
      ...(phonetic === undefined ? {} : { phonetic }),
      ...(meaning === undefined ? {} : { meaning }),
    };
  }
  return result;
}

/**
 * 解析词条当前生效的纠错。先按传入词头直接命中，再按规范化键命中，
 * 因此保存用的原始词头与后续查询的大小写差异仍能命中同一条补丁。
 * 合并是逐字段的：用户补丁的每个字段优先，其余字段回落到系统补丁，
 * fieldOrigins 记录每个字段各自的来源层级。
 */
export function resolveDictionaryCorrection(
  word: string,
  corrections: DictionaryCorrectionViewConfig,
): ResolvedDictionaryCorrection | undefined {
  if (corrections.disabled === true) return undefined;
  const matchPatch = (
    map: DictionaryCorrectionMap | undefined,
  ): { key: string; patch: DictionaryCorrectionPatch } | undefined => {
    if (map === undefined) return undefined;
    const direct = map[word];
    if (direct !== undefined) return { key: word, patch: direct };
    const key = normalizeDictionaryCorrectionKey(word);
    const normalized = map[key];
    return normalized === undefined ? undefined : { key, patch: normalized };
  };
  const userMatch = matchPatch(corrections.user);
  const systemMatch = matchPatch(corrections.system);
  if (userMatch === undefined) {
    if (systemMatch === undefined) return undefined;
    return {
      fieldOrigins: Object.fromEntries(
        DICTIONARY_CORRECTION_FIELDS.filter((field) => systemMatch.patch[field] !== undefined).map(
          (field) => [field, 'system'],
        ),
      ),
      key: systemMatch.key,
      origin: 'system',
      patch: systemMatch.patch,
    };
  }
  const merged: Record<DictionaryCorrectionField, string | undefined> = {
    meaning: undefined,
    phonetic: undefined,
    word: undefined,
  };
  const fieldOrigins: Partial<Record<DictionaryCorrectionField, DictionaryCorrectionOrigin>> = {};
  for (const field of DICTIONARY_CORRECTION_FIELDS) {
    const value = userMatch.patch[field] ?? systemMatch?.patch[field];
    if (value === undefined) continue;
    merged[field] = value;
    fieldOrigins[field] = userMatch.patch[field] === undefined ? 'system' : 'user';
  }
  const mergedPatch: DictionaryCorrectionPatch = {
    ...(merged.word === undefined ? {} : { word: merged.word }),
    ...(merged.phonetic === undefined ? {} : { phonetic: merged.phonetic }),
    ...(merged.meaning === undefined ? {} : { meaning: merged.meaning }),
  };
  return { fieldOrigins, key: userMatch.key, origin: 'user', patch: mergedPatch };
}

export function isDictionaryCorrectionPatchEmpty(patch: DictionaryCorrectionPatch): boolean {
  return patch.word === undefined && patch.phonetic === undefined && patch.meaning === undefined;
}

/**
 * 音标纠错专用的保存合并：本期界面只允许修改音标。
 * `nextPhonetic` 与词典原值相同（或为空）时丢弃该字段；
 * 其余用户字段（word/meaning）原样保留，全部为空的补丁返回 null 表示删除。
 */
export function mergeDictionaryPhoneticCorrection(
  existing: DictionaryCorrectionPatch | undefined,
  nextPhonetic: string,
  originalPhonetic: string,
): DictionaryCorrectionPatch | null {
  const phonetic = nextPhonetic.trim();
  const merged: DictionaryCorrectionPatch = {
    ...(existing?.word === undefined ? {} : { word: existing.word }),
    ...(existing?.meaning === undefined ? {} : { meaning: existing.meaning }),
    ...(phonetic === originalPhonetic ? {} : { phonetic }),
  };
  return isDictionaryCorrectionPatchEmpty(merged) ? null : merged;
}

/**
 * 依据词条当前生效值生成补丁：与原始值相同的字段不写入补丁，
 * 全部相同则返回 null（表示应删除该词条的纠错）。
 */
export function createDictionaryCorrectionPatch(
  values: DictionaryCorrectionFieldValues,
  original: DictionaryCorrectionFieldValues,
): DictionaryCorrectionPatch | null {
  const patch: DictionaryCorrectionPatch = {
    ...(values.word === original.word ? {} : { word: values.word }),
    ...(values.phonetic === original.phonetic ? {} : { phonetic: values.phonetic }),
    ...(values.meaning === original.meaning ? {} : { meaning: values.meaning }),
  };
  return isDictionaryCorrectionPatchEmpty(patch) ? null : patch;
}
