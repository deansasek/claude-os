// Source-text check for the drawer media card: its DOM code runs in the browser, so this reads
// src/core/web/media-state.ts, media.ts and system.ts. Skip and stop call the session, and with no player
// (no controls, or no next or stop call) they do nothing.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const state = readFileSync(new URL('../src/core/web/media-state.ts', import.meta.url), 'utf8');
const media = readFileSync(new URL('../src/core/web/media.ts', import.meta.url), 'utf8');
const system = readFileSync(new URL('../src/core/web/system.ts', import.meta.url), 'utf8');

test('the session skip and stop call the app buttons only when they exist', () => {
  assert.match(state, /next\(\) \{ run\(\(\) => controls\?\.next\?\.\(\)\); \}/);
  assert.match(state, /stop\(\) \{ run\(\(\) => controls\?\.stop\?\.\(\)\); \}/);
});

test('skipMedia and stopMedia call the session, not an app directly', () => {
  assert.match(media, /export function skipMedia\(\): void \{ session\.next\(\); \}/);
  assert.match(media, /export function stopMedia\(\): void \{ session\.stop\(\); \}/);
});

test('the drawer card shows skip and stop only when the session offers them', () => {
  assert.match(system, /\$\{a\?\.next \? `<button class="cc-media-btn" data-media="next"/);
  assert.match(system, /\$\{a\?\.stop \? `<button class="cc-media-btn" data-media="stop"/);
});

test('the drawer card click handler routes skip and stop to the session', () => {
  assert.match(system, /else if \(kind === 'next'\) skipMedia\(\);/);
  assert.match(system, /else if \(kind === 'stop'\) stopMedia\(\);/);
  assert.match(system, /if \(kind === 'toggle'\) \{ if \(playing\) pauseMedia\(\); else playMedia\(\); \}/);
});
