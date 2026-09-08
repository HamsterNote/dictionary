import type { DictionarySource } from './dictionaryData';
import { ECDICT_SOURCE, OANC_SOURCE, UNIMORPH_SOURCE, WORDNET_SOURCE } from './dictionarySources';
import { ENGLISH_INFLECTION_LABELS } from './englishInflectionPack';
import type { EnglishChineseLookupResult } from './lookupEnglishChinese';

export function createEnglishResultSources(
  result: EnglishChineseLookupResult,
  matchingLabels = '',
): readonly DictionarySource[] {
  if (result.status !== 'found') return [];

  return [
    {
      ...ECDICT_SOURCE,
      label: matchingLabels ? `ECDICT · 命中：${matchingLabels}` : ECDICT_SOURCE.label,
      meanings: result.meanings,
    },
    ...(result.inflections.length > 0
      ? [
          {
            ...ECDICT_SOURCE,
            heading: '变形',
            id: 'ecdict-inflections',
            meanings: result.inflections.map((inflection, index) => ({
              definition: inflection.form,
              id: `${result.word}-inflection-${String(index + 1)}`,
              partOfSpeech: ENGLISH_INFLECTION_LABELS[inflection.kind],
            })),
          },
        ]
      : []),
    ...(result.examples.length > 0
      ? [{ ...OANC_SOURCE, examples: result.examples, heading: '例句', meanings: [] }]
      : []),
    ...(result.synonyms.length > 0
      ? [
          {
            ...WORDNET_SOURCE,
            heading: '近义词',
            meanings: [
              {
                definition: result.synonyms.join(' · '),
                id: `${result.word}-synonyms`,
                partOfSpeech: 'synonyms · 近义词',
              },
            ],
          },
        ]
      : []),
    ...(result.roots.length > 0
      ? [
          {
            ...UNIMORPH_SOURCE,
            heading: '派生基词',
            meanings: result.roots.map((root, index) => ({
              definition: `${root.base} ${root.affix}`,
              id: `${result.word}-root-${String(index + 1)}`,
              partOfSpeech: `${root.sourcePartOfSpeech} → ${root.targetPartOfSpeech}`,
            })),
          },
        ]
      : []),
  ];
}
