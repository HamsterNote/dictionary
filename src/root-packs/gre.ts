import snapshot from '../data/unimorph-roots-gre.tsv?raw';
import { GRE_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const greRootPack = createEnglishRootPack(snapshot, GRE_ROOT_METADATA);
