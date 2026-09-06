import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  DictionaryCorrectionMap,
  DictionaryCorrectionPatch,
  DictionaryCorrectionsControl,
  DictionaryCorrectionStore,
  ResolvedDictionaryCorrectionsControl,
} from './dictionaryCorrections';
import { normalizeDictionaryCorrectionKey } from './dictionaryCorrections';
import { createLocalDictionaryCorrectionStore } from './dictionaryCorrectionStore';
import { SYSTEM_DICTIONARY_CORRECTIONS } from './systemDictionaryCorrections';

const EMPTY_PATCHES: DictionaryCorrectionMap = {};

export interface DictionaryCorrectionsManager {
  readonly disabled: boolean;
  readonly editable: boolean;
  readonly managed: boolean;
  readonly onChange: DictionaryCorrectionsControl['onChange'];
  readonly reset: (word: string) => void;
  readonly save: (word: string, patch: DictionaryCorrectionPatch | null) => void;
  readonly system: DictionaryCorrectionMap;
  readonly user: DictionaryCorrectionMap;
}

/** 解析受控与非受控两种纠错配置，非受控时 managed 为 false，走默认本地存储。 */
export function resolveDictionaryCorrectionsControl(
  control: DictionaryCorrectionsControl | undefined,
): ResolvedDictionaryCorrectionsControl {
  const system = control?.system ?? SYSTEM_DICTIONARY_CORRECTIONS;
  if (control?.disabled === true) {
    return {
      disabled: true,
      editable: false,
      managed: true,
      onChange: control.onChange,
      system,
      user: control.user ?? EMPTY_PATCHES,
    };
  }
  if (control === undefined || (control.user === undefined && control.onChange === undefined)) {
    return {
      disabled: false,
      editable: true,
      managed: false,
      onChange: control?.onChange,
      system,
      user: EMPTY_PATCHES,
    };
  }
  // 托管模式下没有 onChange 意味着补丁无法持久化：编辑入口必须停用，绝不静默保存。
  return {
    disabled: false,
    editable: control.onChange !== undefined,
    managed: true,
    onChange: control.onChange,
    system,
    user: control.user ?? EMPTY_PATCHES,
  };
}

interface LocalCorrectionsCache {
  patches: DictionaryCorrectionMap;
  store: DictionaryCorrectionStore;
}

// 每个标签页一份缓存，useSyncExternalStore 保证同页多个词典实例同步；
// SSR 下不读取 localStorage，模块作用域也不持有用户数据。
let localCorrectionsCache: LocalCorrectionsCache | undefined;
const localCorrectionsSubscribers = new Set<() => void>();

function getLocalCorrectionsCache(): LocalCorrectionsCache {
  if (localCorrectionsCache === undefined) {
    const store = createLocalDictionaryCorrectionStore();
    localCorrectionsCache = { patches: store.load(), store };
  }
  return localCorrectionsCache;
}

function writeLocalCorrections(patches: DictionaryCorrectionMap): void {
  const cache = getLocalCorrectionsCache();
  cache.store.save(patches);
  // 写入成功后才更新内存，持久化失败不会留下假成功状态。
  cache.patches = patches;
  for (const subscriber of localCorrectionsSubscribers) subscriber();
}

function subscribeLocalCorrections(onStoreChange: () => void): () => void {
  localCorrectionsSubscribers.add(onStoreChange);
  return () => {
    localCorrectionsSubscribers.delete(onStoreChange);
  };
}

function getLocalPatchesSnapshot(): DictionaryCorrectionMap {
  return getLocalCorrectionsCache().patches;
}

function getServerPatchesSnapshot(): DictionaryCorrectionMap {
  return EMPTY_PATCHES;
}

export function useDictionaryCorrections(
  control?: DictionaryCorrectionsControl,
): DictionaryCorrectionsManager {
  const resolved = resolveDictionaryCorrectionsControl(control);
  const localPatches = useSyncExternalStore(
    resolved.managed ? () => () => undefined : subscribeLocalCorrections,
    resolved.managed ? () => resolved.user : getLocalPatchesSnapshot,
    getServerPatchesSnapshot,
  );

  const save = useCallback(
    (word: string, patch: DictionaryCorrectionPatch | null) => {
      if (resolved.disabled) return;
      if (resolved.managed && resolved.onChange === undefined) {
        throw new Error('corrections.onChange 缺失：托管模式必须提供持久化回调，补丁未保存。');
      }
      const key = normalizeDictionaryCorrectionKey(word);
      if (!resolved.managed) {
        const cache = getLocalCorrectionsCache();
        const next: Record<string, DictionaryCorrectionPatch> = Object.fromEntries(
          Object.entries(cache.patches).filter(([patchKey]) => patchKey !== key),
        );
        if (patch !== null) next[key] = patch;
        writeLocalCorrections(next);
      }
      resolved.onChange?.(key, patch);
    },
    [resolved],
  );

  const reset = useCallback(
    (word: string) => {
      save(word, null);
    },
    [save],
  );

  return useMemo(
    () => ({
      disabled: resolved.disabled,
      editable: resolved.editable,
      managed: resolved.managed,
      onChange: resolved.onChange,
      reset,
      save,
      system: resolved.system,
      user: resolved.managed ? resolved.user : localPatches,
    }),
    [localPatches, reset, resolved, save],
  );
}
