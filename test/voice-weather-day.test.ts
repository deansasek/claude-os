// Weather on a named weekday by voice (src/core/web/voice-weather.ts; the reply is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { forecastDay, weekdayName } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a weekday counts the days ahead from today, and today’s own weekday is today', () => {
  // today is Wednesday (3)
  assert.deepEqual(forecastDay("what's the weather on saturday", 3), { day: 3, rainOnly: null });
  assert.deepEqual(forecastDay('weather on wednesday', 3), { day: 0, rainOnly: null });
});

test('rain, snow and umbrella questions for a weekday say which one is asked about', () => {
  assert.deepEqual(forecastDay('will it rain on friday', 3), { day: 2, rainOnly: 'rain' });
  assert.deepEqual(forecastDay('do i need an umbrella on sunday', 3), { day: 4, rainOnly: 'rain' });
  assert.deepEqual(forecastDay('is it going to snow on monday', 3), { day: 5, rainOnly: 'snow' });
});

test('phrases that are not a weekday weather question are left to the other matchers', () => {
  assert.equal(forecastDay("what's the weather on funday", 3), null);
  assert.equal(forecastDay('what is the capital on saturday', 3), null);
  assert.equal(forecastDay('will it rain tomorrow', 3), null);
});

test('the weekday name is read from the day of the week', () => {
  assert.equal(weekdayName(6), 'Saturday');
  assert.equal(weekdayName(0), 'Sunday');
  assert.equal(weekdayName(9), 'Tuesday');
});

test('the reply uses the forecastDay wiring and the weekday name for days after tomorrow', () => {
  assert.ok(voice.includes('forecastDay(t, new Date().getDay())'));
  assert.ok(voice.includes('`on ${dayName}`'));
});
