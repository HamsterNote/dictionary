import snapshot from '../data/unimorph-roots-gk.tsv?raw';
import { GK_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const gkRootPack = createEnglishRootPack(snapshot, GK_ROOT_METADATA);
