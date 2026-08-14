import snapshot from '../data/wordnet-synonyms-toefl.tsv?raw';
import { TOEFL_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const toeflSynonymPack = createEnglishSynonymPack(snapshot, TOEFL_SYNONYM_METADATA);
