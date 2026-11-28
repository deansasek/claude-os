// "What time is sunset" by voice (src/core/web/voice-weather.ts sunDay, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sunDay } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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

test('the reply reads the forecast’s sunrise or sunset time in the Weather app’s words', () => {
  assert.match(voice, /const iso = \(which === 'sunset' \? w\.daily\.sunset : w\.daily\.sunrise\)\?\.\[day\];/);
  assert.match(voice, /return \{ say: `\$\{which === 'sunset' \? 'Sunset' : 'Sunrise'\} is at \$\{localHour\(iso, true\)\} \$\{when\}\.`, react: 'look' \};/);
  assert.match(voice, /if \(sun !== null\) return sunCommand\(sun\.which, sun\.day\);/);
});
