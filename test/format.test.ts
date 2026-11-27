// fmt (core/web/format.ts): the short number labels, including the rounding up to the next unit. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

// format.ts reads the page's location when it loads (via dom.ts); node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { fmt, prettyModel } = await import('../src/core/web/format.ts');

test('plain numbers round to a whole number', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(42.4), '42');
  assert.equal(fmt(999), '999');
});

test('thousands, millions and billions: one decimal below 100 of the unit, none above', () => {
  assert.equal(fmt(1500), '1.5K');
  assert.equal(fmt(100_000), '100K');
  assert.equal(fmt(1_000_000), '1.0M');
  assert.equal(fmt(120_000_000), '120M');
  assert.equal(fmt(3_000_000_000), '3.0B');
  assert.equal(fmt(12_000_000_000), '12B');
});

test('rounding up to the next unit shows that unit, not 1000K or 1000M', () => {
  assert.equal(fmt(999_999), '1.0M');
  assert.equal(fmt(999_500), '1.0M');
  assert.equal(fmt(999_960_000), '1.0B');
  assert.equal(fmt(999.5), '1.0K');
  assert.equal(fmt(999.4), '999');
});

test('prettyModel shows a model id as a clean name, with or without a release date', () => {
  assert.equal(prettyModel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(prettyModel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(prettyModel('claude-opus-4-1-20250805'), 'Opus 4.1');
  assert.equal(prettyModel('claude-opus-5'), 'Opus 5');
  assert.equal(prettyModel(''), '');
});
