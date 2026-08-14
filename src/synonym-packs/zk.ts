import snapshot from '../data/wordnet-synonyms-zk.tsv?raw';
import { ZK_SYNONYM_METADATA } from '../data/wordnetSynonymManifest';
import { createEnglishSynonymPack } from '../englishSynonymPack';

export const zkSynonymPack = createEnglishSynonymPack(snapshot, ZK_SYNONYM_METADATA);
