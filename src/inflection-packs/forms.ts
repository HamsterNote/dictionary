import snapshot from '../data/ecdict-inflections.tsv?raw';
import { INFLECTION_FORMS_METADATA } from '../data/ecdictInflectionManifest';
import { createEnglishInflectionFormsPack } from '../englishInflectionPack';

export const ecdictInflectionFormsPack = createEnglishInflectionFormsPack(
  snapshot,
  INFLECTION_FORMS_METADATA,
);
