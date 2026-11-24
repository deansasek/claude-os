// Home's weather read (src/apps/home/web/weather-read.ts): a route error is a failed read, and keeps the last good forecast.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weatherAfterRead } from '../src/apps/home/web/weather-read.ts';

const ok: { status: string; place?: string } = { status: 'ok', place: 'Home' };

test('a route error (status error) is a failed read, not a forecast', () => {
  const r = weatherAfterRead<{ status: string }>(null, { status: 'error' });
  assert.equal(r.failed, true);
  assert.equal(r.wx, null);   // no forecast yet: the tile shows Offline
});

test('a route error keeps the last good forecast on the tile', () => {
  const r = weatherAfterRead(ok, { status: 'error' });
  assert.equal(r.failed, true);
  assert.equal(r.wx, ok);
});

test('a good read replaces the forecast and clears the failure', () => {
  const next = { status: 'ok', place: 'Office' };
  const r = weatherAfterRead(ok, next);
  assert.equal(r.failed, false);
  assert.equal(r.wx, next);
});

test('a no-location answer is a read, not a failure', () => {
  const r = weatherAfterRead(null, { status: 'no_location' });
  assert.equal(r.failed, false);
  assert.deepEqual(r.wx, { status: 'no_location' });
});
