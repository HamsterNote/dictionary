import snapshot from '../data/oanc-examples-ielts.tsv?raw';
import { IELTS_EXAMPLE_METADATA } from '../data/oancExampleManifest';
import { createEnglishExampleSentencePack } from '../englishExampleSentencePack';

export const ieltsExampleSentencePack = createEnglishExampleSentencePack(
  snapshot,
  IELTS_EXAMPLE_METADATA,
);
