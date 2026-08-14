import {
  CHINESE_DICTIONARY_DICTIONARY_METADATA,
  CHINESE_DICTIONARY_WORDS_DICTIONARY_METADATA,
  CHINESE_XINHUA_DICTIONARY_METADATA,
  CHINESE_XINHUA_WORDS_DICTIONARY_METADATA,
} from '../../src/data/chineseDictionaryManifest';
import {
  BNC_VOCABULARY_METADATA,
  CET4_VOCABULARY_METADATA,
  CET6_VOCABULARY_METADATA,
  GK_VOCABULARY_METADATA,
  GRE_VOCABULARY_METADATA,
  IELTS_VOCABULARY_METADATA,
  KY_VOCABULARY_METADATA,
  TOEFL_VOCABULARY_METADATA,
  ZK_VOCABULARY_METADATA,
} from '../../src/data/ecdictManifest';
import {
  INFLECTION_FORMS_METADATA,
  INFLECTION_INDEX_METADATA,
} from '../../src/data/ecdictInflectionManifest';
import { CORE_EXAMPLE_METADATA } from '../../src/data/oancExampleManifest';
import { CORE_ROOT_METADATA } from '../../src/data/unimorphRootManifest';
import { CORE_SYNONYM_METADATA } from '../../src/data/wordnetSynonymManifest';
import type { VocabularyPackGroup } from './VocabularyPackPicker';

export type ChineseDictionaryPackId =
  'chinese-dictionary' | 'chinese-dictionary-words' | 'chinese-xinhua' | 'chinese-xinhua-words';
export type EnglishVocabularyPackId =
  'bnc' | 'cet4' | 'cet6' | 'gk' | 'gre' | 'ielts' | 'ky' | 'toefl' | 'zk';
export type EnglishSupplementPackId = 'core' | EnglishVocabularyPackId;
export type SupplementOptionId =
  | 'supplements:examples'
  | 'supplements:inflection-index'
  | 'supplements:inflections'
  | 'supplements:roots'
  | 'supplements:synonyms';
export type DictionaryPackId =
  ChineseDictionaryPackId | EnglishVocabularyPackId | SupplementOptionId;

export const CHINESE_DICTIONARY_PACK_ORDER: readonly ChineseDictionaryPackId[] = [
  'chinese-dictionary',
  'chinese-dictionary-words',
  'chinese-xinhua',
  'chinese-xinhua-words',
];
export const ENGLISH_VOCABULARY_PACK_ORDER: readonly EnglishVocabularyPackId[] = [
  'zk',
  'gk',
  'cet4',
  'cet6',
  'ky',
  'ielts',
  'toefl',
  'gre',
  'bnc',
];

export const DICTIONARY_PACK_GROUPS: readonly VocabularyPackGroup[] = [
  {
    id: 'chinese',
    label: '中文词典',
    options: [
      CHINESE_DICTIONARY_DICTIONARY_METADATA,
      CHINESE_DICTIONARY_WORDS_DICTIONARY_METADATA,
      CHINESE_XINHUA_DICTIONARY_METADATA,
      CHINESE_XINHUA_WORDS_DICTIONARY_METADATA,
    ],
  },
  {
    id: 'school',
    label: '基础学段',
    options: [ZK_VOCABULARY_METADATA, GK_VOCABULARY_METADATA],
  },
  {
    id: 'domestic',
    label: '国内英语考试',
    options: [CET4_VOCABULARY_METADATA, CET6_VOCABULARY_METADATA, KY_VOCABULARY_METADATA],
  },
  {
    id: 'international',
    label: '留学考试',
    options: [IELTS_VOCABULARY_METADATA, TOEFL_VOCABULARY_METADATA, GRE_VOCABULARY_METADATA],
  },
  { id: 'corpus', label: '语料词频', options: [BNC_VOCABULARY_METADATA] },
  {
    id: 'supplements',
    label: '英文全局补充',
    options: [
      {
        ...CORE_EXAMPLE_METADATA,
        id: 'supplements:examples',
        label: '英语例句补充',
      },
      {
        ...CORE_SYNONYM_METADATA,
        id: 'supplements:synonyms',
        label: 'WordNet 近义词补充',
      },
      {
        ...CORE_ROOT_METADATA,
        id: 'supplements:roots',
        label: 'UniMorph 派生基词',
      },
      {
        ...INFLECTION_FORMS_METADATA,
        id: 'supplements:inflections',
        label: 'ECDICT 变形',
      },
      {
        ...INFLECTION_INDEX_METADATA,
        id: 'supplements:inflection-index',
        label: 'ECDICT 变形反向查询',
      },
    ],
  },
];

export function isDictionaryPackId(id: string): id is DictionaryPackId {
  return DICTIONARY_PACK_GROUPS.some((group) => group.options.some((option) => option.id === id));
}

export function isEnglishVocabularyPackId(id: string): id is EnglishVocabularyPackId {
  return ENGLISH_VOCABULARY_PACK_ORDER.some((packId) => packId === id);
}

export function isChineseDictionaryPackId(id: string): id is ChineseDictionaryPackId {
  return CHINESE_DICTIONARY_PACK_ORDER.some((packId) => packId === id);
}
