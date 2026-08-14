import snapshot from '../data/unimorph-roots-zk.tsv?raw';
import { ZK_ROOT_METADATA } from '../data/unimorphRootManifest';
import { createEnglishRootPack } from '../englishRootPack';

export const zkRootPack = createEnglishRootPack(snapshot, ZK_ROOT_METADATA);
