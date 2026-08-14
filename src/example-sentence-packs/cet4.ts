import snapshot from '../data/oanc-examples-cet4.tsv?raw';
import { CET4_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const cet4ExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  CET4_EXAMPLE_METADATA,
);
