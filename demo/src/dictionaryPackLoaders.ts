import type {
  ChineseDictionaryPack,
  EnglishChineseVocabularyPack,
  EnglishExampleSentencePack,
  EnglishInflectionFormsPack,
  EnglishInflectionIndexPack,
  EnglishRootPack,
  EnglishSynonymPack,
} from '../../src';
import type {
  ChineseDictionaryPackId,
  EnglishSupplementPackId,
  EnglishVocabularyPackId,
} from './dictionaryPacks';

const CHINESE_LOADERS: Readonly<
  Record<ChineseDictionaryPackId, () => Promise<ChineseDictionaryPack>>
> = {
  'chinese-dictionary': () =>
    import('../../src/dictionary-packs/chinese-dictionary').then(
      ({ chineseDictionaryPack }) => chineseDictionaryPack,
    ),
  'chinese-dictionary-words': () =>
    import('../../src/dictionary-packs/chinese-dictionary-words').then(
      ({ chineseDictionaryWordsDictionaryPack }) => chineseDictionaryWordsDictionaryPack,
    ),
  'chinese-xinhua': () =>
    import('../../src/dictionary-packs/chinese-xinhua').then(
      ({ chineseXinhuaDictionaryPack }) => chineseXinhuaDictionaryPack,
    ),
  'chinese-xinhua-words': () =>
    import('../../src/dictionary-packs/chinese-xinhua-words').then(
      ({ chineseXinhuaWordsDictionaryPack }) => chineseXinhuaWordsDictionaryPack,
    ),
};

const ENGLISH_LOADERS: Readonly<
  Record<EnglishVocabularyPackId, () => Promise<EnglishChineseVocabularyPack>>
> = {
  bnc: () =>
    import('../../src/vocabulary-packs/bnc').then(({ bncVocabularyPack }) => bncVocabularyPack),
  cet4: () =>
    import('../../src/vocabulary-packs/cet4').then(({ cet4VocabularyPack }) => cet4VocabularyPack),
  cet6: () =>
    import('../../src/vocabulary-packs/cet6').then(({ cet6VocabularyPack }) => cet6VocabularyPack),
  gk: () =>
    import('../../src/vocabulary-packs/gk').then(({ gkVocabularyPack }) => gkVocabularyPack),
  gre: () =>
    import('../../src/vocabulary-packs/gre').then(({ greVocabularyPack }) => greVocabularyPack),
  ielts: () =>
    import('../../src/vocabulary-packs/ielts').then(
      ({ ieltsVocabularyPack }) => ieltsVocabularyPack,
    ),
  ky: () =>
    import('../../src/vocabulary-packs/ky').then(({ kyVocabularyPack }) => kyVocabularyPack),
  toefl: () =>
    import('../../src/vocabulary-packs/toefl').then(
      ({ toeflVocabularyPack }) => toeflVocabularyPack,
    ),
  zk: () =>
    import('../../src/vocabulary-packs/zk').then(({ zkVocabularyPack }) => zkVocabularyPack),
};

const EXAMPLE_LOADERS: Readonly<
  Record<EnglishSupplementPackId, () => Promise<EnglishExampleSentencePack>>
> = {
  bnc: () =>
    import('../../src/example-sentence-packs/bnc').then(
      ({ bncExampleSentencePack }) => bncExampleSentencePack,
    ),
  cet4: () =>
    import('../../src/example-sentence-packs/cet4').then(
      ({ cet4ExampleSentencePack }) => cet4ExampleSentencePack,
    ),
  cet6: () =>
    import('../../src/example-sentence-packs/cet6').then(
      ({ cet6ExampleSentencePack }) => cet6ExampleSentencePack,
    ),
  core: () =>
    import('../../src/example-sentence-packs/core').then(
      ({ coreExampleSentencePack }) => coreExampleSentencePack,
    ),
  gk: () =>
    import('../../src/example-sentence-packs/gk').then(
      ({ gkExampleSentencePack }) => gkExampleSentencePack,
    ),
  gre: () =>
    import('../../src/example-sentence-packs/gre').then(
      ({ greExampleSentencePack }) => greExampleSentencePack,
    ),
  ielts: () =>
    import('../../src/example-sentence-packs/ielts').then(
      ({ ieltsExampleSentencePack }) => ieltsExampleSentencePack,
    ),
  ky: () =>
    import('../../src/example-sentence-packs/ky').then(
      ({ kyExampleSentencePack }) => kyExampleSentencePack,
    ),
  toefl: () =>
    import('../../src/example-sentence-packs/toefl').then(
      ({ toeflExampleSentencePack }) => toeflExampleSentencePack,
    ),
  zk: () =>
    import('../../src/example-sentence-packs/zk').then(
      ({ zkExampleSentencePack }) => zkExampleSentencePack,
    ),
};

const SYNONYM_LOADERS: Readonly<
  Record<EnglishSupplementPackId, () => Promise<EnglishSynonymPack>>
> = {
  bnc: () => import('../../src/synonym-packs/bnc').then(({ bncSynonymPack }) => bncSynonymPack),
  cet4: () => import('../../src/synonym-packs/cet4').then(({ cet4SynonymPack }) => cet4SynonymPack),
  cet6: () => import('../../src/synonym-packs/cet6').then(({ cet6SynonymPack }) => cet6SynonymPack),
  core: () => import('../../src/synonym-packs/core').then(({ coreSynonymPack }) => coreSynonymPack),
  gk: () => import('../../src/synonym-packs/gk').then(({ gkSynonymPack }) => gkSynonymPack),
  gre: () => import('../../src/synonym-packs/gre').then(({ greSynonymPack }) => greSynonymPack),
  ielts: () =>
    import('../../src/synonym-packs/ielts').then(({ ieltsSynonymPack }) => ieltsSynonymPack),
  ky: () => import('../../src/synonym-packs/ky').then(({ kySynonymPack }) => kySynonymPack),
  toefl: () =>
    import('../../src/synonym-packs/toefl').then(({ toeflSynonymPack }) => toeflSynonymPack),
  zk: () => import('../../src/synonym-packs/zk').then(({ zkSynonymPack }) => zkSynonymPack),
};

const ROOT_LOADERS: Readonly<Record<EnglishSupplementPackId, () => Promise<EnglishRootPack>>> = {
  bnc: () => import('../../src/root-packs/bnc').then(({ bncRootPack }) => bncRootPack),
  cet4: () => import('../../src/root-packs/cet4').then(({ cet4RootPack }) => cet4RootPack),
  cet6: () => import('../../src/root-packs/cet6').then(({ cet6RootPack }) => cet6RootPack),
  core: () => import('../../src/root-packs/core').then(({ coreRootPack }) => coreRootPack),
  gk: () => import('../../src/root-packs/gk').then(({ gkRootPack }) => gkRootPack),
  gre: () => import('../../src/root-packs/gre').then(({ greRootPack }) => greRootPack),
  ielts: () => import('../../src/root-packs/ielts').then(({ ieltsRootPack }) => ieltsRootPack),
  ky: () => import('../../src/root-packs/ky').then(({ kyRootPack }) => kyRootPack),
  toefl: () => import('../../src/root-packs/toefl').then(({ toeflRootPack }) => toeflRootPack),
  zk: () => import('../../src/root-packs/zk').then(({ zkRootPack }) => zkRootPack),
};

export const loadChinesePack = (id: ChineseDictionaryPackId) => CHINESE_LOADERS[id]();
export const loadEnglishPack = (id: EnglishVocabularyPackId) => ENGLISH_LOADERS[id]();
export const loadExamplePack = (id: EnglishSupplementPackId) => EXAMPLE_LOADERS[id]();
export const loadRootPack = (id: EnglishSupplementPackId) => ROOT_LOADERS[id]();
export const loadSynonymPack = (id: EnglishSupplementPackId) => SYNONYM_LOADERS[id]();
export const loadInflectionFormsPack = (): Promise<EnglishInflectionFormsPack> =>
  import('../../src/inflection-packs/forms').then(
    ({ ecdictInflectionFormsPack }) => ecdictInflectionFormsPack,
  );
export const loadInflectionIndexPack = (): Promise<EnglishInflectionIndexPack> =>
  import('../../src/inflection-packs/reverse').then(
    ({ ecdictInflectionIndexPack }) => ecdictInflectionIndexPack,
  );
