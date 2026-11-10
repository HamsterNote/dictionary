export const DICTIONARY_PREFERENCES_KEY = 'hamster-note:dictionary-preferences:v1';
export interface DictionaryPreferences {
  readonly version: 1;
  readonly definitionWordPreviewEnabled: boolean;
}
export const DEFAULT_DICTIONARY_PREFERENCES: DictionaryPreferences = {
  version: 1,
  definitionWordPreviewEnabled: true,
};
export function decodeDictionaryPreferences(raw: string | null): DictionaryPreferences {
  if (raw === null) return DEFAULT_DICTIONARY_PREFERENCES;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1)
    throw new Error('无法读取词典设置，请重试');
  if (!('definitionWordPreviewEnabled' in value)) return DEFAULT_DICTIONARY_PREFERENCES;
  if (typeof value.definitionWordPreviewEnabled !== 'boolean')
    throw new Error('词典设置必须是布尔值');
  return { version: 1, definitionWordPreviewEnabled: value.definitionWordPreviewEnabled };
}
export function serializeDictionaryPreferences(value: DictionaryPreferences): string {
  if (typeof value.definitionWordPreviewEnabled !== 'boolean') throw new Error('无效的词典设置');
  return JSON.stringify({
    version: 1,
    definitionWordPreviewEnabled: value.definitionWordPreviewEnabled,
  });
}

export interface DictionaryPreferencesSnapshot {
  readonly status: 'loading' | 'ready' | 'error';
  readonly enabled: boolean;
  readonly revision: number;
  readonly unsaved: boolean;
  readonly error?: string;
}
export interface DictionaryPreferencesStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}
/** Host-owned state. Reads never overwrite a later intent; writes remain ordered. */
export function createDictionaryPreferencesStore(storage: DictionaryPreferencesStorage) {
  let snapshot: DictionaryPreferencesSnapshot = {
    status: 'loading',
    enabled: true,
    revision: 0,
    unsaved: false,
  };
  let intent = 0;
  let queue = Promise.resolve();
  let retrySave = false;
  const listeners = new Set<() => void>();
  const publish = (next: Omit<DictionaryPreferencesSnapshot, 'revision'>) => {
    snapshot = { ...next, revision: snapshot.revision + 1 };
    for (const listener of listeners) listener();
  };
  const load = async () => {
    const sequence = intent;
    try {
      const raw = await storage.getItem(DICTIONARY_PREFERENCES_KEY);
      if (sequence !== intent) return;
      try {
        const value = decodeDictionaryPreferences(raw);
        retrySave = false;
        publish({ status: 'ready', enabled: value.definitionWordPreviewEnabled, unsaved: false });
      } catch {
        publish({
          status: 'ready',
          enabled: true,
          unsaved: false,
          error: '设置格式无法读取，可重试',
        });
      }
    } catch {
      if (sequence === intent)
        publish({
          status: 'error',
          enabled: snapshot.enabled,
          unsaved: false,
          error: '读取设置失败，请重试',
        });
    }
  };
  const setEnabled = (enabled: boolean) => {
    const sequence = ++intent;
    retrySave = true;
    publish({ status: 'ready', enabled, unsaved: true });
    queue = queue.then(async () => {
      // Coalesce unstarted writes; never persist obsolete intent after the newest value.
      if (sequence !== intent) return;
      try {
        await storage.setItem(
          DICTIONARY_PREFERENCES_KEY,
          serializeDictionaryPreferences({ version: 1, definitionWordPreviewEnabled: enabled }),
        );
        if (sequence === intent) {
          retrySave = false;
          publish({ status: 'ready', enabled, unsaved: false });
        }
      } catch {
        if (sequence === intent)
          publish({ status: 'ready', enabled, unsaved: true, error: '未保存，可重试' });
      }
    });
    return queue;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    setEnabled,
    retry: () => (retrySave ? setEnabled(snapshot.enabled) : load()),
  };
}

/** Call from a browser host, never during SSR. Storage exceptions are visible state. */
export function createBrowserDictionaryPreferencesStore() {
  const store = createDictionaryPreferencesStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
      window.dispatchEvent(new CustomEvent('dictionary-preferences-changed'));
    },
  });
  const reload = (event: Event) => {
    if (
      event instanceof StorageEvent &&
      event.key !== DICTIONARY_PREFERENCES_KEY &&
      event.key !== null
    )
      return;
    void store.load();
  };
  window.addEventListener('storage', reload);
  window.addEventListener('dictionary-preferences-changed', reload);
  void store.load();
  return {
    ...store,
    dispose: () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('dictionary-preferences-changed', reload);
    },
  };
}
