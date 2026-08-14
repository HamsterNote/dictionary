import snapshot from '../data/wordnet-synonyms-gk.tsv?raw';
import { GK_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const gkSynonymPack = createEnglishSynonymPack(snapshot, GK_SYNONYM_METADATA);
