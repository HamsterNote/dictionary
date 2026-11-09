/**
 * 宿主注册的朗读函数。共享层优先使用可信真人录音，仅在没有匹配录音时调用。
 * Promise 应在朗读结束后完成；signal 在切词、读法变化或卸载时取消当前朗读。
 * 第三个可选参数由共享层从当前唯一读法的显式口音元数据生成，不根据 IPA 字符猜测。
 * 未知口音不传 language；宿主可约定默认值。旧回调仍然兼容，合成不保证复现特定 IPA。
 */
export type DictionaryPronounce = (
  word: string,
  signal?: AbortSignal,
  options?: DictionaryPronounceOptions,
) => Promise<void>;

export interface DictionaryPronounceOptions {
  readonly language?: 'en-US' | 'en-GB';
  readonly languageSource: 'overlay-accent' | 'unknown';
}
