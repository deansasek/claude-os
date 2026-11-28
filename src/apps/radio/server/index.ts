// Radio app routes (under /api/radio/). The page asks the hub, so the browser never calls the radio directory itself.
//   GET stations?q=…&country=…&codec=…&bitrate=…   stations whose name matches q, with optional filters (https streams only)
//   GET catalogue?path=…   one allow-listed Radio Browser path (web/catalogue.ts): tags, countries, languages,
//                          stations/topvote/<n>, stations/bytag|bycountry|bylanguage/<name>
//   GET title?url=…        the stream's current title (ICY metadata), or '' when it sends none
// Every directory call tries the public mirrors in turn (MIRRORS), the one that last answered first.
import type { ServerApp } from '../../../core/server/app.ts';
import type { FacetsResult, StationsResult, TitleResult } from '../api.ts';
import { cleanQuery } from '../api.ts';
import { manifest } from '../manifest.ts';
import { MIRRORS, cataloguePath, facetsFrom, filtersFrom, mirrorOrder } from '../web/catalogue.ts';
import { icyTitle } from '../web/player.ts';
import { httpsUrl, playableStations } from '../web/stations.ts';

const HEADERS = { 'User-Agent': 'ClaudeOS-Radio', Accept: 'application/json' };
const DOWN = 'The radio directory did not answer. Try again soon.';
const CACHE_MS = 15 * 60e3;

let lastGood: string | null = null;
const cache = new Map<string, { at: number; body: unknown }>();

/** GET /json/<pathAndQuery> from the first mirror that answers. Answers are kept for a while. */
async function directory(pathAndQuery: string): Promise<unknown[]> {
  const hit = cache.get(pathAndQuery);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body as unknown[];
  let last: unknown = new Error('no mirror');
  for (const host of mirrorOrder(MIRRORS, lastGood)) {
    try {
      const r = await fetch(`https://${host}/json/${pathAndQuery}`, { headers: HEADERS, signal: AbortSignal.timeout(8e3) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body: unknown = await r.json();
      // the directory always answers a list: anything else is a bad mirror, so the next one is tried
      if (!Array.isArray(body)) throw new Error('the mirror did not send a list');
      const list = body;
      lastGood = host;
      if (cache.size > 100) cache.clear();
      cache.set(pathAndQuery, { at: Date.now(), body: list });
      return list;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export async function stations(query: URLSearchParams): Promise<StationsResult> {
  const name = cleanQuery(query.get('q') || '');
  const f = filtersFrom(query);
  const params = new URLSearchParams({ hidebroken: 'true', order: 'votes', reverse: 'true', limit: '60' });
  if (name) params.set('name', name);
  if (f.country) params.set('countrycode', f.country);
  if (f.codec) params.set('codec', f.codec);
  if (f.bitrate) params.set('bitrateMin', String(f.bitrate));
  try {
    return { status: 'ok', stations: playableStations(await directory(`stations/search?${params}`)) };
  } catch {
    return { status: 'error', stations: [], error: DOWN };
  }
}

async function catalogue(raw: string | null): Promise<StationsResult | FacetsResult | { status: 'error'; error: string }> {
  const p = cataloguePath(raw);
  if (!p) return { status: 'error', error: 'That is not a radio directory list.' };
  try {
    if (p.kind === 'facets') {
      const list = await directory(`${p.path}?order=stationcount&reverse=true&hidebroken=true&limit=400`);
      return { status: 'ok', facets: facetsFrom(list, p.facet) };
    }
    const q = p.path.startsWith('stations/topvote/') ? 'hidebroken=true' : 'hidebroken=true&order=votes&reverse=true&limit=200';
    return { status: 'ok', stations: playableStations(await directory(`${p.path}?${q}`)) };
  } catch {
    return p.kind === 'facets' ? { status: 'error', facets: [], error: DOWN } : { status: 'error', stations: [], error: DOWN };
  }
}

/** Read the stream just far enough to reach its first ICY metadata block, then let go. https streams only. */
async function streamTitle(raw: string | null): Promise<TitleResult> {
  const url = httpsUrl(raw);
  if (!url) return { title: '' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8e3);
  try {
    const r = await fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'ClaudeOS-Radio' }, signal: ac.signal });
    const metaint = Number(r.headers.get('icy-metaint'));
    if (!r.ok || !r.body || !Number.isInteger(metaint) || metaint <= 0 || metaint > 65536) return { title: '' };
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < metaint + 1 + 255 * 16) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (got > metaint) {
        const buf = Buffer.concat(chunks);
        const len = buf[metaint] * 16;
        if (got >= metaint + 1 + len) return { title: icyTitle(buf.subarray(metaint + 1, metaint + 1 + len).toString('utf8')) };
      }
    }
    return { title: '' };
  } catch {
    return { title: '' };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'stations', handle: ({ query }) => stations(query) },
    { method: 'GET', path: 'catalogue', handle: ({ query }) => catalogue(query.get('path')) },
    { method: 'GET', path: 'title', handle: ({ query }) => streamTitle(query.get('url')) },
  ],
};
export default app;
