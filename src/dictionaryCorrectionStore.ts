import type { DictionaryCorrectionStore } from './dictionaryCorrections';
import {
  DICTIONARY_CORRECTION_STORAGE_KEY,
  sanitizeDictionaryCorrectionMap,
} from './dictionaryCorrections';

/** 基于任意存储实现创建一个词条纠错仓库；存储异常会原样抛给调用方。 */
export function createDictionaryCorrectionStore(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  storageKey: string = DICTIONARY_CORRECTION_STORAGE_KEY,
): DictionaryCorrectionStore {
  return {
    load: () => {
      const raw = storage.getItem(storageKey);
      if (raw === null) return {};
      try {
        return sanitizeDictionaryCorrectionMap(JSON.parse(raw));
      } catch {
        return {};
      }
    },
    save: (map) => {
      storage.setItem(storageKey, JSON.stringify(map));
    },
  };
}

/** 默认本地持久化：写入当前浏览器 profile 的 localStorage。 */
export function createLocalDictionaryCorrectionStore(): DictionaryCorrectionStore {
  return createDictionaryCorrectionStore(window.localStorage);
}
