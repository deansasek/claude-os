// The Home shelves' choices that need no DOM: which shelves show, in what order, how many cards each holds, and the
// warm colour of a category tile. Tested in test/radio-shelves.test.ts.
import type { Facet } from '../api.ts';

export type ShelfId = 'favs' | 'recent' | 'top' | 'genres' | 'countries';
export type Load = 'loading' | 'ok' | 'error';

export const SHELF_ORDER: readonly ShelfId[] = ['favs', 'recent', 'top', 'genres', 'countries'];
export const TOP_COUNT = 20;      // Top stations: the first cards on the shelf
export const FACET_COUNT = 12;    // Genres and Countries: the first by station count
export const FAV_EMPTY = 'Tap the heart on a station to keep it here.';
export const TOP_ERROR = 'Radio Browser is not available. Try again.';

/** The warm tones for category tiles (the house palette; no greens or blues on large tiles). */
export const WARM_HUES = [18, 32, 48, 96, 330] as const;

export interface HomeInput {
  favs: number;
  recent: number;
  top: Load;
  topCount: number;
  genres: Load;
  genreCount: number;
  countries: Load;
  countryCount: number;
}

export interface ShelfPlan {
  id: ShelfId;
  title: string;
  count: number;       // the cards the shelf shows
  hidden: boolean;     // true: the shelf is not drawn
  loading: boolean;    // Top stations: draw skeleton cards
  error: string;       // Top stations: the line to show instead of cards
  showAll: boolean;    // the heading shows Show all
}

/** The Home shelves in order, each with its count and state. Favourites always shows (an empty card when no favourite).
 *  Recently played hides when empty. Top stations shows skeletons while it loads and an error line on failure.
 *  Genres and Countries hide while they load and on error, and when empty. */
export function homeShelves(i: HomeInput): ShelfPlan[] {
  const top: ShelfPlan = {
    id: 'top', title: 'Top stations', count: Math.min(i.topCount, TOP_COUNT), hidden: i.top === 'ok' && i.topCount === 0,
    loading: i.top === 'loading', error: i.top === 'error' ? TOP_ERROR : '', showAll: true,
  };
  const facet = (id: 'genres' | 'countries', title: string, state: Load, n: number): ShelfPlan => ({
    id, title, count: Math.min(n, FACET_COUNT), hidden: state !== 'ok' || n === 0, loading: false, error: '', showAll: true,
  });
  const plan: Record<ShelfId, ShelfPlan> = {
    favs: { id: 'favs', title: 'Favourites', count: i.favs, hidden: false, loading: false, error: '', showAll: false },
    recent: { id: 'recent', title: 'Recently played', count: i.recent, hidden: i.recent === 0, loading: false, error: '', showAll: false },
    top,
    genres: facet('genres', 'Genres', i.genres, i.genreCount),
    countries: facet('countries', 'Countries', i.countries, i.countryCount),
  };
  return SHELF_ORDER.map(id => plan[id]);
}

/** The genres or countries a shelf shows: the first FACET_COUNT by station count, most first. */
export function topFacets(list: readonly Facet[]): Facet[] {
  return [...list].sort((a, b) => b.count - a.count).slice(0, FACET_COUNT);
}

/** A steady warm hue for a category tile. */
export function tileHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return WARM_HUES[h % WARM_HUES.length];
}

export const MORE_COUNT = 20;   // More like this: the cards on the station page

/** The stations for More like this: the genre's list without the station itself, the first MORE_COUNT. */
export function moreLikeThis<T extends { id: string }>(list: readonly T[], stationId: string): T[] {
  return list.filter(s => s.id !== stationId).slice(0, MORE_COUNT);
}
