// Radio app routes (under /api/radio/). The page asks the hub, so the browser never calls the radio directory itself.
//   GET stations?q=…   the most-voted stations, or those whose name matches q (https streams only)
import type { ServerApp } from '../../../core/server/app.ts';
import type { StationsResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { playableStations } from '../web/stations.ts';

const API = 'https://all.api.radio-browser.info/json/stations/search';

async function stations(q: string): Promise<StationsResult> {
  const name = q.trim().slice(0, 60);
  const params = new URLSearchParams({ hidebroken: 'true', order: 'votes', reverse: 'true', limit: '40' });
  if (name) params.set('name', name);
  try {
    const r = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'ClaudeOS-Radio', Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body: unknown = await r.json();
    return { status: 'ok', stations: playableStations(Array.isArray(body) ? body : []) };
  } catch (e) {
    return { status: 'error', stations: [], error: String((e as Error).message).slice(0, 120) };
  }
}

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'stations', handle: ({ query }) => stations(query.get('q') || '') },
  ],
};
export default app;
