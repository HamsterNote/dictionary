import type {
  EnglishInflection,
  EnglishInflectionFormsPack,
  EnglishInflectionIndexPack,
  EnglishInflectionSource,
} from './englishInflectionPack';

export function findEnglishInflectionSources(
  normalizedQuery: string,
  packs: readonly EnglishInflectionIndexPack[],
): readonly EnglishInflectionSource[] {
  return packs
    .flatMap((pack) => pack.entries.get(normalizedQuery) ?? [])
    .filter(
      (source, index, allSources) =>
        allSources.findIndex(
          (candidate) => candidate.lemma === source.lemma && candidate.kind === source.kind,
        ) === index,
    );
}

export function findEnglishInflections(
  normalizedQuery: string,
  packs: readonly EnglishInflectionFormsPack[],
): readonly EnglishInflection[] {
  return packs
    .flatMap((pack) => pack.entries.get(normalizedQuery) ?? [])
    .filter(
      (inflection, index, allInflections) =>
        allInflections.findIndex(
          (candidate) => candidate.kind === inflection.kind && candidate.form === inflection.form,
        ) === index,
    );
}
