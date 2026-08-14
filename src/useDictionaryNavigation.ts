import { useCallback, useState } from 'react';

interface DictionaryNavigationOptions {
  readonly onQueryChange: ((query: string) => void) | undefined;
  readonly onSearch: ((query: string) => void) | undefined;
  readonly query: string;
}

interface DictionaryNavigation {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly committedQuery: string;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly search: (query: string) => void;
}

interface DictionaryHistory {
  readonly future: readonly string[];
  readonly past: readonly string[];
  readonly present: string;
}

export function useDictionaryNavigation({
  onQueryChange,
  onSearch,
  query,
}: DictionaryNavigationOptions): DictionaryNavigation {
  const [history, setHistory] = useState<DictionaryHistory>(() => ({
    future: [],
    past: [],
    present: query.trim(),
  }));

  const search = useCallback(
    (nextQuery: string) => {
      const normalizedQuery = nextQuery.trim();
      onQueryChange?.(normalizedQuery);
      onSearch?.(normalizedQuery);
      if (normalizedQuery === history.present) return;

      setHistory({
        future: [],
        past: history.present.length > 0 ? [...history.past, history.present] : history.past,
        present: normalizedQuery,
      });
    },
    [history, onQueryChange, onSearch],
  );

  const goBack = useCallback(() => {
    const previousQuery = history.past.at(-1);
    if (previousQuery === undefined) return;

    setHistory({
      future: [history.present, ...history.future],
      past: history.past.slice(0, -1),
      present: previousQuery,
    });
    onQueryChange?.(previousQuery);
    onSearch?.(previousQuery);
  }, [history, onQueryChange, onSearch]);

  const goForward = useCallback(() => {
    const nextQuery = history.future[0];
    if (nextQuery === undefined) return;

    setHistory({
      future: history.future.slice(1),
      past: [...history.past, history.present],
      present: nextQuery,
    });
    onQueryChange?.(nextQuery);
    onSearch?.(nextQuery);
  }, [history, onQueryChange, onSearch]);

  return {
    canGoBack: history.past.length > 0,
    canGoForward: history.future.length > 0,
    committedQuery: history.present,
    goBack,
    goForward,
    search,
  };
}
