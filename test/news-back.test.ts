// Back closes an open News story before it goes Home (src/apps/news/web/screen.ts readerBack). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readerBack } from '../src/apps/news/web/screen.ts';

test('an open story on a visible News closes on Back', () => {
  assert.equal(readerBack(true, true), true);
});

test('no open story leaves Back to go on to Home', () => {
  assert.equal(readerBack(true, false), false);
});

test('a News that is not on screen does not take Back', () => {
  assert.equal(readerBack(false, true), false);
});
