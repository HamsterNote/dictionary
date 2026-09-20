import { useMemo } from 'react';
import type { DictionaryGetDetail, DictionaryMeaning, DictionarySource } from './dictionaryData';
import {
  applyDictionaryCorrectionToDetail,
  createDictionaryCorrectedDetail,
} from './dictionaryCorrectionApply';
import type {
  DictionaryCorrectedField,
  ResolvedDictionaryCorrectionsControl,
} from './dictionaryCorrections';
import { resolveDictionaryCorrection } from './dictionaryCorrections';
import { getDictionaryCorrectionViews } from './dictionaryCorrectionViews';

interface CorrectedContentOptions {
  readonly activeKeyword: string;
  readonly corrections: ResolvedDictionaryCorrectionsControl;
  readonly getDetail: DictionaryGetDetail;
  readonly providedMeanings: readonly DictionaryMeaning[] | undefined;
  readonly providedPhonetic: string | undefined;
  readonly providedSources: readonly DictionarySource[] | undefined;
}

export interface DictionaryCorrectedContent {
  readonly changes: readonly DictionaryCorrectedField[];
  readonly meanings: readonly DictionaryMeaning[];
  /** 词条原始音标（无任何补丁时 getDetail/宿主提供的值）。 */
  readonly originalPhonetic: string;
  readonly phonetic: string | undefined;
  readonly sources: readonly DictionarySource[] | undefined;
  readonly word: string;
}

/** 把纠错补丁合并进词条内容：展示用补丁值，原始值保留给详情对比与保存基准。 */
export function useDictionaryCorrectedContent({
  activeKeyword,
  corrections,
  getDetail,
  providedMeanings,
  providedPhonetic,
  providedSources,
}: CorrectedContentOptions): DictionaryCorrectedContent {
  return useMemo(() => {
    const hasProvidedContent = providedMeanings !== undefined || providedSources !== undefined;
    // 来源、释义与音标独立解析：宿主内容优先，但未显式提供音标时仍读取词典音标。
    // 当宿主已同时提供内容和音标时，无需再做一次无意义的详情查询。
    const rawDetail =
      !hasProvidedContent || providedPhonetic === undefined ? getDetail(activeKeyword) : undefined;
    const correctedDetail = (() => {
      if (hasProvidedContent) return undefined;
      if (rawDetail !== undefined) return applyDictionaryCorrectionToDetail(rawDetail, corrections);
      if (!corrections.disabled) return createDictionaryCorrectedDetail(activeKeyword, corrections);
      return undefined;
    })();
    const detailMeanings =
      correctedDetail?.detail.sources.flatMap((source) => source.meanings) ?? [];
    const firstDefinition =
      providedMeanings?.[0]?.definition ??
      providedSources?.[0]?.meanings[0]?.definition ??
      rawDetail?.sources[0]?.meanings[0]?.definition;
    const rawMeaning = typeof firstDefinition === 'string' ? firstDefinition : '';
    const rawPhonetic = providedPhonetic ?? rawDetail?.phonetic ?? '';
    const views = getDictionaryCorrectionViews(
      { definition: rawMeaning, phonetic: rawPhonetic, word: activeKeyword },
      corrections,
    );
    const resolved = resolveDictionaryCorrection(activeKeyword, corrections);
    const patch = resolved?.patch;
    const fieldOrigin = (field: DictionaryCorrectedField['field']) =>
      resolved?.fieldOrigins[field] ?? resolved?.origin ?? 'user';
    const meaningPatch = patch?.meaning;
    const providedContentMeanings =
      providedMeanings ?? providedSources?.flatMap((source) => source.meanings);
    const meanings: readonly DictionaryMeaning[] =
      providedContentMeanings !== undefined && meaningPatch !== undefined
        ? providedContentMeanings.map((meaning, index) =>
            index === 0 ? { ...meaning, definition: meaningPatch } : meaning,
          )
        : (providedContentMeanings ?? detailMeanings);
    const sources: readonly DictionarySource[] | undefined = (() => {
      if (providedSources !== undefined) {
        if (meaningPatch === undefined) return providedSources;
        return providedSources.map((source, sourceIndex) =>
          sourceIndex === 0
            ? {
                ...source,
                meanings: source.meanings.map((meaning, meaningIndex) =>
                  meaningIndex === 0 ? { ...meaning, definition: meaningPatch } : meaning,
                ),
              }
            : source,
        );
      }
      if (!hasProvidedContent) return correctedDetail?.detail.sources;
      return undefined;
    })();
    const changes: readonly DictionaryCorrectedField[] = (() => {
      if (patch === undefined) return [];
      const fieldChanges: DictionaryCorrectedField[] = [];
      if (patch.word !== undefined && patch.word !== activeKeyword) {
        fieldChanges.push({
          after: patch.word,
          before: activeKeyword,
          field: 'word',
          origin: fieldOrigin('word'),
        });
      }
      if (patch.phonetic !== undefined && patch.phonetic !== rawPhonetic) {
        fieldChanges.push({
          after: patch.phonetic,
          before: rawPhonetic,
          field: 'phonetic',
          origin: fieldOrigin('phonetic'),
        });
      }
      if (patch.meaning !== undefined && patch.meaning !== rawMeaning) {
        fieldChanges.push({
          after: patch.meaning,
          before: rawMeaning,
          field: 'meaning',
          origin: fieldOrigin('meaning'),
        });
      }
      return fieldChanges;
    })();
    return {
      changes,
      meanings,
      originalPhonetic: rawPhonetic,
      phonetic: views.corrected.phonetic === '' ? undefined : views.corrected.phonetic,
      sources,
      word: views.corrected.word,
    };
  }, [activeKeyword, corrections, getDetail, providedMeanings, providedPhonetic, providedSources]);
}
