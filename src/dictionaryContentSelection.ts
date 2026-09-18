export interface DictionaryContentSelection {
  readonly activeKeyword: string;
  readonly propKeyword: string;
}

export function resolveDictionaryContentSelection(
  selection: DictionaryContentSelection,
  keyword: string,
): { readonly activeKeyword: string; readonly useProvidedContent: boolean } {
  const activeKeyword = selection.propKeyword === keyword ? selection.activeKeyword : keyword;
  return { activeKeyword, useProvidedContent: activeKeyword === keyword };
}
