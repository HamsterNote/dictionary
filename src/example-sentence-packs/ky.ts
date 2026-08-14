import snapshot from '../data/oanc-examples-ky.tsv?raw';
import { KY_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const kyExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  KY_EXAMPLE_METADATA,
);
