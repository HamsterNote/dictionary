import snapshot from '../data/wordnet-synonyms-bnc.tsv?raw';
import { BNC_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const bncSynonymPack = createEnglishSynonymPack(snapshot, BNC_SYNONYM_METADATA);
