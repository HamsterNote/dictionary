import coreSnapshot from './data/ecdict-core.tsv?raw';
import { CORE_VOCABULARY_METADATA } from './data/ecdictManifest';
import {
  createEnglishChineseVocabularyPack,
  type EnglishChineseEntry,
  type EnglishChineseVocabularyPack,
} from './englishChineseVocabularyPack';

export interface EnglishChineseMeaning {
  readonly definition: string;
  readonly id: string;
  readonly partOfSpeech?: string;
}

export type EnglishChineseLookupResult =
  | {
      readonly meanings: readonly EnglishChineseMeaning[];
      readonly phonetic?: string;
      readonly status: 'found';
      readonly word: string;
    }
  | {
      readonly query: string;
      readonly status: 'not-found';
    };

const PART_OF_SPEECH: ReadonlyMap<string, string> = new Map([
  ['a', 'adjective · 形容词'],
  ['adj', 'adjective · 形容词'],
  ['adv', 'adverb · 副词'],
  ['aux', 'auxiliary · 助动词'],
  ['conj', 'conjunction · 连词'],
  ['n', 'noun · 名词'],
  ['num', 'numeral · 数词'],
  ['prep', 'preposition · 介词'],
  ['pron', 'pronoun · 代词'],
  ['v', 'verb · 动词'],
  ['vi', 'intransitive verb · 不及物动词'],
  ['vt', 'transitive verb · 及物动词'],
]);

const MEANING_SEPARATOR = '\u001f';
const CORE_VOCABULARY_PACK = createEnglishChineseVocabularyPack(
  coreSnapshot,
  CORE_VOCABULARY_METADATA,
);

export const ENGLISH_CHINESE_ENTRY_COUNT = CORE_VOCABULARY_PACK.entryCount;
export const ENGLISH_CHINESE_CORE_GZIP_BYTES = CORE_VOCABULARY_PACK.gzipBytes;

export function countEnglishChineseEntries(
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
): number {
  const words = new Set(CORE_VOCABULARY_PACK.entries.keys());
  for (const vocabularyPack of vocabularyPacks) {
    for (const word of vocabularyPack.entries.keys()) words.add(word);
  }
  return words.size;
}

export function findEnglishChineseEntryLabels(
  query: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
): readonly string[] {
  const normalizedQuery = normalizeEnglishChineseQuery(query);
  const labels: string[] = [];
  if (CORE_VOCABULARY_PACK.entries.has(normalizedQuery)) labels.push('高频核心');
  for (const vocabularyPack of vocabularyPacks) {
    if (vocabularyPack.entries.has(normalizedQuery)) labels.push(vocabularyPack.label);
  }
  return labels;
}

function normalizeEnglishChineseQuery(query: string): string {
  return query.trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function findEntry(
  normalizedQuery: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[],
): EnglishChineseEntry | undefined {
  const coreEntry = CORE_VOCABULARY_PACK.entries.get(normalizedQuery);
  if (coreEntry !== undefined) return coreEntry;

  for (const vocabularyPack of vocabularyPacks) {
    const entry = vocabularyPack.entries.get(normalizedQuery);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

export function suggestEnglishChinese(
  query: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
  limit = 6,
): readonly string[] {
  const normalizedQuery = normalizeEnglishChineseQuery(query);
  if (normalizedQuery.length === 0 || limit <= 0) return [];

  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const vocabularyPack of [CORE_VOCABULARY_PACK, ...vocabularyPacks]) {
    for (const word of vocabularyPack.entries.keys()) {
      if (!word.startsWith(normalizedQuery) || seen.has(word)) continue;
      seen.add(word);
      suggestions.push(word);
      if (suggestions.length === limit) return suggestions;
    }
  }
  return suggestions;
}

export function lookupEnglishChinese(
  query: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
): EnglishChineseLookupResult {
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeEnglishChineseQuery(query);
  const entry = findEntry(normalizedQuery, vocabularyPacks);
  if (entry === undefined) return { query: trimmedQuery, status: 'not-found' };

  const [phonetic, translation] = entry;
  const meanings = translation.split(MEANING_SEPARATOR).map((definition, index) => {
    const match = /^(?<part>[a-z]+)\.\s*(?<text>.+)$/iu.exec(definition);
    const part = match?.groups?.['part'];
    return {
      definition: match?.groups?.['text'] ?? definition,
      id: `${normalizedQuery}-${String(index + 1)}`,
      ...(part === undefined ? {} : { partOfSpeech: PART_OF_SPEECH.get(part) ?? part }),
    };
  });

  return {
    meanings,
    ...(phonetic ? { phonetic: `/${phonetic}/` } : {}),
    status: 'found',
    word: normalizedQuery,
  };
}
