// Voice words for the radio: "play the radio" starts the last station, "stop the radio" pauses it. Pure: no DOM, so Node
// tests it (test/voice-radio.test.ts). The command handler (voice-commands.ts) does the play and the pause.

/** "play the radio" or "stop the radio" (the caller has already cleaned the phrase), or null. */
import type { PlayState } from './media-state.ts';

export function radioWord(t: string): 'play' | 'stop' | null {
  if (/^(?:play|turn on|start|resume)(?: the| my)? radio$/.test(t)) return 'play';
  if (/^(?:stop|pause|turn off|switch off)(?: the| my)? radio$|^turn(?: the| my)? radio off$/.test(t)) return 'stop';
  return null;
}

/** A "stop the radio" counts while it plays or is still tuning in (buffering): pausing stops it either way. */
export function radioStopHeard(s: PlayState): boolean { return s === 'playing' || s === 'buffering'; }
