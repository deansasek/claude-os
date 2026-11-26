// The Radio Browser catalogue: which paths the hub may ask for, which mirror to try first, the genre, country and
// language lists, the search filters and the recently played list. Pure: no DOM, no fetch.
// The server (server/index.ts) and the page both use it. Tested in test/radio-catalogue.test.ts.
import type { Facet, Station } from '../api.ts';

/** Public Radio Browser mirrors (api.radio-browser.info lists them). The hub tries them in turn. */
export const MIRRORS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'] as const;

/** The order to try the mirrors in: the one that last answered first, then the rest in their usual order. */
export function mirrorOrder(mirrors: readonly string[], lastGood: string | null): string[] {
  if (!lastGood || !mirrors.includes(lastGood)) return [...mirrors];
  return [lastGood, ...mirrors.filter(m => m !== lastGood)];
}

/** Characters a genre, country or language name may not hold: they would change the path the hub asks for. */
const BAD_NAME = /[\/\\?#%\u0000-\u001f\u007f]/;

export type FacetKind ='tags' | 'countries' | 'languages';
export type CataloguePath =
  | { kind: 'facets'; facet: FacetKind; path: string }
  | { kind: 'stations'; path: string };

/** The allow-list. A path the page asks for (e.g. "stations/bytag/jazz") as the safe Radio Browser path under /json/,
 *  or null when it is not one of: tags, countries, languages, stations/topvote/<1..100>,
 *  stations/bytag/<tag>, stations/bycountry/<country>, stations/bylanguage/<language>. */
export function cataloguePath(raw: unknown): CataloguePath | null {
  if (typeof raw !== 'string') return null;
  const p = raw.trim().replace(/^\/+/, '').replace(/^json\//, '');
  if (p === 'tags' || p === 'countries' || p === 'languages') return { kind: 'facets', facet: p, path: p };
  const top = p.match(/^stations\/topvote\/(\d{1,3})$/);
  if (top) {
    const n = Number(top[1]);
    return n >= 1 && n <= 100 ? { kind: 'stations', path: `stations/topvote/${n}` } : null;
  }
  const by = p.match(/^stations\/(bytag|bycountry|bylanguage)\/(.+)$/);
  if (!by) return null;
  const name = by[2].trim();
  if (!name || name.length > 60 || name === '.' || name === '..' || BAD_NAME.test(name)) return null;
  return { kind: 'stations', path: `stations/${by[1]}/${encodeURIComponent(name)}` };
}

/** Radio Browser's tag, country or language records as facets: named, with stations, the biggest first, at most 150. */
export function facetsFrom(records: unknown[], kind: FacetKind): Facet[] {
  const out: Facet[] = [];
  for (const r of records as any[]) {
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    const count = Math.round(Number(r?.stationcount));
    if (!name || name.length > 40 || BAD_NAME.test(name) || !Number.isFinite(count) || count < 1) continue;
    const code = kind === 'countries' && typeof r.iso_3166_1 === 'string' && /^[A-Z]{2}$/.test(r.iso_3166_1) ? r.iso_3166_1 : '';
    out.push({ name, code, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 150);
}

/** The search filters the page offers. country is an ISO code; bitrate is the lowest kbit/s. */
export interface SearchFilters { country: string; codec: string; bitrate: number }
export const NO_FILTERS: SearchFilters = { country: '', codec: '', bitrate: 0 };
export const CODECS = ['', 'MP3', 'AAC', 'OGG'] as const;
export const BITRATES = [0, 64, 128, 192] as const;

/** The empty-result line for a search: names the words, the filters or both that can be narrowed. */
export function noMatchText(query: string, filters: SearchFilters): string {
  const filtered = !!(filters.country || filters.codec || filters.bitrate);
  if (!filtered) return 'No stations match. Try fewer words.';
  if (!query) return 'No stations match these filters. Try Any country, Any format or Any quality.';
  return 'No stations match. Try fewer words or fewer filters.';
}

/** The filters from the hub's query string, each one checked: an unknown value means "any". */
export function filtersFrom(q: URLSearchParams): SearchFilters {
  const country = (q.get('country') || '').toUpperCase();
  const codec = (q.get('codec') || '').toUpperCase();
  const bitrate = Number(q.get('bitrate'));
  return {
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    codec: (CODECS as readonly string[]).includes(codec) ? codec : '',
    bitrate: (BITRATES as readonly number[]).includes(bitrate) ? bitrate : 0,
  };
}

/** The next choice when a cycling filter chip is tapped (the last wraps to the first). */
export function nextChoice<T>(choices: readonly T[], current: T): T {
  const at = choices.indexOf(current);
  return choices[(at + 1) % choices.length];
}

export const RECENT_MAX = 20;

/** The recently played list after playing s: s first, no repeats, at most RECENT_MAX stations. */
export function addRecent(list: Station[], s: Station, max = RECENT_MAX): Station[] {
  return [s, ...list.filter(r => r.id !== s.id)].slice(0, max);
}

/** The first n genres, countries or languages by station count, most first: what Browse all shows (eight each). */
export function browsePick<T extends { count: number }>(list: readonly T[], n = 8): T[] {
  return [...list].sort((a, b) => b.count - a.count).slice(0, n);
}

/** The recent searches with q first, no repeats (case-insensitive), at most cap (six). A blank q changes nothing. */
export const SEARCHES_MAX = 6;
export function addSearch(list: readonly string[], q: string, cap = SEARCHES_MAX): string[] {
  const t = q.trim();
  if (!t) return list.slice(0, cap);
  return [t, ...list.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, cap);
}
