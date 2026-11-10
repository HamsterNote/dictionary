import { useCallback, useMemo, useState } from 'react';
import {
  createDictionaryCorrectionStore,
  SYSTEM_DICTIONARY_CORRECTIONS,
  useDictionaryCorrections,
} from '../../src';

const SYSTEM_REMOVALS_KEY = 'hamster-dictionary-demo/system-removals/v1';

export function useDemoCorrections() {
  const [store] = useState(() =>
    createDictionaryCorrectionStore(window.localStorage, SYSTEM_REMOVALS_KEY),
  );
  const [removed, setRemoved] = useState(() => store.load());
  const system = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SYSTEM_DICTIONARY_CORRECTIONS).filter(([word]) => !removed[word]),
      ),
    [removed],
  );
  const manager = useDictionaryCorrections({ system });

  const removeSystem = useCallback(
    (word: string) => {
      const patch = SYSTEM_DICTIONARY_CORRECTIONS[word];
      if (!patch) return;
      const next = { ...removed, [word]: patch };
      store.save(next);
      setRemoved(next);
    },
    [removed, store],
  );
  const restoreSystem = useCallback(() => {
    store.save({});
    setRemoved({});
  }, [store]);
  const control = useMemo(
    () => ({ system, user: manager.user, onChange: manager.save }),
    [system, manager.user, manager.save],
  );
  return {
    control,
    removeUser: manager.reset,
    removeSystem,
    restoreSystem,
    removedCount: Object.keys(removed).length,
  };
}
