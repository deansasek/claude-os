// "What time is sunset" by voice (src/core/web/voice-weather.ts sunDay and sunSay, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sunDay, sunSay } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const TODAY = '2026-11-27T16:21', TOMORROW = '2026-11-28T16:20';

test('a sunrise or sunset question is heard for today or tomorrow', () => {
  assert.deepEqual(sunDay('what time is sunset'), { which: 'sunset', day: 0 });
  assert.deepEqual(sunDay('when does it get dark'), { which: 'sunset', day: 0 });
  assert.deepEqual(sunDay('when is sunrise tomorrow'), { which: 'sunrise', day: 1 });
  assert.deepEqual(sunDay('when does the sun rise'), { which: 'sunrise', day: 0 });
});

test('other phrases are not sun questions', () => {
  assert.equal(sunDay('is it windy'), null);
  assert.equal(sunDay('what time is it'), null);
  assert.equal(sunDay('when is my alarm'), null);
});

test('before the time, the reply gives today’s time as still to come', () => {
  assert.equal(sunSay('sunset', TODAY, TOMORROW, new Date(2026, 10, 27, 10, 0)), 'Sunset is at 4:21 PM today.');
});

test('after the time has passed, the reply says it was, and gives tomorrow’s time', () => {
  assert.equal(sunSay('sunset', TODAY, TOMORROW, new Date(2026, 10, 27, 20, 0)), 'Sunset was at 4:21 PM today. Tomorrow it’s at 4:20 PM.');
});

test('with no tomorrow in the forecast, the reply stops at today', () => {
  assert.equal(sunSay('sunset', TODAY, undefined, new Date(2026, 10, 27, 20, 0)), 'Sunset was at 4:21 PM today.');
});

test('the voice uses the helper for today and keeps the tomorrow wording', () => {
  assert.match(voice, /if \(!day\) return \{ say: sunSay\(which, iso, \(which === 'sunset' \? w\.daily\.sunset : w\.daily\.sunrise\)\?\.\[1\], new Date\(\)\), react: 'look' \};/);
  assert.match(voice, /return \{ say: `\$\{which === 'sunset' \? 'Sunset' : 'Sunrise'\} is at \$\{localHour\(iso, true\)\} \$\{when\}\.`, react: 'look' \};/);
  assert.match(voice, /if \(sun !== null\) return sunCommand\(sun\.which, sun\.day\);/);
});
