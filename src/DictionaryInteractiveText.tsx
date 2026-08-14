import type { ReactNode } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';

const TOKEN_PATTERN =
  /[\p{Script=Han}]+|[\p{Script=Latin}]+(?:['’-][\p{Script=Latin}]+)*(?:\([\p{Script=Latin}]+\))?/gu;
const LATIN_QUALIFIER_PATTERN = /\([\p{Script=Latin}]+\)$/u;
const MAX_CHINESE_WORD_LENGTH = 8;
const CHINESE_WORD_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' });

interface DictionaryInteractiveTextProps {
  readonly children: ReactNode;
  readonly onOpen: (entry: DictionaryEntrySummary, anchor: HTMLButtonElement) => void;
  readonly resolveEntry: (word: string) => DictionaryEntrySummary | undefined;
}

interface ResolvedSegment {
  readonly entry?: DictionaryEntrySummary;
  readonly text: string;
}

function resolveChineseText(
  text: string,
  resolveEntry: (word: string) => DictionaryEntrySummary | undefined,
): readonly ResolvedSegment[] {
  const segments: ResolvedSegment[] = [];
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

export function DictionaryInteractiveText({
  children,
  onOpen,
  resolveEntry,
}: DictionaryInteractiveTextProps) {
  if (typeof children !== 'string') return children;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of children.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    const token = match[0];
    if (index > cursor) nodes.push(protectCjkLineBreaks(children.slice(cursor, index)));

    const isHanToken = /^\p{Script=Han}+$/u.test(token);
    const lookupToken = isHanToken ? token : token.replace(LATIN_QUALIFIER_PATTERN, '');
    const hanCharacterCount = Array.from(token).length;
    const semanticWords =
      isHanToken && (hanCharacterCount < 2 || hanCharacterCount > 4)
        ? Array.from(CHINESE_WORD_SEGMENTER.segment(token), ({ segment }) => segment)
        : [lookupToken];
    for (const semanticWord of semanticWords) {
      const segments = /^\p{Script=Han}+$/u.test(semanticWord)
        ? resolveChineseText(semanticWord, resolveEntry)
        : [{ entry: resolveEntry(semanticWord), text: token }];
      const segmentNodes = segments.map((segment, segmentIndex) => {
        if (segment.entry === undefined) return protectCjkLineBreaks(segment.text);
        const entry = segment.entry;
        return (
          <button
            aria-haspopup="dialog"
            className="dictionary-popover__inline-word"
            key={`${String(index)}-${nodes.length.toString()}-${String(segmentIndex)}`}
            onClick={(event) => {
              onOpen(entry, event.currentTarget);
            }}
            type="button"
          >
            {segment.text}
          </button>
        );
      });
      nodes.push(
        <span
          className="dictionary-popover__semantic-word"
          key={`${String(index)}-${nodes.length.toString()}`}
        >
          {segmentNodes}
        </span>,
      );
    }
    cursor = index + token.length;
  }
  if (cursor < children.length) nodes.push(protectCjkLineBreaks(children.slice(cursor)));
  return nodes;
}
