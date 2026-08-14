import snapshot from '../data/oanc-examples-zk.tsv?raw';
import { ZK_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const zkExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  ZK_EXAMPLE_METADATA,
);
