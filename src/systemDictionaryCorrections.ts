import rawSystemCorrections from './data/dictionarySystemCorrections.json';
import type { DictionaryCorrectionMap } from './dictionaryCorrections';
import { sanitizeDictionaryCorrectionMap } from './dictionaryCorrections';

/**
 * 随包分发的系统级纠错表，数据本体在 `data/dictionarySystemCorrections.json`。
 * 数据收录已确认的词库勘误；后续新增条目必须逐条注明来源并评审。
 * 字段优先级：用户纠错 > 系统纠错 > 词典原文。
 */
export const SYSTEM_DICTIONARY_CORRECTIONS: DictionaryCorrectionMap =
  sanitizeDictionaryCorrectionMap(rawSystemCorrections);
