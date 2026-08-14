import snapshot from '../data/oanc-examples-gre.tsv?raw';
import { GRE_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const greExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  GRE_EXAMPLE_METADATA,
);
