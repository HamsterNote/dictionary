import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { DictionaryMeaning, DictionarySource } from './dictionaryData';
import type { DictionaryProvider } from './dictionaryProvider';
import type { DictionaryEntryResolver } from './dictionaryTextCandidates';
import { DictionaryTextResolutionSession } from './dictionaryTextResolutionSession';

interface DictionaryTextResolutionOptions {
  readonly meanings?: readonly DictionaryMeaning[] | undefined;
  readonly provider?: DictionaryProvider | undefined;
  readonly resolveEntry?: DictionaryEntryResolver | undefined;
  readonly sources?: readonly DictionarySource[] | undefined;
  readonly word: string;
}

const subscribeEmpty = () => () => undefined;
const ready = () => 'ready' as const;
const unresolved: DictionaryEntryResolver = () => undefined;

function contentKey(
  meanings: readonly DictionaryMeaning[] | undefined,
  sources: readonly DictionarySource[] | undefined,
): string {
  return JSON.stringify([
    ...[...(meanings ?? []), ...(sources ?? []).flatMap((source) => source.meanings)].flatMap(
      (meaning) => [
        typeof meaning.definition === 'string' ? meaning.definition : '',
        typeof meaning.example === 'string' ? meaning.example : '',
        ...(meaning.examples ?? []),
      ],
    ),
    ...(sources ?? []).flatMap((source) => source.examples ?? []),
  ]);
}

export function useDictionaryTextResolution({
  meanings,
  provider,
  resolveEntry,
  sources,
  word,
}: DictionaryTextResolutionOptions) {
  const [retrySequence, setRetrySequence] = useState(0);
  const text = contentKey(meanings, sources);
  // Content identity defines the lifetime of a reader, including corrections/retry.
  const session = useMemo(
    () => (provider ? new DictionaryTextResolutionSession(provider.resolveEntry) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, word, text, retrySequence],
  );
  const status = useSyncExternalStore(
    session?.subscribe ?? subscribeEmpty,
    session?.getSnapshot ?? ready,
    ready,
  );
  useEffect(
    () => () => {
      session?.cancel();
    },
    [session],
  );
  return {
    resolveEntry: provider ? unresolved : resolveEntry,
    retry: () => {
      setRetrySequence((value) => value + 1);
    },
    session,
    status,
  };
}
