// The now-playing hook. An app says what plays and which buttons work. The control center shows a media card
// above its volume slider while something plays. The card is ClaudeOS UI, not the Android media notification.
// An app calls setNowPlaying(null) when it stops, and setMediaActions(null) when its buttons go away.
// The state rules live in media-state.ts. This file holds the one page session and its public calls.

import { createMediaSession, type MediaControls, type MediaInfo, type PlayState } from './media-state.ts';

export type NowPlaying = MediaInfo;
export type MediaActions = MediaControls;

const session = createMediaSession();

/** What plays now: a title, a subtitle, an art URL ('' for none) and whether it is playing. Null when nothing plays. */
export function setNowPlaying(next: NowPlaying | null): void { session.setInfo(next); }

/** The buttons the card shows for the app that plays. next, prev and stop are optional. Null when no app plays. */
export function setMediaActions(next: MediaActions | null): void { session.setControls(next); }

/** Call fn with the playing state each time it changes. */
export function onNowPlaying(fn: (info: NowPlaying | null) => void): void { session.subscribe(fn); }

export function nowPlaying(): NowPlaying | null { return session.info(); }
export function mediaActions(): MediaActions | null { return session.controls(); }

/** The play state: stopped, paused, playing or buffering. */
export function mediaState(): PlayState { return session.state(); }

/** Start the app's playback. Does nothing unless the app is paused. */
export function playMedia(): void { session.play(); }

/** Pause the app's playback. Does nothing unless the app is playing or buffering. */
export function pauseMedia(): void { session.pause(); }

/** Stop the app. Does nothing unless the app offers a stop button. */
export function stopMedia(): void { session.stop(); }
