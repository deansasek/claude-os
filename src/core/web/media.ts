// The now-playing hook. An app says what plays and which buttons work. The control center shows a media card
// above its volume slider while something plays. The card is ClaudeOS UI, not the Android media notification.
// An app calls setNowPlaying(null) when it stops, and setMediaActions(null) when its buttons go away.

export interface NowPlaying { title: string; subtitle: string; art: string; playing: boolean }
export interface MediaActions { toggle: () => void; next?: () => void; prev?: () => void }

let info: NowPlaying | null = null;
let actions: MediaActions | null = null;
const listeners: ((info: NowPlaying | null) => void)[] = [];

/** Tell every listener (the control center) that the playing state or its buttons changed. */
function emit(): void {
  for (const fn of listeners) {
    try { fn(info); } catch { /* one listener must not stop the others */ }
  }
}

/** What plays now: a title, a subtitle, an art URL ('' for none) and whether it is playing. Null when nothing plays. */
export function setNowPlaying(next: NowPlaying | null): void { info = next; emit(); }

/** The buttons the card shows for the app that plays. next and prev are optional. Null when no app plays. */
export function setMediaActions(next: MediaActions | null): void { actions = next; emit(); }

/** Call fn with the playing state each time it changes. */
export function onNowPlaying(fn: (info: NowPlaying | null) => void): void { listeners.push(fn); }

export function nowPlaying(): NowPlaying | null { return info; }
export function mediaActions(): MediaActions | null { return actions; }
