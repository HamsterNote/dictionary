/**
 * 宿主注册的朗读函数。共享层优先使用可信真人录音，仅在没有匹配录音时调用。
 * Promise 应在朗读结束后完成；signal 在切词、读法变化或卸载时取消当前朗读。
 * 只接受 word 的旧回调仍然兼容，系统合成不保证复现词条中的特定 IPA。
 */
export type DictionaryPronounce = (word: string, signal?: AbortSignal) => Promise<void>;
