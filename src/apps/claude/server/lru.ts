// A Map that keeps at most `max` entries. The least recently used entry goes first.
// Used for caches keyed by session or file, which otherwise grow for the whole uptime.

export class Lru<K, V> {
  private readonly map = new Map<K, V>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {   // reading counts as use: move it to the newest end
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): this {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
    return this;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  get size(): number {
    return this.map.size;
  }
}
