export class ReadCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  version = 0;

  constructor(private readonly capacity: number) {}

  peek(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.value;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.expiresAt <= Date.now()) return;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, lifetime: number) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + lifetime });
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  clear() {
    this.entries.clear();
    this.version++;
  }
}
