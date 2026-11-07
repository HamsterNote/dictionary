export type DictionaryQueryState<T> =
  | { readonly status: 'idle' }
  | { readonly query: string; readonly status: 'loading' }
  | { readonly data: T; readonly query: string; readonly status: 'ready' }
  | { readonly query: string; readonly status: 'not-found' }
  | { readonly error: Error; readonly query: string; readonly status: 'error' };

export interface DictionaryQueryResult<T> {
  readonly current: boolean;
  readonly state: DictionaryQueryState<T>;
}

export class DictionaryQueryController<T> {
  #sequence = 0;
  #abortController: AbortController | undefined;
  #disposed = false;
  #state: DictionaryQueryState<T> = { status: 'idle' };
  readonly #listeners = new Set<(state: DictionaryQueryState<T>) => void>();

  get state(): DictionaryQueryState<T> {
    return this.#state;
  }

  subscribe(listener: (state: DictionaryQueryState<T>) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async request(
    query: string,
    load: (query: string, signal: AbortSignal) => Promise<T | undefined>,
  ): Promise<DictionaryQueryResult<T>> {
    if (this.#disposed) return { current: false, state: this.#state };
    this.#abortController?.abort();
    const abortController = new AbortController();
    this.#abortController = abortController;
    const sequence = ++this.#sequence;
    this.#setState({ query, status: 'loading' });
    try {
      const data = await load(query, abortController.signal);
      const state: DictionaryQueryState<T> =
        data === undefined ? { query, status: 'not-found' } : { data, query, status: 'ready' };
      const current = this.#isCurrent(sequence);
      if (current) this.#setState(state);
      return { current, state };
    } catch (error: unknown) {
      const current = this.#isCurrent(sequence);
      const state: DictionaryQueryState<T> = {
        error: error instanceof Error ? error : new Error('词典查询失败'),
        query,
        status: 'error',
      };
      if (current) this.#setState(state);
      return { current, state };
    }
  }

  cancel(): void {
    if (this.#disposed) return;
    this.#sequence += 1;
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#setState({ status: 'idle' });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.cancel();
    this.#disposed = true;
    this.#listeners.clear();
  }

  #isCurrent(sequence: number): boolean {
    return !this.#disposed && sequence === this.#sequence;
  }

  #setState(state: DictionaryQueryState<T>): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
}
