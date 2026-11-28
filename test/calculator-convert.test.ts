// The Calculator's kitchen converter (src/apps/calculator/web/convert.ts), and its panel in the app (index.ts). Pure logic is
// tested directly; the app is DOM code, so its wiring is read from the source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { convert, roundResult } from '../src/apps/calculator/web/convert.ts';

const close = (a: number | null, b: number, eps = 0.01): void => {
  assert.ok(a !== null && Math.abs(a - b) < eps, `expected about ${b}, got ${a}`);
};

test('volume converts through millilitres', () => {
  close(convert(1, 'cup', 'ml'), 236.588);
  close(convert(1, 'tbsp', 'tsp'), 3);
  close(convert(2, 'floz', 'tbsp'), 4);
  close(convert(500, 'ml', 'floz'), 16.9);
});

test('temperature converts between Fahrenheit and Celsius', () => {
  assert.equal(convert(212, 'F', 'C'), 100);
  assert.equal(convert(100, 'C', 'F'), 212);
  close(convert(350, 'F', 'C'), 176.67);
});

test('volume and temperature cannot be turned into each other, and a non-number gives nothing', () => {
  assert.equal(convert(1, 'cup', 'F'), null);
  assert.equal(convert(1, 'C', 'ml'), null);
  assert.equal(convert(NaN, 'cup', 'ml'), null);
});

test('a result shows at most two decimal places', () => {
  assert.equal(roundResult(1.5), '1.5');
  assert.equal(roundResult(2), '2');
  assert.equal(roundResult(1 / 3), '0.33');
});

test('the converter panel is wired to the readout’s number and the units', () => {
  const src = readFileSync(new URL('../src/apps/calculator/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(new URL('../src/apps/calculator/view.html', import.meta.url), 'utf8');
  assert.match(html, /id="calcConv"/);
  assert.match(html, /id="calcOut"/);
  assert.match(src, /const v = readoutValue\(\);/);
  assert.match(src, /convert\(v, from, to\)/);
  assert.match(src, /data-\$\{which\}="\$\{u\.id\}"/);
});
