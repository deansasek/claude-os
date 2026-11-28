// Frost and freezing questions for tonight (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frostSay, frostTonight, overnightLow } from '../src/core/web/voice-weather.ts';

test('frost and freezing questions for tonight are matched, with or without "tonight"', () => {
  assert.equal(frostTonight('will it freeze tonight'), true);
  assert.equal(frostTonight('will it freeze'), true);
  assert.equal(frostTonight('will there be a frost tonight'), true);
  assert.equal(frostTonight('is it going to be below freezing tonight'), true);
  assert.equal(frostTonight('will it get below freezing'), true);
});

test('"is it freezing" and weather questions for other times are not frost questions', () => {
  assert.equal(frostTonight('is it freezing'), false);
  assert.equal(frostTonight('will it freeze tomorrow'), false);
  assert.equal(frostTonight('is it raining tonight'), false);
  assert.equal(frostTonight('is it cold tonight'), false);
});

test('the overnight low is the lowest hour from now until 08:00 tomorrow only', () => {
  const times = ['2026-11-27T14:00', '2026-11-27T15:00', '2026-11-27T23:00', '2026-11-28T03:00', '2026-11-28T07:00', '2026-11-28T08:00', '2026-11-28T12:00'];
  const temps = [9, 6, -2, 1, 3, -9, -12];
  // the 14:00 hour is before now; 08:00 and later tomorrow are outside the night
  assert.equal(overnightLow(times, temps, '2026-11-27T15:45'), -2);
  assert.equal(overnightLow(times, temps, '2026-11-29T09:10'), null);
});

test('the answer says yes below freezing and no above, in Celsius and Fahrenheit', () => {
  assert.equal(frostSay(-2, 'celsius'), 'Yes, down to -2 degrees tonight: below freezing.');
  assert.equal(frostSay(0, 'celsius'), 'Yes, down to 0 degrees tonight: below freezing.');
  assert.equal(frostSay(4, 'celsius'), 'No, the low tonight is 4 degrees.');
  assert.equal(frostSay(31, 'fahrenheit'), 'Yes, down to 31 degrees tonight: below freezing.');
  assert.equal(frostSay(38, 'fahrenheit'), 'No, the low tonight is 38 degrees.');
});
