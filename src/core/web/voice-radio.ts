// Voice words for the radio: "play the radio" starts the last station, "stop the radio" pauses it, "what's playing" says
// what is on. Pure: no DOM, so Node tests it (test/voice-radio.test.ts). The command handler (voice-commands.ts) does the
// play and the pause, and reads what is on from the app's now-playing line.

import type { Station } from '../../apps/radio/api.ts';
import { SLEEP_CHOICES } from '../../apps/radio/web/player.ts';
import { parseDuration } from './voice-parse.ts';

export type RadioWord = 'play' | 'stop' | 'whats-playing' | 'next' | 'prev';

/** "turn the radio off in 30 minutes", "radio sleep timer 15 minutes": the sleep length (15, 30 or 60 minutes), or null.
 *  A length that is not one of the Radio app's sleep choices is left to Claude. */
export function radioSleepWord(t: string): number | null {
  const m = /^(?:turn (?:the )?radio off|turn off (?:the )?radio|stop (?:the )?radio|switch (?:the )?radio off|radio sleep timer|sleep timer (?:for |on )?(?:the )?radio)(?: in| for)? (.+)$/.exec(t);
  if (!m) return null;
  const ms = parseDuration(m[1]);
  if (ms === null) return null;
  const minutes = Math.round(ms / 60000);
  return (SLEEP_CHOICES as readonly number[]).includes(minutes) ? minutes : null;
}

/** "play Radio 2", "put on Jazz FM": the station name said, or null when the phrase is not a station request. */
export function stationWord(t: string): string | null {
  const m = /^(?:play|put on|switch to|tune to) (.+?)(?: on the radio)?$/.exec(t);
  if (!m || /^(?:the |my )?radio$/.test(m[1])) return null;
  return m[1];
}

/** The one saved station with this name (any case). Null when none has it, or when two different stations do: it never guesses. */
export function matchStation(name: string, stations: Station[]): Station | null {
  const want = name.trim().toLowerCase();
  const byId = new Map<string, Station>();
  for (const s of stations) if (s?.id && !byId.has(s.id)) byId.set(s.id, s);
  const hits = [...byId.values()].filter(s => (s.name ?? '').trim().toLowerCase() === want);
  return hits.length === 1 ? hits[0] : null;
}

/** "play the radio", "stop the radio" or "what's playing" (the caller has already cleaned the phrase), or null. */
export function radioWord(t: string): RadioWord | null {
  if (/^(?:play|turn on|switch on|start|resume)(?: the| my)? radio$|^(?:turn|switch)(?: the| my)? radio on$/.test(t)) return 'play';
  if (/^(?:stop|pause|turn off|switch off)(?: the| my)? radio$|^turn(?: the| my)? radio off$/.test(t)) return 'stop';
  if (/^(?:what(?:'s| is) playing|what station is this|what(?:'s| is) on the radio)$/.test(t)) return 'whats-playing';
  // the next or previous favourite: "next station", "skip station", "previous radio station"
  if (/^(?:next|skip|skip to the next|play the next|play next)(?: radio)? station$|^skip(?: the)? radio$/.test(t)) return 'next';
  if (/^(?:previous|go back to the previous|play the previous|play previous)(?: radio)? station$/.test(t)) return 'prev';
  return null;
}

import type { PlayState } from './media-state.ts';

/** A "stop the radio" counts while it plays or is still tuning in (buffering): pausing stops it either way. */
export function radioStopHeard(s: PlayState): boolean { return s === 'playing' || s === 'buffering'; }

/** True when the station now playing is this saved station (its name, any case). Another station is switched to, not refused. */
export function isSameStation(nowTitle: string | undefined, s: Station): boolean {
  return !!nowTitle && (s.name ?? '').trim().toLowerCase() === nowTitle.trim().toLowerCase();
}

/** "Play the radio" while a station already plays (or is still tuning in): say so, rather than restart its stream. Null when nothing plays. */
export function alreadyPlayingSay(info: { title: string } | null, state: PlayState): string | null {
  if (state !== 'playing' && state !== 'buffering') return null;
  return `${info?.title ? info.title : 'The radio'} is already playing.`;
}

/** What is playing, said aloud: the station and its subtitle, with "Paused" when it is paused. Nothing when no station plays. */
export function playingSay(info: { title: string; subtitle?: string } | null, state: PlayState): string {
  if (!info || !info.title || state === 'stopped') return 'Nothing is playing.';
  const line = info.subtitle ? `${info.title}, ${info.subtitle}` : info.title;
  return state === 'paused' ? `${line}. Paused.` : `${line}.`;
}
