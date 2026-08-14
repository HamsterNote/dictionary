import { useCallback, useState } from 'react';
import type { EnglishInflectionFormsPack, EnglishInflectionIndexPack } from '../../src';
import { loadInflectionFormsPack, loadInflectionIndexPack } from './dictionaryPackLoaders';
import type { SupplementOptionId } from './dictionaryPacks';

export type InflectionSupplementId = Extract<
  SupplementOptionId,
  'supplements:inflection-index' | 'supplements:inflections'
>;

export function isInflectionSupplementId(id: string): id is InflectionSupplementId {
  return id === 'supplements:inflections' || id === 'supplements:inflection-index';
}

export function useEnglishInflectionPacks(enabledSupplements: ReadonlySet<SupplementOptionId>) {
  const [formsPack, setFormsPack] = useState<EnglishInflectionFormsPack>();
  const [indexPack, setIndexPack] = useState<EnglishInflectionIndexPack>();
  const load = useCallback((id: InflectionSupplementId): Promise<void> => {
    return id === 'supplements:inflections'
      ? loadInflectionFormsPack().then(setFormsPack)
      : loadInflectionIndexPack().then(setIndexPack);
  }, []);

  return {
    formsPacks: enabledSupplements.has('supplements:inflections') && formsPack ? [formsPack] : [],
    indexPacks:
      enabledSupplements.has('supplements:inflection-index') && indexPack ? [indexPack] : [],
    load,
  };
}
