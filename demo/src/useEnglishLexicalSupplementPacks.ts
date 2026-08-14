import { useCallback, useMemo, useState } from 'react';
import type { EnglishExampleSentencePack, EnglishRootPack, EnglishSynonymPack } from '../../src';
import { loadExamplePack, loadRootPack, loadSynonymPack } from './dictionaryPackLoaders';
import type { EnglishSupplementPackId, SupplementOptionId } from './dictionaryPacks';

function orderedPacks<Pack>(
  packs: ReadonlyMap<string, Pack>,
  ids: readonly EnglishSupplementPackId[],
): readonly Pack[] {
  return ids.flatMap((id) => {
    const pack = packs.get(id);
    return pack === undefined ? [] : [pack];
  });
}

export function useEnglishLexicalSupplementPacks(
  activePackIds: readonly EnglishSupplementPackId[],
  enabledSupplements: ReadonlySet<SupplementOptionId>,
) {
  const [examplePacks, setExamplePacks] = useState<ReadonlyMap<string, EnglishExampleSentencePack>>(
    new Map(),
  );
  const [rootPacks, setRootPacks] = useState<ReadonlyMap<string, EnglishRootPack>>(new Map());
  const [synonymPacks, setSynonymPacks] = useState<ReadonlyMap<string, EnglishSynonymPack>>(
    new Map(),
  );

  const load = useCallback(
    (ids: readonly EnglishSupplementPackId[], supplements: ReadonlySet<SupplementOptionId>) => {
      const promises: Promise<void>[] = [];
      for (const id of ids) {
        if (supplements.has('supplements:examples') && !examplePacks.has(id)) {
          promises.push(
            loadExamplePack(id).then((pack) => {
              setExamplePacks((current) => new Map(current).set(id, pack));
            }),
          );
        }
        if (supplements.has('supplements:roots') && !rootPacks.has(id)) {
          promises.push(
            loadRootPack(id).then((pack) => {
              setRootPacks((current) => new Map(current).set(id, pack));
            }),
          );
        }
        if (supplements.has('supplements:synonyms') && !synonymPacks.has(id)) {
          promises.push(
            loadSynonymPack(id).then((pack) => {
              setSynonymPacks((current) => new Map(current).set(id, pack));
            }),
          );
        }
      }
      return Promise.all(promises);
    },
    [examplePacks, rootPacks, synonymPacks],
  );

  return {
    examplePacks: useMemo(
      () =>
        enabledSupplements.has('supplements:examples')
          ? orderedPacks(examplePacks, activePackIds)
          : [],
      [activePackIds, enabledSupplements, examplePacks],
    ),
    load,
    rootPacks: useMemo(
      () =>
        enabledSupplements.has('supplements:roots') ? orderedPacks(rootPacks, activePackIds) : [],
      [activePackIds, enabledSupplements, rootPacks],
    ),
    synonymPacks: useMemo(
      () =>
        enabledSupplements.has('supplements:synonyms')
          ? orderedPacks(synonymPacks, activePackIds)
          : [],
      [activePackIds, enabledSupplements, synonymPacks],
    ),
  };
}
