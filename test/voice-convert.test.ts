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

test('weight converts to weight: grams, kilos, ounces and pounds', () => {
  assert.equal(convertSay("what's 8 ounces in grams"), '8 ounces is 226.8 grams.');
  assert.equal(convertSay('how many grams in a pound'), '453.59 grams in a pound.');
  assert.equal(convertSay("what's 2 kilos in pounds"), '2 kilograms is 4.41 pounds.');
});

test('a unit joined to its number is worked out: 200g, 8oz, 500ml and 2lb', () => {
  assert.equal(convertSay("what's 200g in ounces"), '200 grams is 7.05 ounces.');
  assert.equal(convertSay('convert 500ml to cups'), '500 millilitres is 2.11 cups.');
  assert.equal(convertSay("what's 8oz in grams"), '8 ounces is 226.8 grams.');
  assert.equal(convertSay('how many grams in 2lb'), '907.18 grams in 2 pounds.');
});

test('a fraction amount is worked out: 1/2 cup, 3/4 cup and 1/4 cup', () => {
  assert.equal(convertSay("what's 1/2 cup in tablespoons"), '0.5 cups is 8 tablespoons.');
  assert.equal(convertSay('convert 3/4 cup to millilitres'), '0.75 cups is 177.44 millilitres.');
  assert.equal(convertSay('how many teaspoons in 1/4 cup'), '12 teaspoons in 0.25 cups.');
  assert.equal(convertSay("what's 1/0 cup in millilitres"), null);
});

test('weight does not convert to a volume, and fluid ounces are still a volume', () => {
  assert.equal(convertSay('how many cups in grams'), null);
  assert.equal(convertSay('how many ounces in a cup'), null);
  assert.equal(convertSay("what's 2 fl oz in ml"), '2 fluid ounces is 59.15 millilitres.');
});

test('a temperature said with a degree sign is worked out', () => {
  assert.equal(convertSay("what's 180°c in °f"), '180 degrees Celsius is 356 degrees Fahrenheit.');
  assert.equal(convertSay("what's 350 °F in °C"), '350 degrees Fahrenheit is 176.67 degrees Celsius.');
});

test('a below-zero temperature keeps its minus sign, said as a minus or a negative, or with the sign', () => {
  assert.equal(convertSay("what's -10 celsius in fahrenheit"), '-10 degrees Celsius is 14 degrees Fahrenheit.');
  assert.equal(convertSay("what's minus 40 celsius in fahrenheit"), '-40 degrees Celsius is -40 degrees Fahrenheit.');
  assert.equal(convertSay('what is negative 5 celsius in fahrenheit'), '-5 degrees Celsius is 23 degrees Fahrenheit.');
  assert.equal(convertSay("what's −10 celsius in fahrenheit"), '-10 degrees Celsius is 14 degrees Fahrenheit.');
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
