// Radio stations: the https-only rule and the station shape. Pure: no DOM, no fetch.
// The server (server/index.ts) and the page both use it. Tested in test/radio-stations.test.ts.
import type { Station } from '../api.ts';

/** The address as an https URL, or null. Plain http and every other scheme never play. */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** One Radio Browser record as a station, or null when it has no https stream or no name. The resolved stream wins. */
export function stationFrom(rec: any): Station | null {
  const url = httpsUrl(rec?.url_resolved) ?? httpsUrl(rec?.url);
  const name = typeof rec?.name === 'string' ? rec.name.trim().slice(0, 80) : '';
  if (!url || !name) return null;
  const bitrate = Math.round(Number(rec.bitrate));
  return {
    id: String(rec.stationuuid || rec.id || url),
    name,
    url,
    country: typeof rec.country === 'string' ? rec.country : '',
    codec: typeof rec.codec === 'string' ? rec.codec.toUpperCase() : '',
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : 0,
  };
}

/** Keep only the Radio Browser records that play: https streams with a name. The order is kept. */
export function playableStations(records: unknown[]): Station[] {
  return records.map(stationFrom).filter((s): s is Station => s !== null);
}

/** Keep only saved stations whose stream is https (stored favourites are checked again before they play). */
export function playable(list: Station[]): Station[] {
  return list.flatMap(s => {
    const url = httpsUrl(s.url);
    return url ? [{ ...s, url }] : [];
  });
}
