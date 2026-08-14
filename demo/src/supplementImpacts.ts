import {
  BNC_ROOT_METADATA,
  CET4_ROOT_METADATA,
  CET6_ROOT_METADATA,
  GK_ROOT_METADATA,
  GRE_ROOT_METADATA,
  IELTS_ROOT_METADATA,
  KY_ROOT_METADATA,
  TOEFL_ROOT_METADATA,
  ZK_ROOT_METADATA,
} from '../../src/data/unimorphRootManifest';
import {
  BNC_EXAMPLE_METADATA,
  CET4_EXAMPLE_METADATA,
  CET6_EXAMPLE_METADATA,
  GK_EXAMPLE_METADATA,
  GRE_EXAMPLE_METADATA,
  IELTS_EXAMPLE_METADATA,
  KY_EXAMPLE_METADATA,
  TOEFL_EXAMPLE_METADATA,
  ZK_EXAMPLE_METADATA,
} from '../../src/data/oancExampleManifest';
import {
  BNC_SYNONYM_METADATA,
  CET4_SYNONYM_METADATA,
  CET6_SYNONYM_METADATA,
  GK_SYNONYM_METADATA,
  GRE_SYNONYM_METADATA,
  IELTS_SYNONYM_METADATA,
  KY_SYNONYM_METADATA,
  TOEFL_SYNONYM_METADATA,
  ZK_SYNONYM_METADATA,
} from '../../src/data/wordnetSynonymManifest';
import type { VocabularyPackSupplementImpact } from './VocabularyPackPicker';
import { ENGLISH_VOCABULARY_PACK_ORDER, type EnglishVocabularyPackId } from './dictionaryPacks';

interface SupplementMetadata {
  readonly gzipBytes: number;
}

const EXAMPLE_METADATA: Readonly<Record<EnglishVocabularyPackId, SupplementMetadata>> = {
  bnc: BNC_EXAMPLE_METADATA,
  cet4: CET4_EXAMPLE_METADATA,
  cet6: CET6_EXAMPLE_METADATA,
  gk: GK_EXAMPLE_METADATA,
  gre: GRE_EXAMPLE_METADATA,
  ielts: IELTS_EXAMPLE_METADATA,
  ky: KY_EXAMPLE_METADATA,
  toefl: TOEFL_EXAMPLE_METADATA,
  zk: ZK_EXAMPLE_METADATA,
};

const SYNONYM_METADATA: Readonly<Record<EnglishVocabularyPackId, SupplementMetadata>> = {
  bnc: BNC_SYNONYM_METADATA,
  cet4: CET4_SYNONYM_METADATA,
  cet6: CET6_SYNONYM_METADATA,
  gk: GK_SYNONYM_METADATA,
  gre: GRE_SYNONYM_METADATA,
  ielts: IELTS_SYNONYM_METADATA,
  ky: KY_SYNONYM_METADATA,
  toefl: TOEFL_SYNONYM_METADATA,
  zk: ZK_SYNONYM_METADATA,
};

const ROOT_METADATA: Readonly<Record<EnglishVocabularyPackId, SupplementMetadata>> = {
  bnc: BNC_ROOT_METADATA,
  cet4: CET4_ROOT_METADATA,
  cet6: CET6_ROOT_METADATA,
  gk: GK_ROOT_METADATA,
  gre: GRE_ROOT_METADATA,
  ielts: IELTS_ROOT_METADATA,
  ky: KY_ROOT_METADATA,
  toefl: TOEFL_ROOT_METADATA,
  zk: ZK_ROOT_METADATA,
};

export function createSupplementImpacts(
  activeIds: ReadonlySet<string>,
): ReadonlyMap<string, VocabularyPackSupplementImpact> {
  const examplesEnabled = activeIds.has('supplements:examples');
  const rootsEnabled = activeIds.has('supplements:roots');
  const synonymsEnabled = activeIds.has('supplements:synonyms');
  if (!examplesEnabled && !rootsEnabled && !synonymsEnabled) return new Map();

  return new Map(
    ENGLISH_VOCABULARY_PACK_ORDER.map((id) => {
      return [
        id,
        {
          gzipBytes:
            (examplesEnabled ? EXAMPLE_METADATA[id].gzipBytes : 0) +
            (rootsEnabled ? ROOT_METADATA[id].gzipBytes : 0) +
            (synonymsEnabled ? SYNONYM_METADATA[id].gzipBytes : 0),
          labels: [
            ...(examplesEnabled ? ['英语例句'] : []),
            ...(rootsEnabled ? ['UniMorph 派生基词'] : []),
            ...(synonymsEnabled ? ['WordNet 近义词'] : []),
          ],
        },
      ];
    }),
  );
}
