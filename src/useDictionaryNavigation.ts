import { useCallback, useEffect, useRef, useState } from 'react';

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
  readonly onQueryChange: (query: string) => void;
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
  const internalQueryRef = useRef<string | undefined>(undefined);
  const [history, setHistory] = useState<DictionaryHistory>(() => ({
    future: [],
    past: [],
    present: query.trim(),
  }));

  const updateQuery = useCallback(
    (nextQuery: string) => {
      internalQueryRef.current = nextQuery;
      onQueryChange?.(nextQuery);
    },
    [onQueryChange],
  );

  useEffect(() => {
    if (query === internalQueryRef.current) {
      internalQueryRef.current = undefined;
      return;
    }
    internalQueryRef.current = undefined;

    const normalizedQuery = query.trim();
    setHistory((currentHistory) => {
      if (normalizedQuery === currentHistory.present) return currentHistory;
      return {
        future: [],
        past:
          currentHistory.present.length > 0
            ? [...currentHistory.past, currentHistory.present]
            : currentHistory.past,
        present: normalizedQuery,
      };
    });
  }, [query]);

  const search = useCallback(
    (nextQuery: string) => {
      const normalizedQuery = nextQuery.trim();
      updateQuery(normalizedQuery);
      onSearch?.(normalizedQuery);
      setHistory((currentHistory) => {
        if (normalizedQuery === currentHistory.present) return currentHistory;
        return {
          future: [],
          past:
            currentHistory.present.length > 0
              ? [...currentHistory.past, currentHistory.present]
              : currentHistory.past,
          present: normalizedQuery,
        };
      });
    },
    [onSearch, updateQuery],
  );

  const goBack = useCallback(() => {
    const previousQuery = history.past.at(-1);
    if (previousQuery === undefined) return;

    setHistory({
      future: [history.present, ...history.future],
      past: history.past.slice(0, -1),
      present: previousQuery,
    });
    updateQuery(previousQuery);
    onSearch?.(previousQuery);
  }, [history, onSearch, updateQuery]);

  const goForward = useCallback(() => {
    const nextQuery = history.future[0];
    if (nextQuery === undefined) return;

    setHistory({
      future: history.future.slice(1),
      past: [...history.past, history.present],
      present: nextQuery,
    });
    updateQuery(nextQuery);
    onSearch?.(nextQuery);
  }, [history, onSearch, updateQuery]);

  return {
    canGoBack: history.past.length > 0,
    canGoForward: history.future.length > 0,
    committedQuery: history.present,
    goBack,
    goForward,
    onQueryChange: updateQuery,
    search,
  };
}
