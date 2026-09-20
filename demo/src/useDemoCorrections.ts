import { useState } from 'react';
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
  const system = Object.fromEntries(
    Object.entries(SYSTEM_DICTIONARY_CORRECTIONS).filter(([word]) => !removed[word]),
  );
  const manager = useDictionaryCorrections({ system });

  return {
    control: { system, user: manager.user, onChange: manager.save },
    removeUser: manager.reset,
    removeSystem: (word: string) => {
      const patch = SYSTEM_DICTIONARY_CORRECTIONS[word];
      if (!patch) return;
      const next = { ...removed, [word]: patch };
      store.save(next);
      setRemoved(next);
    },
    restoreSystem: () => {
      store.save({});
      setRemoved({});
    },
    removedCount: Object.keys(removed).length,
  };
}
