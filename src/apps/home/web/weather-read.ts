// What Home keeps after a read of the forecast (src/apps/home/web/index.ts loadWeather). Pure: no DOM, no fetch.
// The hub answers HTTP 200 with status 'error' when a route throws, so a read that says 'error' is a failed read.
// The last good forecast stays on the tile; with none, the tile shows Offline and the next read comes soon.

/** The forecast Home keeps, and whether the last read failed. */
export function weatherAfterRead<T extends { status: string }>(prev: T | null, next: T): { wx: T | null; failed: boolean } {
  if (next.status === 'error') return { wx: prev, failed: true };
  return { wx: next, failed: false };
}
