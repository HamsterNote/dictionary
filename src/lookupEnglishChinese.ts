import coreSnapshot from './data/ecdict-core.tsv?raw';
import { CORE_VOCABULARY_METADATA } from './data/ecdictManifest';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import {
  createEnglishChineseVocabularyPack,
  type EnglishChineseEntry,
  type EnglishChineseVocabularyPack,
} from './englishChineseVocabularyPack';
import type { EnglishExampleSentencePack } from './englishExampleSentencePack';
import { ENGLISH_PART_OF_SPEECH } from './englishPartOfSpeech';
import {
  ENGLISH_INFLECTION_LABELS,
  type EnglishInflection,
  type EnglishInflectionFormsPack,
  type EnglishInflectionIndexPack,
} from './englishInflectionPack';
import { findEnglishInflections, findEnglishInflectionSources } from './englishInflectionLookup';
import type { EnglishSynonymPack } from './englishSynonymPack';
import type { EnglishDerivationRoot, EnglishRootPack } from './englishRootPack';

export interface EnglishChineseMeaning {
  readonly definition: string;
  readonly examples?: readonly string[];
  readonly id: string;
  readonly partOfSpeech?: string;
}

export interface EnglishInflectionLookupPacks {
  readonly forms?: readonly EnglishInflectionFormsPack[];
  readonly index?: readonly EnglishInflectionIndexPack[];
}

export interface EnglishChineseSuggestionOptions {
  readonly inflectionIndexPacks?: readonly EnglishInflectionIndexPack[];
  readonly limit?: number;
}

export type EnglishChineseLookupResult =
  | {
      readonly examples: readonly string[];
      readonly inflections: readonly EnglishInflection[];
      readonly kind: 'entry';
      readonly meanings: readonly EnglishChineseMeaning[];
      readonly phonetic?: string;
      readonly roots: readonly EnglishDerivationRoot[];
      readonly status: 'found';
      readonly synonyms: readonly string[];
      readonly word: string;
    }
  | {
      readonly examples: readonly [];
      readonly inflections: readonly [];
      readonly kind: 'inflection';
      readonly meanings: readonly EnglishChineseMeaning[];
      readonly phonetic?: never;
      readonly roots: readonly [];
      readonly status: 'found';
      readonly synonyms: readonly [];
      readonly word: string;
    }
  | {
      readonly query: string;
      readonly status: 'not-found';
    };

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

export function suggestEnglishChineseEntries(
  query: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
  limitOrOptions: number | EnglishChineseSuggestionOptions = 6,
): readonly DictionaryEntrySummary[] {
  const limit = typeof limitOrOptions === 'number' ? limitOrOptions : (limitOrOptions.limit ?? 6);
  if (limit <= 0) return [];

  const inflectionIndexPacks =
    typeof limitOrOptions === 'number' ? undefined : limitOrOptions.inflectionIndexPacks;
  const inflectionResult = lookupEnglishChinese(
    query,
    vocabularyPacks,
    [],
    [],
    [],
    inflectionIndexPacks === undefined ? {} : { index: inflectionIndexPacks },
  );
  const suggestions: DictionaryEntrySummary[] = [];
  if (inflectionResult.status === 'found' && inflectionResult.kind === 'inflection') {
    const firstMeaning = inflectionResult.meanings[0];
    if (firstMeaning !== undefined) {
      suggestions.push({ definition: firstMeaning.definition, word: inflectionResult.word });
    }
  }

  const prefixSuggestions = suggestEnglishChinese(query, vocabularyPacks, limit).flatMap((word) => {
    const result = lookupEnglishChinese(word, vocabularyPacks);
    if (result.status === 'not-found') return [];
    const firstMeaning = result.meanings[0];
    if (firstMeaning === undefined) return [];
    return [
      {
        definition: firstMeaning.definition,
        ...(result.phonetic ? { phonetic: result.phonetic } : {}),
        word: result.word,
      },
    ];
  });
  return [...suggestions, ...prefixSuggestions].slice(0, limit);
}

export function resolveEnglishChineseEntry(
  query: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
  inflectionPacks: EnglishInflectionLookupPacks = {},
): DictionaryEntrySummary | undefined {
  const result = lookupEnglishChinese(query, vocabularyPacks, [], [], [], inflectionPacks);
  if (result.status === 'not-found') return undefined;
  const firstMeaning = result.meanings[0];
  if (firstMeaning === undefined) return undefined;
  return {
    definition: firstMeaning.definition,
    ...(result.phonetic ? { phonetic: result.phonetic } : {}),
    word: result.word,
  };
}

export function lookupEnglishChinese(
  query: string,
  vocabularyPacks: readonly EnglishChineseVocabularyPack[] = [],
  exampleSentencePacks: readonly EnglishExampleSentencePack[] = [],
  synonymPacks: readonly EnglishSynonymPack[] = [],
  rootPacks: readonly EnglishRootPack[] = [],
  inflectionPacks: EnglishInflectionLookupPacks = {},
): EnglishChineseLookupResult {
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeEnglishChineseQuery(query);
  const entry = findEntry(normalizedQuery, vocabularyPacks);
  if (entry === undefined) {
    const sources = findEnglishInflectionSources(normalizedQuery, inflectionPacks.index ?? []);
    if (sources.length === 0) return { query: trimmedQuery, status: 'not-found' };
    return {
      examples: [],
      inflections: [],
      kind: 'inflection',
      meanings: sources.map((source, index) => ({
        definition: `是 ${source.lemma} 的${ENGLISH_INFLECTION_LABELS[source.kind]}`,
        id: `${normalizedQuery}-source-${String(index + 1)}`,
      })),
      roots: [],
      status: 'found',
      synonyms: [],
      word: normalizedQuery,
    };
  }

  const [phonetic, translation] = entry;
  const examples = exampleSentencePacks
    .flatMap((exampleSentencePack) => exampleSentencePack.entries.get(normalizedQuery) ?? [])
    .filter((example, index, allExamples) => allExamples.indexOf(example) === index)
    .slice(0, 2);
  const synonyms = synonymPacks
    .flatMap((synonymPack) => synonymPack.entries.get(normalizedQuery) ?? [])
    .filter((synonym, index, allSynonyms) => allSynonyms.indexOf(synonym) === index);
  const roots = rootPacks
    .flatMap((rootPack) => rootPack.entries.get(normalizedQuery) ?? [])
    .filter(
      (root, index, allRoots) =>
        allRoots.findIndex(
          (candidate) =>
            candidate.base === root.base &&
            candidate.affix === root.affix &&
            candidate.sourcePartOfSpeech === root.sourcePartOfSpeech &&
            candidate.targetPartOfSpeech === root.targetPartOfSpeech,
        ) === index,
    );
  const inflections = findEnglishInflections(normalizedQuery, inflectionPacks.forms ?? []);
  const meanings = translation.split(MEANING_SEPARATOR).map((definition, index) => {
    const match = /^([a-z]+)\.\s*(.+)$/iu.exec(definition);
    const part = match?.[1];
    return {
      definition: match?.[2] ?? definition,
      id: `${normalizedQuery}-${String(index + 1)}`,
      ...(part === undefined ? {} : { partOfSpeech: ENGLISH_PART_OF_SPEECH.get(part) ?? part }),
    };
  });

  return {
    examples,
    inflections,
    kind: 'entry',
    meanings,
    ...(phonetic ? { phonetic: `/${phonetic}/` } : {}),
    roots,
    status: 'found',
    synonyms,
    word: normalizedQuery,
  };
}
