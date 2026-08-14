import snapshot from '../data/unimorph-roots-core.tsv?raw';
import { CORE_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const coreRootPack = createEnglishRootPack(snapshot, CORE_ROOT_METADATA);
