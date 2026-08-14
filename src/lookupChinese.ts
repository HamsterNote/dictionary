import type { ChineseDictionaryEntry, ChineseDictionaryPack } from './chineseDictionaryPack';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';

export interface ChineseMeaning {
  readonly definition: string;
  readonly id: string;
  readonly partOfSpeech?: string;
}

export type ChineseLookupResult =
  | {
      readonly meanings: readonly ChineseMeaning[];
      readonly phonetic?: string;
      readonly sourceId: string;
      readonly sourceLabel: string;
      readonly status: 'found';
      readonly word: string;
    }
  | {
      readonly query: string;
      readonly status: 'not-found';
    };

function formatChineseHeadword(headword: string): string {
  return headword.replace(/,/gu, '，');
}

function normalizeChineseQuery(query: string): string {
  return query.trim().normalize('NFKC').replace(/\s+/gu, ' ');
}

function findEntry(
  query: string,
  dictionaryPacks: readonly ChineseDictionaryPack[],
): readonly [ChineseDictionaryEntry, ChineseDictionaryPack] | undefined {
  for (const dictionaryPack of dictionaryPacks) {
    const entry = dictionaryPack.entries.get(query);
    if (entry !== undefined) return [entry, dictionaryPack];
  }
  return undefined;
}

export function countChineseEntries(dictionaryPacks: readonly ChineseDictionaryPack[]): number {
  const headwords = new Set<string>();
  for (const dictionaryPack of dictionaryPacks) {
    for (const headword of dictionaryPack.entries.keys()) headwords.add(headword);
  }
  return headwords.size;
}

export function suggestChinese(
  query: string,
  dictionaryPacks: readonly ChineseDictionaryPack[],
  limit = 18,
): readonly string[] {
  const normalizedQuery = normalizeChineseQuery(query);
  if (normalizedQuery.length === 0 || limit <= 0) return [];

  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const dictionaryPack of dictionaryPacks) {
    for (const headword of dictionaryPack.entries.keys()) {
      if (!headword.startsWith(normalizedQuery) || seen.has(headword)) continue;
      seen.add(headword);
      suggestions.push(headword);
    }
  }

  suggestions.sort((left, right) => {
    if (left === normalizedQuery) return -1;
    if (right === normalizedQuery) return 1;
    return left.length - right.length;
  });
  return suggestions.slice(0, limit);
}

export function suggestChineseEntries(
  query: string,
  dictionaryPacks: readonly ChineseDictionaryPack[],
  limit = 18,
): readonly DictionaryEntrySummary[] {
  return suggestChinese(query, dictionaryPacks, limit).flatMap((word) => {
    const entry = resolveChineseEntry(word, dictionaryPacks);
    return entry === undefined ? [] : [entry];
  });
}

export function resolveChineseEntry(
  query: string,
  dictionaryPacks: readonly ChineseDictionaryPack[],
): DictionaryEntrySummary | undefined {
  const result = lookupChinese(query, dictionaryPacks);
  if (result.status === 'not-found') return undefined;
  const firstMeaning = result.meanings[0];
  if (firstMeaning === undefined) return undefined;
  return {
    definition: firstMeaning.definition,
    ...(result.phonetic ? { phonetic: result.phonetic } : {}),
    word: result.word,
  };
}

export function lookupChinese(
  query: string,
  dictionaryPacks: readonly ChineseDictionaryPack[],
): ChineseLookupResult {
  const normalizedQuery = normalizeChineseQuery(query);
  const match = findEntry(normalizedQuery, dictionaryPacks);
  if (match === undefined) return { query: query.trim(), status: 'not-found' };

  const [[pinyin, category, definitions], dictionaryPack] = match;
  return {
    meanings: definitions.map((definition, index) => ({
      definition,
      id: `${normalizedQuery}-${String(index + 1)}`,
      ...(index === 0 ? { partOfSpeech: category } : {}),
    })),
    ...(pinyin ? { phonetic: pinyin } : {}),
    sourceId: dictionaryPack.id,
    sourceLabel: dictionaryPack.label,
    status: 'found',
    word: formatChineseHeadword(normalizedQuery),
  };
}
