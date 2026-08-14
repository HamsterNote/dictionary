import snapshot from '../data/oanc-examples-cet6.tsv?raw';
import { CET6_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const cet6ExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  CET6_EXAMPLE_METADATA,
);
