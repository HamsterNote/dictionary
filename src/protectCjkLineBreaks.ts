import type { ReactNode } from 'react';

const WORD_JOINER = '\u2060';
const CHINESE_WORD_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' });

export function protectCjkLineBreaks(definition: ReactNode): ReactNode {
  if (typeof definition !== 'string') return definition;

  return Array.from(CHINESE_WORD_SEGMENTER.segment(definition), ({ segment, isWordLike }) =>
    isWordLike && /^[\p{Script=Han}]{2,}$/u.test(segment)
      ? segment.replace(/(?<=\p{Script=Han})(?=\p{Script=Han})/gu, WORD_JOINER)
      : segment,
  )
    .join('')
    .replace(/^([，；、。！？：])/u, `${WORD_JOINER}$1`)
    .replace(
      /(?<=\p{Script=Han})(?=[里中上下内外前后时地的了着过也][，；、。！？：])/gu,
      WORD_JOINER,
    )
    .replace(
      /(^|[，；、。！？：\s])([\p{Script=Han}]{2,4})(?=$|[，；、。！？：\s])/gu,
      (_match: string, boundary: string, phrase: string) =>
        `${boundary}${phrase.replace(/(?<=\p{Script=Han})(?=\p{Script=Han})/gu, WORD_JOINER)}`,
    )
    .replace(/(?<character>[\p{Script=Han}])（/gu, `$<character>${WORD_JOINER}（`);
}
