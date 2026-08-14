import snapshot from '../data/oanc-examples-toefl.tsv?raw';
import { TOEFL_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const toeflExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  TOEFL_EXAMPLE_METADATA,
);
