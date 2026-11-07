import type { DictionaryEntrySummary } from './dictionaryEntrySummary';

const TOKEN_PATTERN =
  /[\p{Script=Han}]+|[\p{Script=Latin}]+(?:['’-][\p{Script=Latin}]+)*(?:\([\p{Script=Latin}]+\))?/gu;
const LATIN_QUALIFIER_PATTERN = /\([\p{Script=Latin}]+\)$/u;
const MAX_CHINESE_WORD_LENGTH = 8;
const CHINESE_WORD_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' });

export interface DictionaryTextToken {
  readonly index: number;
  readonly lookupToken: string;
  readonly semanticWords: readonly string[];
  readonly token: string;
}

export interface ResolvedDictionaryTextSegment {
  readonly entry?: DictionaryEntrySummary;
  readonly text: string;
}

export type DictionaryEntryResolver = (word: string) => DictionaryEntrySummary | undefined;
export type AsyncDictionaryEntryResolver = (
  word: string,
  signal?: AbortSignal,
) => Promise<DictionaryEntrySummary | undefined>;

export function extractDictionaryTextTokens(text: string): readonly DictionaryTextToken[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (match) => {
    const token = match[0];
    const isHanToken = /^\p{Script=Han}+$/u.test(token);
    const lookupToken = isHanToken ? token : token.replace(LATIN_QUALIFIER_PATTERN, '');
    const hanCharacterCount = Array.from(token).length;
    return {
      index: match.index,
      lookupToken,
      semanticWords:
        isHanToken && (hanCharacterCount < 2 || hanCharacterCount > 4)
          ? Array.from(CHINESE_WORD_SEGMENTER.segment(token), ({ segment }) => segment)
          : [lookupToken],
      token,
    };
  });
}

export function resolveChineseText(
  text: string,
  resolveEntry: DictionaryEntryResolver,
): readonly ResolvedDictionaryTextSegment[] {
  const segments: ResolvedDictionaryTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let matchedEntry: DictionaryEntrySummary | undefined;
    let matchedText = '';
    const maximumLength = Math.min(MAX_CHINESE_WORD_LENGTH, text.length - cursor);

    for (let length = maximumLength; length > 0; length -= 1) {
      const candidate = text.slice(cursor, cursor + length);
      const entry = resolveEntry(candidate);
      if (entry === undefined) continue;
      matchedEntry = entry;
      matchedText = candidate;
      break;
    }

    if (matchedEntry === undefined) {
      const character = text[cursor] ?? '';
      const previousSegment = segments.at(-1);
      if (previousSegment !== undefined && previousSegment.entry === undefined) {
        segments[segments.length - 1] = { text: previousSegment.text + character };
      } else {
        segments.push({ text: character });
      }
      cursor += 1;
      continue;
    }

    segments.push({ entry: matchedEntry, text: matchedText });
    cursor += matchedText.length;
  }

  return segments;
}

export async function resolveDictionaryTextEntries(
  text: string,
  resolveEntry: AsyncDictionaryEntryResolver,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, DictionaryEntrySummary>> {
  const candidates = new Set<string>();
  for (const token of extractDictionaryTextTokens(text)) {
    for (const semanticWord of token.semanticWords) {
      if (!/^\p{Script=Han}+$/u.test(semanticWord)) {
        candidates.add(semanticWord);
        continue;
      }
      for (let cursor = 0; cursor < semanticWord.length; cursor += 1) {
        const maximumLength = Math.min(MAX_CHINESE_WORD_LENGTH, semanticWord.length - cursor);
        for (let length = 1; length <= maximumLength; length += 1) {
          candidates.add(semanticWord.slice(cursor, cursor + length));
        }
      }
    }
  }

  const resolved = new Map<string, DictionaryEntrySummary>();
  await Promise.all(
    [...candidates].map(async (word) => {
      signal?.throwIfAborted();
      const entry = await resolveEntry(word, signal);
      if (entry !== undefined) resolved.set(word, entry);
    }),
  );
  signal?.throwIfAborted();
  return resolved;
}
