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

/** Next and previous need two or more favourites: with one, stepping would play the same station. */
export function canStepFavourites(favs: readonly unknown[]): boolean {
  return favs.length >= 2;
}

/** The short line under the station name: the stream's title while it plays (if it sends one), else the state. */
export function titleLine(hasStation: boolean, state: PlayState, streamTitle = ''): string {
  if (!hasStation) return 'Pick a station to listen';
  if (state === 'buffering') return 'Tuning in…';
  if (state === 'paused') return 'Paused';
  if (state === 'off') return 'Stopped';
  return streamTitle.trim() || 'Live radio';
}

/** What the bar and the drawer card show: the station, its state line and the buttons they need. */
export type BarModel = { title: string; subtitle: string; art: string; playing: boolean; canStep: boolean; live: boolean };

/** One model for the bottom bar and the drawer card, so the two never disagree. Live is false when nothing plays. */
export function barModel(current: Station | null, state: PlayState, streamTitle: string, favs: readonly unknown[]): BarModel {
  return {
    title: current ? current.name : 'Nothing playing',
    subtitle: titleLine(!!current, state, streamTitle),
    art: current?.favicon ?? '',
    playing: state === 'playing' || state === 'buffering',
    canStep: canStepFavourites(favs),
    live: !!current && state !== 'off',
  };
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

/** The device media volume (0..1, as device.volume() and onVolume report) as a slider value 0..100. Null when the level is missing or not a number. */
export function volumeFromDevice(level: unknown): number | null {
  if (level === null || level === undefined || level === '') return null;
  const n = Number(level);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 100) : null;
}

/** The sleep timer's choices in minutes; 0 is off. */
export const SLEEP_CHOICES = [0, 15, 30, 60] as const;

/** When the sleep timer stops the radio (ms since 1970), or null for off or a length that is not a choice. */
export function sleepEnd(now: number, minutes: number): number | null {
  if (!minutes || !(SLEEP_CHOICES as readonly number[]).includes(minutes)) return null;
  return now + minutes * 60_000;
}

/** Whole minutes left on the sleep timer, rounded up (0 once it is due). */
export function sleepLeft(end: number, now: number): number {
  return Math.max(0, Math.ceil((end - now) / 60_000));
}

/** The stream title from an ICY metadata block ("StreamTitle='Artist - Song';"), or '' when there is none. */
export function icyTitle(meta: string): string {
  const m = meta.match(/StreamTitle='([\s\S]*?)';/);
  return m ? m[1].replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
}

/** A clear line for why a station did not play, from the audio element's error code (MediaError). */
export function failMessage(code: number | undefined): string {
  if (code === 4) return 'This station\'s stream format doesn\'t play here. Try another.';
  if (code === 2) return 'This station is not reachable right now. Try another.';
  if (code === 3) return 'This station\'s stream broke off. Try again or pick another.';
  return 'This station didn\'t play. Try another.';
}
