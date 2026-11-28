// Voice words for the radio: "play the radio" starts the last station, "stop the radio" pauses it, "what's playing" says
// what is on. Pure: no DOM, so Node tests it (test/voice-radio.test.ts). The command handler (voice-commands.ts) does the
// play and the pause, and reads what is on from the app's now-playing line.

export type RadioWord = 'play' | 'stop' | 'whats-playing';

/** "play the radio", "stop the radio" or "what's playing" (the caller has already cleaned the phrase), or null. */
export function radioWord(t: string): RadioWord | null {
  if (/^(?:play|turn on|start|resume)(?: the| my)? radio$/.test(t)) return 'play';
  if (/^(?:stop|pause|turn off|switch off)(?: the| my)? radio$|^turn(?: the| my)? radio off$/.test(t)) return 'stop';
  if (/^(?:what(?:'s| is) playing|what station is this|what(?:'s| is) on the radio)$/.test(t)) return 'whats-playing';
  return null;
}

import type { PlayState } from './media-state.ts';

/** A "stop the radio" counts while it plays or is still tuning in (buffering): pausing stops it either way. */
export function radioStopHeard(s: PlayState): boolean { return s === 'playing' || s === 'buffering'; }

/** What is playing, said aloud: the station and its subtitle, with "Paused" when it is paused. Nothing when no station plays. */
export function playingSay(info: { title: string; subtitle?: string } | null, state: PlayState): string {
  if (!info || !info.title || state === 'stopped') return 'Nothing is playing.';
  const line = info.subtitle ? `${info.title}, ${info.subtitle}` : info.title;
  return state === 'paused' ? `${line}. Paused.` : `${line}.`;
}
