import snapshot from '../data/unimorph-roots-bnc.tsv?raw';
import { BNC_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const bncRootPack = createEnglishRootPack(snapshot, BNC_ROOT_METADATA);
