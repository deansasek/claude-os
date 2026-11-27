// A calendar answer from the PC is used for reminders only while its read is recent (src/apps/calendar/web/event-notice.ts pcAnswer). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY_MAX_MS, pcAnswer } from '../src/apps/calendar/web/event-notice.ts';

const now = Date.parse('2026-11-27T12:00:00Z');

test('an answer from an old calendar read is not used as current', () => {
  assert.equal(pcAnswer('ok', now - COPY_MAX_MS - 1, now), 'copy');
});

test('a recent answer is used', () => {
  assert.equal(pcAnswer('ok', now - 60e3, now), 'use');
});

test('an answer with no read time is used as before', () => {
  assert.equal(pcAnswer('ok'), 'use');
});
