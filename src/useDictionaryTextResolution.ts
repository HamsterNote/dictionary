import { useEffect, useState } from 'react';
import type { DictionaryMeaning, DictionarySource } from './dictionaryData';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import type { DictionaryProvider } from './dictionaryProvider';
import { DictionaryQueryController, type DictionaryQueryState } from './dictionaryQueryController';
import {
  resolveDictionaryTextEntries,
  type DictionaryEntryResolver,
} from './dictionaryTextCandidates';

interface DictionaryTextResolutionOptions {
  readonly meanings?: readonly DictionaryMeaning[] | undefined;
  readonly provider?: DictionaryProvider | undefined;
  readonly resolveEntry?: DictionaryEntryResolver | undefined;
  readonly sources?: readonly DictionarySource[] | undefined;
}

export interface DictionaryTextResolution {
  readonly resolveEntry: DictionaryEntryResolver | undefined;
  readonly retry: () => void;
  readonly status: 'error' | 'loading' | 'ready';
}

function collectText(
  sources: readonly DictionarySource[] | undefined,
  meanings: readonly DictionaryMeaning[] | undefined,
): string {
  const values: string[] = [];
  for (const source of sources ?? []) {
    values.push(...(source.examples ?? []));
    for (const meaning of source.meanings) {
      if (typeof meaning.definition === 'string') values.push(meaning.definition);
      if (typeof meaning.example === 'string') values.push(meaning.example);
      values.push(...(meaning.examples ?? []));
    }
  }
  for (const meaning of meanings ?? []) {
    if (typeof meaning.definition === 'string') values.push(meaning.definition);
    if (typeof meaning.example === 'string') values.push(meaning.example);
    values.push(...(meaning.examples ?? []));
  }
  return values.join('\n');
}

export function useDictionaryTextResolution({
  meanings,
  provider,
  resolveEntry,
  sources,
}: DictionaryTextResolutionOptions): DictionaryTextResolution {
  const [retrySequence, setRetrySequence] = useState(0);
  const [state, setState] = useState<
    DictionaryQueryState<ReadonlyMap<string, DictionaryEntrySummary>>
  >({ status: 'idle' });
  const text = collectText(sources, meanings);

  useEffect(() => {
    if (!provider) return;
    const controller = new DictionaryQueryController<ReadonlyMap<string, DictionaryEntrySummary>>();
    const unsubscribe = controller.subscribe(setState);
    void controller.request(text, (value, signal) =>
      resolveDictionaryTextEntries(value, provider.resolveEntry, signal),
    );
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [provider, retrySequence, text]);

  if (!provider) {
    return {
      resolveEntry,
      retry: () => undefined,
      status: 'ready',
    };
  }
  return {
    resolveEntry: (word) => (state.status === 'ready' ? state.data.get(word) : undefined),
    retry: () => {
      setRetrySequence((value) => value + 1);
    },
    status:
      text.length === 0
        ? 'ready'
        : state.status === 'ready'
          ? 'ready'
          : state.status === 'error'
            ? 'error'
            : 'loading',
  };
}
