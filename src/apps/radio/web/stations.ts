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
    favicon: httpsUrl(rec.favicon) ?? '',
    language: typeof rec.language === 'string' ? languageLine(rec.language) : '',
    tags: typeof rec.tags === 'string' ? tagList(rec.tags) : [],
  };
}

/** "english,german" as "English, German". */
function languageLine(value: string): string {
  return value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
    .map(s => s[0].toUpperCase() + s.slice(1)).join(', ').slice(0, 60);
}

/** "pop,rock,,pop" as ["pop", "rock"]: at most six short genres, no repeats. */
function tagList(value: string): string[] {
  const out: string[] = [];
  for (const t of value.split(',')) {
    const tag = t.trim().toLowerCase();
    if (tag && tag.length <= 30 && !out.includes(tag)) out.push(tag);
    if (out.length === 6) break;
  }
  return out;
}

/** Keep only the Radio Browser records that play: https streams with a name. The order is kept. */
export function playableStations(records: unknown[]): Station[] {
  return records.map(stationFrom).filter((s): s is Station => s !== null);
}

/** Keep only saved stations whose stream is https (stored favourites are checked again before they play). An entry that is not an object is dropped, so one bad value cannot empty the list. */
export function playable(list: unknown[]): Station[] {
  return list.flatMap(x => {
    if (typeof x !== 'object' || x === null) return [];
    const s = x as Station;
    // the card art reads the name and the id: an entry without them would break the screen
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || !s.name.trim()) return [];
    const url = httpsUrl(s.url);
    return url ? [{ ...s, url, favicon: httpsUrl(s.favicon) ?? '' }] : [];
  });
}
