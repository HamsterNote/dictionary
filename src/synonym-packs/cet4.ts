import snapshot from '../data/wordnet-synonyms-cet4.tsv?raw';
import { CET4_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const cet4SynonymPack = createEnglishSynonymPack(snapshot, CET4_SYNONYM_METADATA);
