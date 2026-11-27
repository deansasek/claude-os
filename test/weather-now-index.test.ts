// The Weather hourly column for "now" moves on with the hours since the forecast was fetched (src/apps/weather/web/now-index.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nowIndex } from '../src/apps/weather/web/now-index.ts';

const HOUR = 3600e3, MIN = 60e3;
const hours = Array.from({ length: 24 }, (_, h) => `2026-11-27T${String(h).padStart(2, '0')}:00`);

/** A forecast fetched at `at` (a 2026-11-27 time), with the hourly list above. */
function forecast(at: string): { current: { time: string }; hourly: { time: string[] }; updated: string } {
  return { current: { time: at }, hourly: { time: hours }, updated: `${at}:00Z` };
}

test('a fresh forecast gives the hour it was fetched in', () => {
  const w = forecast('2026-11-27T15:15');
  assert.equal(nowIndex(w, Date.parse(w.updated)), 15);
});

test('a forecast 4 h 10 m old moves on 4 hours', () => {
  const w = forecast('2026-11-27T15:15');
  assert.equal(nowIndex(w, Date.parse(w.updated) + 4 * HOUR + 10 * MIN), 19);
});

test('a forecast taken at :45 that is 20 minutes old moves on 1 hour', () => {
  const w = forecast('2026-11-27T15:45');
  assert.equal(nowIndex(w, Date.parse(w.updated) + 20 * MIN), 16);
});

test('the index never runs past the end of the hourly list', () => {
  const w = forecast('2026-11-27T15:15');
  assert.equal(nowIndex(w, Date.parse(w.updated) + 20 * HOUR), 23);
});

test('an hour missing from the list gives the first column', () => {
  const w = { current: { time: '2026-11-27T30:15' }, hourly: { time: hours }, updated: '2026-11-27T15:15:00Z' };
  assert.equal(nowIndex(w, Date.parse(w.updated)), 0);
});
