import type { ReactNode } from 'react';
import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import {
  extractDictionaryTextTokens,
  resolveChineseText,
  type DictionaryEntryResolver,
} from './dictionaryTextCandidates';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';
import {
  DictionaryTextResolutionContext,
  type DictionaryTextResolutionSession,
} from './dictionaryTextResolutionSession';

interface DictionaryInteractiveTextProps {
  readonly children: ReactNode;
  readonly onOpen: (entry: DictionaryEntrySummary, anchor: HTMLElement) => void;
  readonly resolveEntry: DictionaryEntryResolver;
}

function DictionaryInteractiveTextRenderer({
  children,
  onOpen,
  resolveEntry,
  session,
}: DictionaryInteractiveTextProps & {
  readonly session: DictionaryTextResolutionSession | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [resolved, setResolved] = useState<{
    readonly session: DictionaryTextResolutionSession;
    readonly text: string;
    readonly entries: ReadonlyMap<string, DictionaryEntrySummary>;
  }>();
  const ready = !session || (resolved?.session === session && resolved.text === children);
  const display = useMemo(() => {
    if (typeof children !== 'string') return { text: '', offsets: [0] };
    const text = protectCjkLineBreaks(children);
    const offsets = [0];
    let cursor = 0;
    for (const character of children.split('')) {
      while (text[cursor] !== character) cursor += 1;
      cursor += 1;
      offsets.push(cursor);
    }
    return { text, offsets };
  }, [children]);
  const tokens = useMemo(
    () => (ready && typeof children === 'string' ? extractDictionaryTextTokens(children) : []),
    [children, ready],
  );
  useEffect(() => {
    if (!session || typeof children !== 'string' || !ref.current) return;
    const controller = new AbortController();
    void session
      .resolve(children, ref.current, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setResolved({ session, text: children, entries });
      })
      .catch(() => {
        /* Session owns the retry/error status; cancelled readers never write. */
      });
    return () => {
      controller.abort();
    };
  }, [children, session]);
  if (typeof children !== 'string') return children;
  // Pending paragraphs only need readable text; defer the token DOM as well.
  if (!ready) {
    return <span ref={ref}>{protectCjkLineBreaks(children)}</span>;
  }

  const lookup: DictionaryEntryResolver = session
    ? (word) =>
        resolved?.session === session && resolved.text === children
          ? resolved.entries.get(word)
          : undefined
    : resolveEntry;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const { index, token, semanticWords } of tokens) {
    if (index > cursor)
      nodes.push(display.text.slice(display.offsets[cursor], display.offsets[index]));

    let segmentOffset = index;
    for (const semanticWord of semanticWords) {
      const segments = /^\p{Script=Han}+$/u.test(semanticWord)
        ? resolveChineseText(semanticWord, lookup)
        : [{ entry: lookup(semanticWord), text: token }];
      const segmentNodes: ReactNode[] = [];
      for (const [segmentIndex, segment] of segments.entries()) {
        const start = segmentOffset;
        segmentOffset += segment.text.length;
        const text = display.text.slice(display.offsets[start], display.offsets[segmentOffset]);
        if (segment.entry === undefined) {
          segmentNodes.push(text);
          continue;
        }
        const entry = segment.entry;
        segmentNodes.push(
          <span
            aria-label={segment.text}
            aria-haspopup="dialog"
            className="dictionary-popover__inline-word"
            key={`${String(index)}-${nodes.length.toString()}-${String(segmentIndex)}`}
            onClick={(event) => {
              const fragments = Array.from(event.currentTarget.getClientRects());
              event.currentTarget.dataset['previewFragment'] = String(
                Math.max(
                  0,
                  fragments.findIndex(
                    (rect) => event.clientY >= rect.top && event.clientY <= rect.bottom,
                  ),
                ),
              );
              onOpen(entry, event.currentTarget);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.dataset['previewFragment'] = '0';
                onOpen(entry, event.currentTarget);
              }
            }}
          >
            {text}
          </span>,
        );
      }
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
  if (cursor < children.length) nodes.push(display.text.slice(display.offsets[cursor]));
  return session ? <span ref={ref}>{nodes}</span> : nodes;
}

const ScheduledDictionaryInteractiveText = memo(DictionaryInteractiveTextRenderer);

export function DictionaryInteractiveText(props: DictionaryInteractiveTextProps) {
  const session = useContext(DictionaryTextResolutionContext);
  // Synchronous resolver hosts may update the data behind a stable function and
  // re-render. Only memoize readers whose asynchronous results own their state.
  return session ? (
    <ScheduledDictionaryInteractiveText {...props} session={session} />
  ) : (
    <DictionaryInteractiveTextRenderer {...props} session={undefined} />
  );
}
