import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  DictionaryCorrectionMap,
  DictionaryCorrectionPatch,
  DictionaryCorrectionsControl,
  DictionaryCorrectionStore,
  ResolvedDictionaryCorrectionsControl,
} from './dictionaryCorrections';
import { resolveDictionaryCorrectionWriteKey } from './dictionaryCorrections';
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

export interface LocalCorrectionsCache {
  loadError?: Error;
  patches: DictionaryCorrectionMap;
  store: DictionaryCorrectionStore;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function createLocalCorrectionsCache(
  store: DictionaryCorrectionStore = createLocalDictionaryCorrectionStore(),
): LocalCorrectionsCache {
  try {
    return { patches: store.load(), store };
  } catch (loadError) {
    return { loadError: toError(loadError), patches: EMPTY_PATCHES, store };
  }
}

// 每个标签页一份缓存，useSyncExternalStore 保证同页多个词典实例同步；
// SSR 下不读取 localStorage，模块作用域也不持有用户数据。
let localCorrectionsCache: LocalCorrectionsCache | undefined;
const localCorrectionsSubscribers = new Set<() => void>();

function getLocalCorrectionsCache(): LocalCorrectionsCache {
  localCorrectionsCache ??= createLocalCorrectionsCache();
  return localCorrectionsCache;
}

function writeLocalCorrections(patches: DictionaryCorrectionMap): void {
  const cache = getLocalCorrectionsCache();
  if (cache.loadError !== undefined) throw cache.loadError;
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
      if (!resolved.managed) {
        const cache = getLocalCorrectionsCache();
        // 非受控本地存储同样必须复用 cache.patches 中「真正命中的键」：
        // 预置数据可能是真实键 `Note` 而非规范化键 `note`；若按规范化键
        // 更新/删除，reset('note') 既清不掉 `Note`，又会留下无意义的 `note`。
        // 表中没有等价条目（新词）时才回落到规范化键。
        const key = resolveDictionaryCorrectionWriteKey(word, cache.patches);
        const next: Record<string, DictionaryCorrectionPatch> = Object.fromEntries([
          ...Object.entries(cache.patches).filter(([patchKey]) => patchKey !== key),
          ...(patch === null ? [] : [[key, patch] as const]),
        ]);
        writeLocalCorrections(next);
        resolved.onChange?.(key, patch);
        return;
      }
      // 受控模式必须复用宿主 user 表中已有的真实键（如 `Note`），
      // 否则保存/清除会落到规范化新键上，原条目永远更新/删除不掉。
      const key = resolveDictionaryCorrectionWriteKey(word, resolved.user);
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
