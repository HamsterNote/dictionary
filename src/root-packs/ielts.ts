import snapshot from '../data/unimorph-roots-ielts.tsv?raw';
import { IELTS_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const ieltsRootPack = createEnglishRootPack(snapshot, IELTS_ROOT_METADATA);
