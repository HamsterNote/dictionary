import type {
  DictionaryCorrectionEntryLike,
  DictionaryCorrectionViewConfig,
  DictionaryCorrectionViews,
} from './dictionaryCorrections';
import { resolveDictionaryCorrection } from './dictionaryCorrections';

export function getDictionaryCorrectionViews(
  entry: DictionaryCorrectionEntryLike,
  corrections: DictionaryCorrectionViewConfig,
): DictionaryCorrectionViews {
  const originalPhonetic = entry.phonetic ?? '';
  const originalMeaning = entry.definition ?? entry.sources?.[0]?.meanings[0]?.definition ?? '';
  const original = {
    meaning: originalMeaning,
    phonetic: originalPhonetic,
    word: entry.word,
  };
  const patch = resolveDictionaryCorrection(entry.word, corrections)?.patch;
  return {
    corrected: {
      meaning: patch?.meaning ?? originalMeaning,
      phonetic: patch?.phonetic ?? originalPhonetic,
      word: patch?.word ?? entry.word,
    },
    original,
  };
}
