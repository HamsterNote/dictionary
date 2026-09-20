import type { ReactNode } from 'react';
import type { DictionaryContentProps, DictionaryMeaning, DictionarySource } from './index';

type Expect<T extends true> = T;

export type DictionaryMeaningDefinitionIsReactNode = Expect<
  ReactNode extends DictionaryMeaning['definition']
    ? DictionaryMeaning['definition'] extends ReactNode
      ? true
      : false
    : false
>;
export type DictionaryMeaningExampleIsReactNode = Expect<
  ReactNode extends DictionaryMeaning['example']
    ? DictionaryMeaning['example'] extends ReactNode
      ? true
      : false
    : false
>;

type PublicMeaning = NonNullable<DictionaryContentProps['meanings']>[number];

export type PublicMeaningDefinitionIsReactNode = Expect<
  ReactNode extends PublicMeaning['definition']
    ? PublicMeaning['definition'] extends ReactNode
      ? true
      : false
    : false
>;
export type PublicSourceDefinitionIsReactNode = Expect<
  ReactNode extends DictionarySource['meanings'][number]['definition']
    ? DictionarySource['meanings'][number]['definition'] extends ReactNode
      ? true
      : false
    : false
>;
