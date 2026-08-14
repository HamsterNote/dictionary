import snapshot from '../data/wordnet-synonyms-ky.tsv?raw';
import { KY_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const kySynonymPack = createEnglishSynonymPack(snapshot, KY_SYNONYM_METADATA);
