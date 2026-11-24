// The Radio player's choices that need no DOM: the next or previous favourite, the line under the station name,
// the colour block for a station with no logo, and the volume. Tested in test/radio-player.test.ts.
import type { Station } from '../api.ts';

export type PlayState = 'off' | 'buffering' | 'playing' | 'paused';

/** The favourite one step from the current station (dir 1 is next, -1 is previous). Wraps around at both ends.
 *  A station that is not a favourite starts from the outside: next gives the first, previous gives the last. */
export function stepFavourite(favs: Station[], currentId: string | null, dir: 1 | -1): Station | null {
  if (!favs.length) return null;
  const at = currentId == null ? -1 : favs.findIndex(s => s.id === currentId);
  if (at < 0) return dir === 1 ? favs[0] : favs[favs.length - 1];
  return favs[(at + dir + favs.length) % favs.length];
}

/** The short line under the station name: the stream's title while it plays (if it sends one), else the state. */
export function titleLine(hasStation: boolean, state: PlayState, streamTitle = ''): string {
  if (!hasStation) return 'Pick a station to listen';
  if (state === 'buffering') return 'Tuning in…';
  if (state === 'paused') return 'Paused';
  if (state === 'off') return 'Stopped';
  return streamTitle.trim() || 'Live radio';
}

/** The rail's glance: the station on the air, or the app's own name when the radio is off. */
export function railLabel(station: Station | null, state: PlayState, appName: string): string {
  return station && state !== 'off' ? station.name : appName;
}

const HUES = [18, 32, 48, 96, 150, 190, 215, 330];

/** A steady, muted hue for a station's colour block (the directory sends no logo we keep). */
export function stationHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return HUES[h % HUES.length];
}

/** The station's first letter or digit for its colour block, or "·" when it has none. */
export function initial(name: string): string {
  const m = name.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '·';
}

/** A saved volume as 0..100; anything else is the default, 80. */
export function volumeFrom(value: unknown): number {
  if (value === null || value === undefined || value === '') return 80;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 80;
}
