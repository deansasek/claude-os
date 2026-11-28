// Air quality by voice (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { airSay, airWord } from '../src/core/web/voice-weather.ts';

test('air quality questions are matched, with or without "today" or "outside"', () => {
  assert.equal(airWord("what's the air quality"), true);
  assert.equal(airWord('what is the air quality outside'), true);
  assert.equal(airWord("how's the air today"), true);
  assert.equal(airWord('is the air good'), true);
  assert.equal(airWord('is the air good today'), true);
});

test('other questions about air or weather are not air questions', () => {
  assert.equal(airWord('is it windy'), false);
  assert.equal(airWord('what is the air pressure'), false);
  assert.equal(airWord("what's the air quality in paris"), false);
});

test('the answer uses the Weather screen band words for each AQI band', () => {
  assert.equal(airSay(28), 'Air quality is 28: Good.');
  assert.equal(airSay(75), 'Air quality is 75: Moderate.');
  assert.equal(airSay(120), 'Air quality is 120: Unhealthy for sensitive groups.');
  assert.equal(airSay(180), 'Air quality is 180: Unhealthy.');
  assert.equal(airSay(250), 'Air quality is 250: Very unhealthy.');
  assert.equal(airSay(320), 'Air quality is 320: Hazardous.');
});

test('no AQI from the forecast says the air quality is not available', () => {
  assert.equal(airSay(null), 'I can’t get the air quality right now.');
});
