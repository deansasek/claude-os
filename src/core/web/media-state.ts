// The media session: what plays, its play state and the buttons an app offers. It has no DOM, so node tests can run it
// (test/media-state.test.ts). media.ts keeps one session for the page. The drawer and the ambient screen read it.
// Play, pause and stop call the app's buttons. With no app, or no button for the call, they do nothing.

export type PlayState = 'playing' | 'paused' | 'buffering' | 'stopped';

export interface MediaInfo { title: string; subtitle: string; art: string; playing: boolean; buffering?: boolean }
export interface MediaControls { toggle: () => void; next?: () => void; prev?: () => void; stop?: () => void }

export interface MediaSession {
  info(): MediaInfo | null;
  controls(): MediaControls | null;
  state(): PlayState;
  setInfo(next: MediaInfo | null): void;
  setControls(next: MediaControls | null): void;
  subscribe(fn: (info: MediaInfo | null) => void): void;
  play(): void;
  pause(): void;
  next(): void;
  stop(): void;
}

/** The play state for an info: stopped without info, else buffering, playing or paused. */
export function playState(info: MediaInfo | null): PlayState {
  if (!info) return 'stopped';
  if (info.buffering) return 'buffering';
  return info.playing ? 'playing' : 'paused';
}

/** True when two infos show the same title, subtitle, art and state. */
export function sameInfo(a: MediaInfo | null, b: MediaInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.title === b.title && a.subtitle === b.subtitle && a.art === b.art
    && a.playing === b.playing && (a.buffering ?? false) === (b.buffering ?? false);
}

/** True when two button sets show the same buttons. Function identity does not count: an app may pass new closures. */
export function sameButtons(a: MediaControls | null, b: MediaControls | null): boolean {
  if (!a || !b) return a === b;
  return !!a.next === !!b.next && !!a.prev === !!b.prev && !!a.stop === !!b.stop;
}

/** A new media session. Each change that the drawer can show calls every subscriber once. */
export function createMediaSession(): MediaSession {
  let info: MediaInfo | null = null;
  let controls: MediaControls | null = null;
  const listeners: ((info: MediaInfo | null) => void)[] = [];

  function notify(): void {
    for (const fn of listeners) {
      try { fn(info); } catch { /* one listener must not stop the others */ }
    }
  }

  // A failing app button must not break the caller. The app that plays may be busy.
  function run(call: () => void): void {
    try { call(); } catch { /* ignore */ }
  }

  return {
    info: () => info,
    controls: () => controls,
    state: () => playState(info),
    setInfo(next) {
      const changed = !sameInfo(info, next);
      info = next;
      if (changed) notify();
    },
    setControls(next) {
      const changed = !sameButtons(controls, next);
      controls = next;
      if (changed) notify();
    },
    subscribe(fn) { listeners.push(fn); },
    play() {
      if (playState(info) === 'paused') run(() => controls?.toggle());
    },
    pause() {
      const s = playState(info);
      if (s === 'playing' || s === 'buffering') run(() => controls?.toggle());
    },
    next() { run(() => controls?.next?.()); },
    stop() { run(() => controls?.stop?.()); },
  };
}
