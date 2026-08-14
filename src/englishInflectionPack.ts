export const ENGLISH_INFLECTION_LABELS = {
  '3': '第三人称',
  d: '过去分词',
  i: '进行时',
  p: '过去式',
  r: '比较级',
  s: '复数',
  t: '最高级',
} as const;

export type EnglishInflectionKind = keyof typeof ENGLISH_INFLECTION_LABELS;

export interface EnglishInflection {
  readonly form: string;
  readonly kind: EnglishInflectionKind;
}

export interface EnglishInflectionSource {
  readonly kind: EnglishInflectionKind;
  readonly lemma: string;
}

export interface EnglishInflectionFormsPack {
  readonly entries: ReadonlyMap<string, readonly EnglishInflection[]>;
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface EnglishInflectionIndexPack {
  readonly entries: ReadonlyMap<string, readonly EnglishInflectionSource[]>;
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface EnglishInflectionMetadata {
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

function isEnglishInflectionKind(value: string): value is EnglishInflectionKind {
  return value in ENGLISH_INFLECTION_LABELS;
}

export function createEnglishInflectionFormsPack(
  snapshot: string,
  metadata: EnglishInflectionMetadata,
): EnglishInflectionFormsPack {
  const entries = new Map<string, EnglishInflection[]>();
  for (const row of snapshot.split('\n').slice(1)) {
    if (!row) continue;
    const [lemma, kind, form] = row.split('\t');
    if (!lemma || !kind || !form || !isEnglishInflectionKind(kind)) continue;
    const inflections = entries.get(lemma) ?? [];
    inflections.push({ form, kind });
    entries.set(lemma, inflections);
  }
  return { ...metadata, entries, entryCount: entries.size };
}

export function createEnglishInflectionIndexPack(
  snapshot: string,
  metadata: EnglishInflectionMetadata,
): EnglishInflectionIndexPack {
  const entries = new Map<string, EnglishInflectionSource[]>();
  for (const row of snapshot.split('\n').slice(1)) {
    if (!row) continue;
    const [form, lemma, kind] = row.split('\t');
    if (!form || !lemma || !kind || !isEnglishInflectionKind(kind)) continue;
    const sources = entries.get(form) ?? [];
    sources.push({ kind, lemma });
    entries.set(form, sources);
  }
  return { ...metadata, entries, entryCount: entries.size };
}
