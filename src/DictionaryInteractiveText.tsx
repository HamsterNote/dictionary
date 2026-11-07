import type { ReactNode } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import {
  extractDictionaryTextTokens,
  resolveChineseText,
  type DictionaryEntryResolver,
} from './dictionaryTextCandidates';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';

interface DictionaryInteractiveTextProps {
  readonly children: ReactNode;
  readonly onOpen: (entry: DictionaryEntrySummary, anchor: HTMLButtonElement) => void;
  readonly resolveEntry: DictionaryEntryResolver;
}

export function DictionaryInteractiveText({
  children,
  onOpen,
  resolveEntry,
}: DictionaryInteractiveTextProps) {
  if (typeof children !== 'string') return children;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const { index, token, semanticWords } of extractDictionaryTextTokens(children)) {
    if (index > cursor) nodes.push(protectCjkLineBreaks(children.slice(cursor, index)));

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
