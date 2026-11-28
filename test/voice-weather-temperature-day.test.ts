// The temperature on a named weekday by voice (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forecastDay } from '../src/core/web/voice-weather.ts';

// today is Wednesday (3)
test('"what’s the temperature on Saturday" and "how cold will it be on Friday" are weekday questions', () => {
  assert.deepEqual(forecastDay("what's the temperature on saturday", 3), { day: 3, rainOnly: null });
  assert.deepEqual(forecastDay('how cold will it be on friday', 3), { day: 2, rainOnly: null });
  assert.deepEqual(forecastDay('how hot is it going to be on saturday', 3), { day: 3, rainOnly: null });
});

test('"how hot will it be on Saturday" is a weekday question too', () => {
  assert.deepEqual(forecastDay('how hot will it be on saturday', 3), { day: 3, rainOnly: null });
  assert.deepEqual(forecastDay("what is the temperature on monday", 3), { day: 5, rainOnly: null });
});

test('a temperature question with no weekday is not a weekday question', () => {
  assert.equal(forecastDay("what's the temperature in paris", 3), null);
});
