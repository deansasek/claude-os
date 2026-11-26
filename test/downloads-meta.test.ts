// The running-download meta: an unknown total shows text only, with no bar. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runningMeta } from '../src/apps/browser/web/downloads.ts';

test('an unknown total gives no pct and the so far text', () => {
  assert.deepEqual(runningMeta(2048, 0), { pct: null, text: '2 KB so far' });
  assert.deepEqual(runningMeta(2048, -1), { pct: null, text: '2 KB so far' });
});

test('a known total gives the rounded pct, capped at 100', () => {
  assert.deepEqual(runningMeta(512 * 1024, 1024 * 1024), { pct: 50, text: '512 KB of 1.0 MB' });
  assert.equal(runningMeta(2000, 1000).pct, 100);
});

test('zero bytes with an unknown total gives Starting', () => {
  assert.deepEqual(runningMeta(0, 0), { pct: null, text: 'Starting' });
});
