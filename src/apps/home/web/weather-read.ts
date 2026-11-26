// What Home keeps after a read of the forecast (src/apps/home/web/index.ts loadWeather). Pure: no DOM, no fetch.
// The hub answers HTTP 200 with status 'error' when a route throws, so a read that says 'error' is a failed read.
// The last good forecast stays on the tile; with none, the tile shows Offline and the next read comes soon.

/** The forecast Home keeps, and whether the last read failed. */
export function weatherAfterRead<T extends { status: string }>(prev: T | null, next: T): { wx: T | null; failed: boolean } {
  if (next.status === 'error') return { wx: prev, failed: true };
  return { wx: next, failed: false };
}

/** The tile's words when there is no forecast to show: why it is empty. `status` is the last read's status (undefined
 *  while the first read runs). A failed read with no forecast says Offline. */
export function emptyTileText(status: string | undefined, failed: boolean): { temp: string; sub: string } {
  if (status === 'no_location') return { temp: 'Set your city', sub: 'Tap to choose where you live' };
  if (status === 'not_found') return { temp: 'City not found', sub: 'Tap to pick it again' };
  if (failed) return { temp: 'Offline', sub: 'Can’t reach the forecast' };
  if (status) return { temp: 'Not yet', sub: 'Checking the sky…' };
  return { temp: '–', sub: 'Checking the sky…' };
}
