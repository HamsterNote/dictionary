import snapshot from '../data/wordnet-synonyms-ielts.tsv?raw';
import { IELTS_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const ieltsSynonymPack = createEnglishSynonymPack(snapshot, IELTS_SYNONYM_METADATA);
