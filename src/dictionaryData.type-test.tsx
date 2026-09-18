import type { ReactElement } from 'react';
import type { DictionaryMeaning } from './dictionaryData';

type Expect<T extends true> = T;

export type DictionaryMeaningDefinitionAcceptsJsx = Expect<
  ReactElement extends DictionaryMeaning['definition'] ? true : false
>;
export type DictionaryMeaningExampleAcceptsJsx = Expect<
  ReactElement extends NonNullable<DictionaryMeaning['example']> ? true : false
>;
