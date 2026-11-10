import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';
import type { DictionaryDetail } from './dictionaryData';

export function hasPreviewDefinition(value: ReactNode): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'bigint') return true;
  if (isValidElement(value)) return true;
  return Children.toArray(value).some((child) =>
    typeof child === 'string'
      ? child.trim().length > 0
      : typeof child === 'number' || typeof child === 'bigint' || isValidElement(child),
  );
}

export function groupDictionaryPreviewMeanings(detail: DictionaryDetail | undefined) {
  const groups = new Map<
    string,
    { definition: ReactNode; sourceId: string; sourceLabel: string; id: string }[]
  >();
  for (const source of detail?.sources ?? []) {
    if (source.kind !== undefined && source.kind !== 'definitions') continue;
    for (const meaning of source.meanings) {
      if (!hasPreviewDefinition(meaning.definition)) continue;
      const part = meaning.partOfSpeech?.trim() ?? '';
      const items = groups.get(part) ?? [];
      items.push({
        definition: meaning.definition,
        sourceId: source.id,
        sourceLabel: source.label,
        id: meaning.id,
      });
      groups.set(part, items);
    }
  }
  return [...groups]
    .filter(([part]) => part !== '')
    .concat(groups.has('') ? [['', groups.get('') ?? []]] : [])
    .map(([partOfSpeech, meanings]) => ({ partOfSpeech: partOfSpeech || '未标注词性', meanings }));
}
