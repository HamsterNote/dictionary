import snapshot from '../data/oanc-examples-gk.tsv?raw';
import { GK_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const gkExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  GK_EXAMPLE_METADATA,
);
