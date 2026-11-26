// Radio in the mock page (no hub): two sample stations, a few genres, and a sample stream title, so the app shows a
// station list with the hub stopped. The shapes are the ones in ../api.ts. The stations are made up.
import { defineMock } from '../../../core/web/mock-api.ts';
import type { Facet, FacetsResult, Station, StationsResult, TitleResult } from '../api.ts';

const stations: Station[] = [
  { id: 'mock-1', name: 'Sample Jazz FM', url: 'https://example.test/jazz.mp3', country: 'Nowhere', codec: 'MP3', bitrate: 128,
    language: 'English', tags: ['jazz', 'smooth jazz'] },
  { id: 'mock-2', name: 'Sample Talk Radio', url: 'https://example.test/talk.aac', country: 'Nowhere', codec: 'AAC', bitrate: 64,
    language: 'English', tags: ['talk'] },
];

const facets: Facet[] = [
  { name: 'jazz', code: '', count: 12 },
  { name: 'talk', code: '', count: 7 },
  { name: 'Nowhere', code: 'XX', count: 2 },
];

defineMock({
  // stations?q=… : the filters are ignored; the mock always has these two
  'GET /api/radio/stations': (): StationsResult => ({ status: 'ok', stations }),
  // catalogue?path=…: a station list for stations/… paths, otherwise a list of genres, countries or languages
  'GET /api/radio/catalogue': ({ query }): StationsResult | FacetsResult => {
    const p = query.get('path') || '';
    return p.startsWith('stations/') ? { status: 'ok', stations } : { status: 'ok', facets };
  },
  'GET /api/radio/title': (): TitleResult => ({ title: 'Sample track, by Sample Artist' }),
});
