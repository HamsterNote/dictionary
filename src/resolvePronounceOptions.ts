import type { DictionaryPronounceOptions } from './dictionaryPronounce';
import type { PronunciationContext } from './pronunciation-audio/contracts';

/** context.accent 由当前唯一、可用的 overlay 读法的 accent.class 提供。 */
export function resolvePronounceOptions(
  context: PronunciationContext | undefined,
): DictionaryPronounceOptions {
  if (context?.language === 'en' && (context.accent === 'us' || context.accent === 'uk')) {
    return {
      language: context.accent === 'us' ? 'en-US' : 'en-GB',
      languageSource: 'overlay-accent',
    };
  }
  return { languageSource: 'unknown' };
}
