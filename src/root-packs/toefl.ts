import snapshot from '../data/unimorph-roots-toefl.tsv?raw';
import { TOEFL_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const toeflRootPack = createEnglishRootPack(snapshot, TOEFL_ROOT_METADATA);
