import { createContext } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import type { AsyncDictionaryEntryResolver } from './dictionaryTextCandidates';
import { resolveDictionaryTextTask } from './dictionaryTextCandidates';

export class DictionaryTextResolutionSession {
  readonly #resolveEntry: AsyncDictionaryEntryResolver;
  readonly #cache = new Map<string, DictionaryEntrySummary | undefined>();
  readonly #controllers = new Set<AbortController>();
  readonly #listeners = new Set<() => void>();
  #failed = false;
  #status: 'error' | 'loading' | 'ready' = 'ready';

  constructor(resolveEntry: AsyncDictionaryEntryResolver) {
    this.#resolveEntry = resolveEntry;
  }

  readonly getSnapshot = () => this.#status;
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  async resolve(
    text: string,
    element: HTMLElement,
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, DictionaryEntrySummary>> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => {
      controller.abort(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    this.#controllers.add(controller);
    this.#publish();
    // IntersectionObserver accounts for both the viewport and clipping scroll containers.
    let visible = this.#isVisible(element);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          });
    observer?.observe(element);
    try {
      return await resolveDictionaryTextTask(
        text,
        async (word, taskSignal) => {
          if (this.#cache.has(word)) return this.#cache.get(word);
          const entry = await this.#resolveEntry(word, taskSignal);
          taskSignal?.throwIfAborted();
          this.#cache.set(word, entry);
          return entry;
        },
        controller.signal,
        () => ((observer ? visible : this.#isVisible(element)) ? 0 : 1),
      );
    } catch (error: unknown) {
      if (!controller.signal.aborted) this.#failed = true;
      throw error;
    } finally {
      observer?.disconnect();
      signal.removeEventListener('abort', cancel);
      this.#controllers.delete(controller);
      this.#publish();
    }
  }

  cancel(): void {
    for (const controller of this.#controllers) controller.abort();
  }

  #isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
    );
  }

  #publish(): void {
    const status = this.#failed ? 'error' : this.#controllers.size > 0 ? 'loading' : 'ready';
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}

export const DictionaryTextResolutionContext = createContext<
  DictionaryTextResolutionSession | undefined
>(undefined);
