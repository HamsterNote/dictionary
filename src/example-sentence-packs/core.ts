import snapshot from '../data/oanc-examples-core.tsv?raw';
import { CORE_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const coreExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  CORE_EXAMPLE_METADATA,
);
