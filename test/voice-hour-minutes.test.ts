// "1 hour 30" is 90 minutes (src/core/web/voice-parse.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../src/core/web/voice-parse.ts';

test('a bare minute count after the hours is read as minutes: 1 hour 30 is 90 minutes', () => {
  assert.equal(parseDuration('1 hour 30'), 90 * 60e3);
  assert.equal(parseDuration('2 hours 15'), 135 * 60e3);
});

test('"an hour 30" and "1 hour and 30" are 90 minutes too', () => {
  assert.equal(parseDuration('an hour 30'), 90 * 60e3);
  assert.equal(parseDuration('1 hour and 30'), 90 * 60e3);
});

test('a phrase that already says minutes is unchanged', () => {
  assert.equal(parseDuration('1 hour 30 minutes'), 90 * 60e3);
  assert.equal(parseDuration('1 hour'), 60 * 60e3);
});
