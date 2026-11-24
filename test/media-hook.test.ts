// The now-playing hook (core/web/media.ts): the playing state and its buttons reach every listener.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaActions, nowPlaying, onNowPlaying, setMediaActions, setNowPlaying } from '../src/core/web/media.ts';

const track = { title: 'So What', subtitle: 'Miles Davis', art: '', playing: true };

test('setNowPlaying stores the playing state and null clears it', () => {
  setNowPlaying(track);
  assert.deepEqual(nowPlaying(), track);
  setNowPlaying(null);
  assert.equal(nowPlaying(), null);
});

test('setMediaActions stores the buttons and null removes them', () => {
  const toggle = () => {};
  setMediaActions({ toggle });
  assert.equal(mediaActions()?.toggle, toggle);
  assert.equal(mediaActions()?.next, undefined);
  setMediaActions(null);
  assert.equal(mediaActions(), null);
});

test('every listener hears each change, and one that throws does not stop the rest', () => {
  const seen: string[] = [];
  onNowPlaying(() => { throw new Error('bad listener'); });
  onNowPlaying(info => seen.push(info ? info.title : 'none'));
  setNowPlaying(track);
  setNowPlaying(null);
  assert.deepEqual(seen, ['So What', 'none']);
});
