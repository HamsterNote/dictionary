import snapshot from '../data/wordnet-synonyms-gre.tsv?raw';
import { GRE_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const greSynonymPack = createEnglishSynonymPack(snapshot, GRE_SYNONYM_METADATA);
