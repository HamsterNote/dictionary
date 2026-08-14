import snapshot from '../data/unimorph-roots-cet6.tsv?raw';
import { CET6_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const cet6RootPack = createEnglishRootPack(snapshot, CET6_ROOT_METADATA);
