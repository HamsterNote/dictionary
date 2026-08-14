import snapshot from '../data/unimorph-roots-cet4.tsv?raw';
import { CET4_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const cet4RootPack = createEnglishRootPack(snapshot, CET4_ROOT_METADATA);
