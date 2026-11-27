// Weather app routes:
//   GET  /api/weather/forecast[?lat&lon&place]   (lat/lon previews a place without saving it)
//   GET  /api/weather/places?q=…
//   POST /api/weather/location {lat, lon, place, units}
import type { ServerApp } from '../../../core/server/app.ts';
import type { LocationUpdate, PlacesResponse } from '../api.ts';
import { manifest } from '../manifest.ts';
import { saveLocation, searchPlaces, weather } from './weather.ts';

const app: ServerApp = {
  id: manifest.id,
  routes: [
    {
      method: 'GET', path: 'forecast', handle: ({ query: q }) => weather(
        q.has('lat') && q.has('lon') ? { lat: Number(q.get('lat')), lon: Number(q.get('lon')), place: (q.get('place') || 'Preview').slice(0, 60) } : undefined),
    },
    {
      method: 'GET', path: 'places', handle: async ({ query }): Promise<PlacesResponse> => {
        try { return { status: 'ok', results: await searchPlaces(query.get('q') || '') }; }
        catch (e) { return { status: 'error', results: [], error: String((e as Error).message).slice(0, 120) }; }
      },
    },
    {
      method: 'POST', path: 'location', handle: async ({ body, from }) => {
        const update = body as LocationUpdate;
        const result = await saveLocation(update);
        if (update.lat != null) console.log(`weather: location set from ${from}: ${update.place}`);
        return result;
      },
    },
  ],
};
export default app;
