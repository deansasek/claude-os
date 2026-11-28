// "Is it windy" by voice (src/core/web/voice-weather.ts windDay, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { windDay } from '../src/core/web/voice-weather.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a wind question is heard for today or tomorrow', () => {
  assert.equal(windDay('is it windy'), 0);
  assert.equal(windDay('how windy is it outside'), 0);
  assert.equal(windDay('is it going to be windy today'), 0);
  assert.equal(windDay('is it windy tomorrow'), 1);
  assert.equal(windDay('how windy will it be tomorrow'), 1);
});

test('other weather phrases are not wind questions', () => {
  assert.equal(windDay('is it hot outside'), null);
  assert.equal(windDay('will it rain tomorrow'), null);
  assert.equal(windDay('is the wind on the list'), null);
});

test('the reply uses the Weather app’s own windy threshold and forecast fields', () => {
  assert.match(voice, /import \{ isWindy \} from '\.\.\/\.\.\/apps\/weather\/web\/art\.ts';/);
  assert.match(voice, /if \(isWindy\(speed, units\)\) return \{ say: `Yes, it’s windy \$\{when\}: \$\{s\} \$\{unit\}\.`, react: 'look' \};/);
  assert.match(voice, /const speed = day \? w\.daily\.wind_speed_10m_max\?\.\[1\] : w\.current\?\.wind_speed_10m;/);
  assert.match(voice, /if \(windy !== null\) return windCommand\(windy\);/);
});
