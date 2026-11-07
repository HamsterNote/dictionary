interface CacheEntry {
  readonly blob: Blob;
}

export class PronunciationAudioBlobCache {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  get(key: string): Blob | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.blob;
  }

  set(key: string, blob: Blob): boolean {
    if (blob.size > 2 * 1024 * 1024) return false;
    this.delete(key);
    this.entries.set(key, { blob });
    this.bytes += blob.size;
    while (this.entries.size > 20 || this.bytes > 10 * 1024 * 1024) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    return true;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.bytes -= entry.blob.size;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
