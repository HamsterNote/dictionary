export function formatDictionaryPhonetic(word: string, phonetic: string): string {
  return /\p{Script=Han}/u.test(word) ? phonetic : `英：${phonetic}`;
}
