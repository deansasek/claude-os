// The News cache rule, kept pure so the tests can check it. A value is fresh for 20 minutes after it was fetched.
export const NEWS_TTL_MS = 20 * 60e3;

export interface CacheEntry<T> { at: number; value: T }

/** True while `now` is within the TTL of `at`. A clock that went backwards counts as stale. */
export function isFresh(at: number, now: number, ttlMs: number = NEWS_TTL_MS): boolean {
  return now >= at && now - at < ttlMs;
}

/** The cached value when it is still fresh, otherwise null. */
export function freshValue<T>(entry: CacheEntry<T> | undefined, now: number, ttlMs: number = NEWS_TTL_MS): T | null {
  return entry && isFresh(entry.at, now, ttlMs) ? entry.value : null;
}
