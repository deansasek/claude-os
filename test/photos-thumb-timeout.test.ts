// A thumbnail read or send that the PC never answers ends after THUMB_FETCH_MS, so the backfill slot frees up (src/apps/photos/web/thumb.ts).
// thumb.ts needs the browser to run, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/photos/web/thumb.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the timeout is a positive wait of at most 30 seconds', () => {
  const m = src.match(/export const THUMB_FETCH_MS = ([\d.e]+);/);
  assert.ok(m, 'THUMB_FETCH_MS is exported');
  const ms = Number(m[1]);
  assert.ok(ms > 0 && ms <= 30e3, `THUMB_FETCH_MS is ${ms}`);
});

test('the full-picture read has a timeout', () => {
  assert.match(src, /fetch\(job\.url, \{ signal: AbortSignal\.timeout\(THUMB_FETCH_MS\) \}\)/);
});

test('the thumbnail send has a timeout', () => {
  assert.match(src, /body: thumb,\s*signal: AbortSignal\.timeout\(THUMB_FETCH_MS\),/);
});
