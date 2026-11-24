// The Home landing's choices that need no DOM: the greeting by time of day, the filter chips, which shelves a chip
// shows, the Made for you picks and their one-line description.
import type { Station } from '../api.ts';
import type { ShelfId } from './shelves.ts';

/** The greeting line at the top of Home, by the hour (0..23). */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export type Chip = 'all' | 'favs' | 'recent' | 'top' | 'genres' | 'countries';
export const CHIPS: readonly [Chip, string][] = [
  ['all', 'All'], ['favs', 'Favourites'], ['recent', 'Recently played'], ['top', 'Stations'], ['genres', 'Genres'], ['countries', 'Countries'],
];

/** The landing's shelves, top to bottom. "favs" is Your top stations; "top" is Made for you. */
export const LANDING_ORDER: readonly ShelfId[] = ['recent', 'top', 'favs', 'genres', 'countries'];

/** True when the chosen chip shows this shelf. All shows every shelf. */
export function chipShows(chip: Chip, shelf: ShelfId): boolean {
  return chip === 'all' || chip === shelf;
}

export const MADE_COUNT = 8;   // Made for you: two rows of four

/** Made for you: the directory's top stations, the ones that share a genre with the listener's own stations first
 *  (more shared genres first, then the directory's order). Stations the listener already has are left out. With no
 *  own stations, the first of the top list. */
export function madeForYou(top: readonly Station[], own: readonly Station[], n = MADE_COUNT): Station[] {
  const mine = new Set(own.map(s => s.id));
  const tags = new Set(own.flatMap(s => s.tags ?? []).map(t => t.toLowerCase()));
  const score = (s: Station) => (s.tags ?? []).filter(t => tags.has(t.toLowerCase())).length;
  return top.filter(s => !mine.has(s.id))
    .map((s, i) => ({ s, i, k: score(s) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .slice(0, n)
    .map(x => x.s);
}

/** One line about a station: its first genres, else its country, else its format. */
export function describe(s: Station): string {
  const tags = (s.tags ?? []).slice(0, 3).filter(Boolean);
  if (tags.length) { const line = tags.join(', '); return line[0].toUpperCase() + line.slice(1); }
  if (s.country) return s.country;
  return [s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ''].filter(Boolean).join(' · ');
}
