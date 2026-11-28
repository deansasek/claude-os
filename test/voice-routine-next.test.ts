// "What's the next routine" by voice (src/apps/routines/web/next-run.ts; the wiring is in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nextRun, nextRunSay } from '../src/apps/routines/web/next-run.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const now = new Date(2026, 10, 28, 9, 0);   // Saturday 28 November, 9 am

test('with no routine timed, the answer says so', () => {
  assert.equal(nextRunSay(nextRun([{ name: 'Tidy up' }], now), now), 'No routine has a time set.');
  assert.equal(nextRunSay(nextRun([], now), now), 'No routine has a time set.');
});

test('the next timed routine is named with its day and time', () => {
  const routines = [{ name: 'Good morning', at: { h: 7, m: 0, days: [] } }];
  assert.match(nextRunSay(nextRun(routines, now), now), /^Good morning runs tomorrow at \d/);
});

test('a routine later today is said as today', () => {
  const routines = [{ name: 'Supper', at: { h: 18, m: 30, days: [] } }];
  assert.match(nextRunSay(nextRun(routines, now), now), /^Supper runs today at \d/);
});

test('the voice reads the next routine from the routines list, and nothing is run', () => {
  assert.ok(voice.includes('nextRunSay(nextRun(list, new Date()), new Date())'));
  assert.ok(voice.includes("when(?:'s| is) the next routine"));
});
