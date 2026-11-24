// The media session rules (core/web/media-state.ts): subscribers hear real changes, play, pause and stop
// call the app's buttons only when they apply, and a missing player does nothing.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaSession, playState, type MediaInfo } from '../src/core/web/media-state.ts';

const track: MediaInfo = { title: 'So What', subtitle: 'Miles Davis', art: '', playing: true };

test('a subscriber is told when the state changes', () => {
  const session = createMediaSession();
  const seen: string[] = [];
  session.subscribe(info => seen.push(info ? info.title : 'none'));
  session.setInfo(track);
  session.setInfo({ ...track, playing: false });
  session.setInfo(null);
  assert.deepEqual(seen, ['So What', 'So What', 'none']);
  assert.equal(session.state(), 'stopped');
});

test('a repeated identical state does not notify', () => {
  const session = createMediaSession();
  let calls = 0;
  session.subscribe(() => { calls++; });
  session.setInfo(track);
  session.setInfo({ ...track });
  session.setControls({ toggle: () => {} });
  session.setControls({ toggle: () => {} });
  assert.equal(calls, 2);
});

test('play, pause and stop do nothing with no player', () => {
  const session = createMediaSession();
  assert.doesNotThrow(() => { session.play(); session.pause(); session.stop(); });
  session.setInfo(track);
  assert.doesNotThrow(() => { session.pause(); session.stop(); });
  assert.equal(session.state(), 'playing');
});

test('play and pause call the toggle only when the state needs it', () => {
  const session = createMediaSession();
  let toggles = 0;
  session.setControls({ toggle: () => { toggles++; } });
  session.setInfo(track);
  session.play();
  assert.equal(toggles, 0, 'play while playing does nothing');
  session.pause();
  assert.equal(toggles, 1);
  session.setInfo({ ...track, playing: false });
  session.pause();
  assert.equal(toggles, 1, 'pause while paused does nothing');
  session.play();
  assert.equal(toggles, 2);
  session.setInfo({ ...track, buffering: true });
  session.play();
  assert.equal(toggles, 2, 'play while buffering does nothing');
  session.pause();
  assert.equal(toggles, 3, 'pause while buffering calls the toggle');
});

test('stop calls the stop button only when the app offers one', () => {
  const session = createMediaSession();
  let stops = 0;
  session.setControls({ toggle: () => {} });
  session.setInfo(track);
  session.stop();
  assert.equal(stops, 0);
  session.setControls({ toggle: () => {}, stop: () => { stops++; } });
  session.stop();
  assert.equal(stops, 1);
});

test('an app button that throws does not break the caller', () => {
  const session = createMediaSession();
  session.setControls({ toggle: () => { throw new Error('busy'); }, stop: () => { throw new Error('busy'); } });
  session.setInfo(track);
  assert.doesNotThrow(() => { session.pause(); session.stop(); });
});

test('playState reads stopped, buffering, playing and paused', () => {
  assert.equal(playState(null), 'stopped');
  assert.equal(playState({ ...track, buffering: true }), 'buffering');
  assert.equal(playState(track), 'playing');
  assert.equal(playState({ ...track, playing: false }), 'paused');
});
