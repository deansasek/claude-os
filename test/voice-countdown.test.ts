// "How many days until Christmas" by voice (src/core/web/voice-countdown.ts, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { christmasSay, countdownWord, daysUntilChristmas } from '../src/core/web/voice-countdown.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the Christmas countdown phrases are heard, and other phrases are not', () => {
  assert.equal(countdownWord('how many days until christmas'), true);
  assert.equal(countdownWord('how many sleeps until christmas'), true);
  assert.equal(countdownWord('is it christmas yet'), true);
  assert.equal(countdownWord('how many days until my birthday'), false);
  assert.equal(countdownWord('what is christmas'), false);
});

test('the count is calendar days, 0 on 25 December, and next year’s after it has passed', () => {
  assert.equal(daysUntilChristmas(new Date(2026, 10, 28, 9, 0)), 27);   // 28 November
  assert.equal(daysUntilChristmas(new Date(2026, 11, 24, 23, 0)), 1);  // Christmas Eve, late
  assert.equal(daysUntilChristmas(new Date(2026, 11, 25, 0, 30)), 0);  // the day itself
  assert.equal(daysUntilChristmas(new Date(2026, 11, 26, 8, 0)), 364);  // the day after: next year’s
});

test('the reply says the count, the day itself, and tomorrow', () => {
  assert.equal(christmasSay(new Date(2026, 10, 28, 9, 0)), '27 days until Christmas.');
  assert.equal(christmasSay(new Date(2026, 11, 25, 9, 0)), 'It’s Christmas today!');
  assert.equal(christmasSay(new Date(2026, 11, 24, 9, 0)), 'Christmas is tomorrow.');
});

test('the voice answers the phrase from the time-and-date block', () => {
  assert.match(voice, /if \(countdownWord\(t\)\) return \{ say: christmasSay\(new Date\(\)\), react: 'look' \};/);
});
