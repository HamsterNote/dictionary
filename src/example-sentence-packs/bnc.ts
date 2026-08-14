import snapshot from '../data/oanc-examples-bnc.tsv?raw';
import { BNC_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const bncExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  BNC_EXAMPLE_METADATA,
);
