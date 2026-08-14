export const ECDICT_SOURCE = {
  href: 'https://github.com/skywind3000/ECDICT',
  id: 'ecdict',
  label: 'ECDICT',
} as const;

export const OANC_SOURCE = {
  href: 'https://anc.org/data/OANC/',
  id: 'oanc',
  label: 'Open American National Corpus',
} as const;

export const WORDNET_SOURCE = {
  href: 'https://wordnetcode.princeton.edu/',
  id: 'wordnet',
  label: 'WordNet 3.1',
} as const;

export const UNIMORPH_SOURCE = {
  href: 'https://github.com/unimorph/eng',
  id: 'unimorph',
  label: 'UniMorph · MorphyNet',
} as const;

const CHINESE_SOURCE_HREFS: Readonly<Record<string, string>> = {
  'chinese-dictionary':
    'https://github.com/mapull/chinese-dictionary/tree/e804ada333b68afddfdccbe8dcc938a72da157a7',
  'chinese-dictionary-words':
    'https://github.com/mapull/chinese-dictionary/tree/e804ada333b68afddfdccbe8dcc938a72da157a7',
  'chinese-xinhua':
    'https://github.com/pwxcoo/chinese-xinhua/tree/fe6d6c2e8baa82187f4c96bbe042e43f96c05666',
  'chinese-xinhua-words':
    'https://github.com/pwxcoo/chinese-xinhua/tree/fe6d6c2e8baa82187f4c96bbe042e43f96c05666',
};

export function getChineseSourceHref(sourceId: string): string | undefined {
  return CHINESE_SOURCE_HREFS[sourceId];
}
