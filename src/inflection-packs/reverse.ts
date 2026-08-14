import snapshot from '../data/ecdict-inflection-index.tsv?raw';
import { INFLECTION_INDEX_METADATA } from '../data/ecdictInflectionManifest';
import { createEnglishInflectionIndexPack } from '../englishInflectionPack';

export const ecdictInflectionIndexPack = createEnglishInflectionIndexPack(
  snapshot,
  INFLECTION_INDEX_METADATA,
);
