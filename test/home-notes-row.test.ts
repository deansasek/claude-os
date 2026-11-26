// The words on Home's Notifications row (src/apps/home/web/notes-row.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notesRow } from '../src/apps/home/web/notes-row.ts';

const ago = (): string => '11 hr';

test('no notifications reads "All caught up"', () => {
  assert.deepEqual(notesRow([], ago), { val: 'All caught up', sub: '' });
});

test('a title that starts with the app name does not repeat it', () => {
  assert.deepEqual(notesRow([{ title: 'Claude finished', app: 'claude', at: 0 }], ago), { val: 'Claude finished', sub: '11 hr' });
});

test('a title without the app name keeps it, and the time stays on one line', () => {
  assert.deepEqual(notesRow([{ title: 'Timer done', app: 'clock', at: 0 }], ago), { val: 'Timer done', sub: 'Clock · 11 hr' });
});

test('a browser notice names the Browser app', () => {
  assert.deepEqual(notesRow([{ title: 'Download finished', app: 'browser', at: 0 }], ago), { val: 'Download finished', sub: 'Browser · 11 hr' });
});

test('a calendar notice names the Calendar app', () => {
  assert.deepEqual(notesRow([{ title: 'Meeting soon', app: 'calendar', at: 0 }], ago), { val: 'Meeting soon', sub: 'Calendar · 11 hr' });
});

test('an unknown app or none shows only the time', () => {
  assert.deepEqual(notesRow([{ title: 'Hello', app: 'zzz', at: 0 }], ago), { val: 'Hello', sub: '11 hr' });
  assert.deepEqual(notesRow([{ title: 'Hello', at: 0 }], ago), { val: 'Hello', sub: '11 hr' });
});

test('several notifications show the count and the newest title', () => {
  const r = notesRow([{ title: 'Claude finished', app: 'claude', at: 2 }, { title: 'Timer done', app: 'clock', at: 1 }], ago);
  assert.deepEqual(r, { val: '2 new', sub: 'Claude finished' });
});
