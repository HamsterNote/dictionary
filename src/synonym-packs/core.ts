import snapshot from '../data/wordnet-synonyms-core.tsv?raw';
import { CORE_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const coreSynonymPack = createEnglishSynonymPack(snapshot, CORE_SYNONYM_METADATA);
