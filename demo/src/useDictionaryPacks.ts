import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChineseDictionaryPack, EnglishChineseVocabularyPack } from '../../src';
import { loadChinesePack, loadEnglishPack } from './dictionaryPackLoaders';
import {
  CHINESE_DICTIONARY_PACK_ORDER,
  DICTIONARY_PACK_GROUPS,
  ENGLISH_VOCABULARY_PACK_ORDER,
  type EnglishSupplementPackId,
  isChineseDictionaryPackId,
  isDictionaryPackId,
  isEnglishVocabularyPackId,
  type SupplementOptionId,
} from './dictionaryPacks';
import { isInflectionSupplementId, useEnglishInflectionPacks } from './useEnglishInflectionPacks';
import { useEnglishLexicalSupplementPacks } from './useEnglishLexicalSupplementPacks';

function removeLoadingIds(
  current: ReadonlySet<string>,
  ids: readonly string[],
): ReadonlySet<string> {
  const next = new Set(current);
  for (const id of ids) next.delete(id);
  return next;
}

export function useDictionaryPacks() {
  const [activeChinesePacks, setActiveChinesePacks] = useState<
    ReadonlyMap<string, ChineseDictionaryPack>
  >(new Map());
  const [activeEnglishPacks, setActiveEnglishPacks] = useState<
    ReadonlyMap<string, EnglishChineseVocabularyPack>
  >(new Map());
  const [enabledSupplements, setEnabledSupplements] = useState<ReadonlySet<SupplementOptionId>>(
    new Set(),
  );
  const enabledSupplementsRef = useRef(enabledSupplements);
  const [loadError, setLoadError] = useState('');
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set());
  const inflectionPacks = useEnglishInflectionPacks(enabledSupplements);

  const activeSupplementPackIds = useMemo<readonly EnglishSupplementPackId[]>(
    () => ['core', ...ENGLISH_VOCABULARY_PACK_ORDER.filter((id) => activeEnglishPacks.has(id))],
    [activeEnglishPacks],
  );
  const lexicalPacks = useEnglishLexicalSupplementPacks(
    activeSupplementPackIds,
    enabledSupplements,
  );
  const chineseDictionaryPacks = useMemo(
    () =>
      CHINESE_DICTIONARY_PACK_ORDER.flatMap((id) => {
        const pack = activeChinesePacks.get(id);
        return pack === undefined ? [] : [pack];
      }),
    [activeChinesePacks],
  );
  const englishVocabularyPacks = useMemo(
    () =>
      ENGLISH_VOCABULARY_PACK_ORDER.flatMap((id) => {
        const pack = activeEnglishPacks.get(id);
        return pack === undefined ? [] : [pack];
      }),
    [activeEnglishPacks],
  );
  const activeIds = useMemo(
    () =>
      new Set([...activeChinesePacks.keys(), ...activeEnglishPacks.keys(), ...enabledSupplements]),
    [activeChinesePacks, activeEnglishPacks, enabledSupplements],
  );

  const toggle = useCallback(
    (id: string, enabled: boolean) => {
      if (!isDictionaryPackId(id)) return;
      setLoadError('');
      if (isInflectionSupplementId(id)) {
        const nextSupplements = new Set(enabledSupplementsRef.current);
        if (enabled) {
          nextSupplements.add(id);
        } else {
          nextSupplements.delete(id);
        }
        enabledSupplementsRef.current = nextSupplements;
        setEnabledSupplements(nextSupplements);
        if (!enabled) return;
        setLoadingIds((current) => new Set(current).add(id));
        void inflectionPacks.load(id).then(
          () => {
            setLoadingIds((current) => removeLoadingIds(current, [id]));
          },
          () => {
            const reverted = new Set(enabledSupplementsRef.current);
            reverted.delete(id);
            enabledSupplementsRef.current = reverted;
            setEnabledSupplements(reverted);
            setLoadError(
              `${id === 'supplements:inflections' ? 'ECDICT 变形' : 'ECDICT 变形反向查询'}加载失败，请重试。`,
            );
            setLoadingIds((current) => removeLoadingIds(current, [id]));
          },
        );
        return;
      }
      if (
        id === 'supplements:examples' ||
        id === 'supplements:roots' ||
        id === 'supplements:synonyms'
      ) {
        if (!enabled) {
          const nextSupplements = new Set(
            [...enabledSupplementsRef.current].filter((key) => key !== id),
          );
          enabledSupplementsRef.current = nextSupplements;
          setEnabledSupplements(nextSupplements);
          return;
        }
        const nextSupplements = new Set(enabledSupplementsRef.current).add(id);
        enabledSupplementsRef.current = nextSupplements;
        setEnabledSupplements(nextSupplements);
        setLoadingIds((current) => new Set(current).add(id));
        void lexicalPacks.load(activeSupplementPackIds, nextSupplements).then(
          () => {
            setLoadingIds((current) => removeLoadingIds(current, [id]));
          },
          () => {
            const nextSupplements = new Set(
              [...enabledSupplementsRef.current].filter((key) => key !== id),
            );
            enabledSupplementsRef.current = nextSupplements;
            setEnabledSupplements(nextSupplements);
            const label =
              id === 'supplements:examples'
                ? '英语例句补充'
                : id === 'supplements:roots'
                  ? 'UniMorph 派生基词'
                  : '英文近义词补充';
            setLoadError(`${label}加载失败，请重试。`);
            setLoadingIds((current) => removeLoadingIds(current, [id]));
          },
        );
        return;
      }

      if (!enabled) {
        setActiveChinesePacks((current) => new Map([...current].filter(([key]) => key !== id)));
        setActiveEnglishPacks((current) => new Map([...current].filter(([key]) => key !== id)));
        return;
      }

      setLoadingIds((current) => new Set(current).add(id));
      if (isEnglishVocabularyPackId(id)) {
        void loadEnglishPack(id).then(
          (pack) => {
            void lexicalPacks.load([id], enabledSupplementsRef.current).then(
              () => {
                setActiveEnglishPacks((current) => new Map(current).set(id, pack));
                setLoadingIds((current) => removeLoadingIds(current, [id]));
              },
              () => {
                setLoadError(`${pack.label}的补充包加载失败，请重试。`);
                setLoadingIds((current) => removeLoadingIds(current, [id]));
              },
            );
          },
          () => {
            setLoadError(`${id}加载失败，请检查网络后重试。`);
            setLoadingIds((current) => removeLoadingIds(current, [id]));
          },
        );
        return;
      }
      if (!isChineseDictionaryPackId(id)) return;
      void loadChinesePack(id).then(
        (pack) => {
          setActiveChinesePacks((current) => new Map(current).set(id, pack));
          setLoadingIds((current) => removeLoadingIds(current, [id]));
        },
        () => {
          const option = DICTIONARY_PACK_GROUPS.flatMap((group) => group.options).find(
            (candidate) => candidate.id === id,
          );
          setLoadError(`${option?.label ?? id}加载失败，请检查网络后重试。`);
          setLoadingIds((current) => removeLoadingIds(current, [id]));
        },
      );
    },
    [activeSupplementPackIds, inflectionPacks, lexicalPacks],
  );

  return {
    activeIds,
    chineseDictionaryPacks,
    englishExampleSentencePacks: lexicalPacks.examplePacks,
    englishInflectionFormsPacks: inflectionPacks.formsPacks,
    englishInflectionIndexPacks: inflectionPacks.indexPacks,
    englishRootPacks: lexicalPacks.rootPacks,
    englishSynonymPacks: lexicalPacks.synonymPacks,
    englishVocabularyPacks,
    loadError,
    loadingIds,
    toggle,
  };
}
