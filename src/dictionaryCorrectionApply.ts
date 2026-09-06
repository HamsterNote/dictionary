import type { DictionaryDetail } from './dictionaryData';
import type {
  DictionaryCorrectedDetail,
  DictionaryCorrectedField,
  DictionaryCorrectedSummary,
  DictionaryCorrectionOrigin,
  DictionaryCorrectionViewConfig,
} from './dictionaryCorrections';
import { resolveDictionaryCorrection } from './dictionaryCorrections';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';

const NO_ENTRY_PLACEHOLDER = '（原词库无此词条）';

export function applyDictionaryCorrectionToSummary(
  summary: DictionaryEntrySummary,
  corrections: DictionaryCorrectionViewConfig,
): DictionaryCorrectedSummary {
  const resolved = resolveDictionaryCorrection(summary.word, corrections);
  if (resolved === undefined) return { changes: [], originalWord: summary.word, summary };
  const { fieldOrigins, patch } = resolved;
  const changes: DictionaryCorrectedField[] = [];
  if (patch.word !== undefined && patch.word !== summary.word) {
    changes.push({
      after: patch.word,
      before: summary.word,
      field: 'word',
      origin: fieldOrigins.word ?? resolved.origin,
    });
  }
  const originalPhonetic = summary.phonetic ?? '';
  if (patch.phonetic !== undefined && patch.phonetic !== originalPhonetic) {
    changes.push({
      after: patch.phonetic,
      before: originalPhonetic,
      field: 'phonetic',
      origin: fieldOrigins.phonetic ?? resolved.origin,
    });
  }
  if (patch.meaning !== undefined && patch.meaning !== summary.definition) {
    changes.push({
      after: patch.meaning,
      before: summary.definition,
      field: 'meaning',
      origin: fieldOrigins.meaning ?? resolved.origin,
    });
  }
  return {
    changes,
    originalWord: summary.word,
    summary: {
      definition: patch.meaning ?? summary.definition,
      ...(patch.phonetic === undefined
        ? summary.phonetic === undefined
          ? {}
          : { phonetic: summary.phonetic }
        : { phonetic: patch.phonetic }),
      word: patch.word ?? summary.word,
    },
  };
}

export function applyDictionaryCorrectionToDetail(
  detail: DictionaryDetail,
  corrections: DictionaryCorrectionViewConfig,
): DictionaryCorrectedDetail {
  const resolved = resolveDictionaryCorrection(detail.word, corrections);
  if (resolved === undefined) return { changes: [], detail };
  const { fieldOrigins, patch } = resolved;
  const changes: DictionaryCorrectedField[] = [];
  if (patch.word !== undefined && patch.word !== detail.word) {
    changes.push({
      after: patch.word,
      before: detail.word,
      field: 'word',
      origin: fieldOrigins.word ?? resolved.origin,
    });
  }
  const originalPhonetic = detail.phonetic ?? '';
  if (patch.phonetic !== undefined && patch.phonetic !== originalPhonetic) {
    changes.push({
      after: patch.phonetic,
      before: originalPhonetic,
      field: 'phonetic',
      origin: fieldOrigins.phonetic ?? resolved.origin,
    });
  }
  const firstSource = detail.sources[0];
  const firstMeaning = firstSource?.meanings[0];
  const correctedMeaning = patch.meaning;
  const meaningApplies =
    correctedMeaning !== undefined && firstSource !== undefined && firstMeaning !== undefined;
  if (meaningApplies && correctedMeaning !== firstMeaning.definition) {
    changes.push({
      after: correctedMeaning,
      before: firstMeaning.definition,
      field: 'meaning',
      origin: fieldOrigins.meaning ?? resolved.origin,
    });
  }
  return {
    changes,
    detail: {
      ...(patch.phonetic === undefined
        ? detail.phonetic === undefined
          ? {}
          : { phonetic: detail.phonetic }
        : { phonetic: patch.phonetic }),
      sources: meaningApplies
        ? detail.sources.map((source, sourceIndex) =>
            sourceIndex === 0
              ? {
                  ...source,
                  meanings: source.meanings.map((meaning, meaningIndex) =>
                    meaningIndex === 0 ? { ...meaning, definition: correctedMeaning } : meaning,
                  ),
                }
              : source,
          )
        : detail.sources,
      word: patch.word ?? detail.word,
    },
  };
}

/**
 * 为词典中不存在但已被纠错的词头构造展示详情。
 * 词库原文缺失时，每个被补丁的字段都记为变化，原始值记为占位符。
 */
export function createDictionaryCorrectedDetail(
  query: string,
  corrections: DictionaryCorrectionViewConfig,
): DictionaryCorrectedDetail | undefined {
  const word = query.trim();
  if (word.length === 0) return undefined;
  const resolved = resolveDictionaryCorrection(word, corrections);
  if (resolved === undefined) return undefined;
  const { fieldOrigins, patch } = resolved;
  const fieldOrigin = (field: DictionaryCorrectedField['field']): DictionaryCorrectionOrigin =>
    fieldOrigins[field] ?? resolved.origin;
  const changes: DictionaryCorrectedField[] = [];
  if (patch.word !== undefined && patch.word !== word) {
    changes.push({ after: patch.word, before: word, field: 'word', origin: fieldOrigin('word') });
  }
  if (patch.phonetic !== undefined) {
    changes.push({
      after: patch.phonetic,
      before: '',
      field: 'phonetic',
      origin: fieldOrigin('phonetic'),
    });
  }
  if (patch.meaning !== undefined) {
    changes.push({
      after: patch.meaning,
      before: NO_ENTRY_PLACEHOLDER,
      field: 'meaning',
      origin: fieldOrigin('meaning'),
    });
  }
  return {
    changes,
    detail: {
      ...(patch.phonetic === undefined ? {} : { phonetic: patch.phonetic }),
      sources: [
        {
          id: 'correction',
          label: Object.values(fieldOrigins).every((origin) => origin === 'system')
            ? '系统纠错'
            : Object.values(fieldOrigins).every((origin) => origin === 'user')
              ? '用户纠错'
              : '纠错补丁',
          meanings: [
            { definition: patch.meaning ?? NO_ENTRY_PLACEHOLDER, id: `${word}-correction-1` },
          ],
        },
      ],
      word: patch.word ?? word,
    },
  };
}
