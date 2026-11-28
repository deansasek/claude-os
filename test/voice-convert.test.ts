// Kitchen and temperature conversions by voice (src/core/web/voice-convert.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { convertSay } from '../src/core/web/voice-convert.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('"what\'s N unit in unit" is converted with the Calculator’s maths', () => {
  assert.equal(convertSay("what's 180 celsius in fahrenheit"), '180 degrees Celsius is 356 degrees Fahrenheit.');
  assert.equal(convertSay('what is 350 fahrenheit in celsius'), '350 degrees Fahrenheit is 176.67 degrees Celsius.');
  assert.equal(convertSay("what's 2 cups in millilitres"), '2 cups is 473.18 millilitres.');
});

test('"how many unit in a unit" gives the wanted unit first', () => {
  assert.equal(convertSay('how many tablespoons in a cup'), '16 tablespoons in a cup.');
  assert.equal(convertSay('how many teaspoons in a tablespoon'), '3 teaspoons in a tablespoon.');
});

test('"convert N unit to unit" is converted too', () => {
  assert.equal(convertSay('convert 1 cup to millilitres'), '1 cup is 236.59 millilitres.');
});

test('a unit pair that cannot convert, a sum, and other phrases are not conversions', () => {
  assert.equal(convertSay("what's 5 cups in celsius"), null);
  assert.equal(convertSay("what's 12 times 7"), null);
  assert.equal(convertSay("what's the time in london"), null);
  assert.equal(convertSay('how many hours in a day'), null);
});

test('the conversion is tried before the sum check, so "in" is not read as a sum', () => {
  assert.ok(voice.includes('convertSay(raw) ?? convertSay(t)'));
  assert.ok(voice.indexOf('convertSay(raw)') < voice.indexOf('mathSay(raw)'));
});
