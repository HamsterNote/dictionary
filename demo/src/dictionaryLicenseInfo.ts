import { type DictionaryPackId, isDictionaryPackId } from './dictionaryPacks';

export interface DictionaryLicenseInfo {
  readonly detail: string;
  readonly label: string;
  readonly requiresUpstreamReview: boolean;
  readonly source: string;
  readonly sourceLicenseUrl: string;
}

const ECDICT_LICENSE: DictionaryLicenseInfo = {
  label: 'MIT*',
  requiresUpstreamReview: true,
  source: 'ECDICT',
  sourceLicenseUrl: 'https://github.com/skywind3000/ECDICT/blob/master/LICENSE',
  detail:
    '仓库采用 MIT，但数据曾参考多个外部词典与网站。分发时应保留 MIT 声明；商业发布前还需复核上游数据与 BNC 排名的授权链。',
};

const LICENSE_INFO_BY_PACK_ID = {
  bnc: ECDICT_LICENSE,
  cet4: ECDICT_LICENSE,
  cet6: ECDICT_LICENSE,
  gk: ECDICT_LICENSE,
  gre: ECDICT_LICENSE,
  ielts: ECDICT_LICENSE,
  ky: ECDICT_LICENSE,
  toefl: ECDICT_LICENSE,
  zk: ECDICT_LICENSE,
  'supplements:inflection-index': ECDICT_LICENSE,
  'supplements:inflections': ECDICT_LICENSE,
  'chinese-dictionary': {
    label: 'MIT / CC BY-SA 4.0*',
    requiresUpstreamReview: true,
    source: 'chinese-dictionary',
    sourceLicenseUrl: 'https://github.com/mapull/chinese-dictionary/blob/main/LICENSE',
    detail:
      '上游汇总仓库标为 MIT，但数据含 CC-CEDICT 等混合来源，当前无法逐条追溯。公开分发前需确认署名、许可链接、修改说明及相同方式共享等义务。',
  },
  'chinese-dictionary-words': {
    label: 'MIT / CC BY-SA 4.0*',
    requiresUpstreamReview: true,
    source: 'chinese-dictionary',
    sourceLicenseUrl: 'https://github.com/mapull/chinese-dictionary/blob/main/LICENSE',
    detail:
      '上游汇总仓库标为 MIT，但数据含 CC-CEDICT 等混合来源，当前无法逐条追溯。公开分发前需确认署名、许可链接、修改说明及相同方式共享等义务。',
  },
  'chinese-xinhua': {
    label: 'MIT*',
    requiresUpstreamReview: true,
    source: 'chinese-xinhua',
    sourceLicenseUrl: 'https://github.com/pwxcoo/chinese-xinhua/blob/master/LICENSE',
    detail:
      '上游代码仓库采用 MIT，但词典内容来自第三方网站。分发时应保留 MIT 声明，商业发布前还需确认数据内容的权利来源。',
  },
  'chinese-xinhua-words': {
    label: 'MIT*',
    requiresUpstreamReview: true,
    source: 'chinese-xinhua',
    sourceLicenseUrl: 'https://github.com/pwxcoo/chinese-xinhua/blob/master/LICENSE',
    detail:
      '上游代码仓库采用 MIT，但词典内容来自第三方网站。分发时应保留 MIT 声明，商业发布前还需确认数据内容的权利来源。',
  },
  'supplements:examples': {
    label: '开放使用声明*',
    requiresUpstreamReview: true,
    source: 'Open American National Corpus',
    sourceLicenseUrl: 'https://anc.org/data/OANC/',
    detail:
      'OANC 官网允许自由使用和再分发，但下载包未附独立许可清单。商业发布前应保存官网声明快照，并复核语料来源、人格权与敏感内容。',
  },
  'supplements:synonyms': {
    label: 'WordNet 3.1 License',
    requiresUpstreamReview: false,
    source: 'Princeton WordNet 3.1',
    sourceLicenseUrl: 'https://wordnet.princeton.edu/license-and-commercial-use',
    detail:
      '允许免费使用、修改和分发；\n所有副本与修改须保留版权、许可条件及免责声明；\n不得使用 Princeton 名称进行广告或宣传。',
  },
  'supplements:roots': {
    label: 'CC BY-SA 3.0',
    requiresUpstreamReview: true,
    source: 'UniMorph · MorphyNet',
    sourceLicenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    detail:
      '派生关系数据采用 CC BY-SA 3.0。分发时须署名、提供许可证链接、说明修改，并按相同许可证共享改编数据库；商业发布前应复核数据组合方式。',
  },
} satisfies Readonly<Record<DictionaryPackId, DictionaryLicenseInfo>>;

export function getDictionaryLicenseInfo(id: string): DictionaryLicenseInfo {
  if (!isDictionaryPackId(id))
    throw new Error(`Missing license information for dictionary pack: ${id}`);
  return LICENSE_INFO_BY_PACK_ID[id];
}
