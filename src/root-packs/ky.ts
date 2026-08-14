import snapshot from '../data/unimorph-roots-ky.tsv?raw';
import { KY_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const kyRootPack = createEnglishRootPack(snapshot, KY_ROOT_METADATA);
