import snapshot from '../data/wordnet-synonyms-cet6.tsv?raw';
import { CET6_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const cet6SynonymPack = createEnglishSynonymPack(snapshot, CET6_SYNONYM_METADATA);
