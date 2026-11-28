// "Is it raining" right now (src/core/web/voice-weather.ts rainingNow and nowSay, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nowSay, rainingNow } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('is it raining and is it snowing, now, are heard; the chance later on is not', () => {
  assert.equal(rainingNow('is it raining'), 'raining');
  assert.equal(rainingNow('is it raining outside'), 'raining');
  assert.equal(rainingNow('is it raining right now'), 'raining');
  assert.equal(rainingNow('is it snowing'), 'snowing');
  assert.equal(rainingNow('will it rain tomorrow'), null);
  assert.equal(rainingNow('is it windy'), null);
});

test('the reply reads the current weather code: rain, storms and snow are yes', () => {
  assert.equal(nowSay(61, 'raining'), 'Yes, it’s raining.');
  assert.equal(nowSay(95, 'raining'), 'Yes, it’s raining.');
  assert.equal(nowSay(0, 'raining'), 'No, it’s not raining right now.');
  assert.equal(nowSay(73, 'snowing'), 'Yes, it’s snowing.');
  assert.equal(nowSay(61, 'snowing'), 'No, it’s not snowing right now.');
});

test('the voice reads the current weather from the forecast', () => {
  assert.match(voice, /const falling = rainingNow\(t\);/);
  assert.match(voice, /const code = w\.current\?\.weather_code;/);
});
