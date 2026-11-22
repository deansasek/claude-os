// Pure helpers: launcher layouts, calendar times, and the one-line tool descriptions. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLayout, isKey } from '../src/apps/launcher/api.ts';
import { eventTime, upcoming } from '../src/apps/calendar/api.ts';
import type { CalEvent } from '../src/apps/calendar/api.ts';
import { askFor, describeTool } from '../src/apps/claude/server/describe.ts';

test('a launcher key is an own app ("c:") or an Android package ("a:"), and nothing else', () => {
  assert.equal(isKey('c:notes'), true);
  assert.equal(isKey('a:com.example.app'), true);
  assert.equal(isKey('c:Bad Id'), false);
  assert.equal(isKey('x:notes'), false);
  assert.equal(isKey(42), false);
});

test('a layout keeps each key once, the first place wins, and drops apps that do not exist', () => {
  const out = cleanLayout(
    { order: ['c:notes', 'c:notes', 'a:com.example.app', 'c:ghost'], hidden: ['c:notes', 'c:ghost'] },
    { own: new Set(['notes']) },
  );
  assert.ok(out);
  assert.deepEqual(out?.order, ['c:notes', 'a:com.example.app']);
  assert.ok(!out?.hidden.includes('c:ghost'));
});

test('a layout that is not an object is refused, and a strict layout with a bad key is refused too', () => {
  assert.equal(cleanLayout(null), null);
  assert.equal(cleanLayout([]), null);
  assert.equal(cleanLayout({ order: ['c:Bad Id'] }, { strict: true }), null);
});

test('an all-day event has no clock time; a timed event shows one', () => {
  const timed: CalEvent = { title: 'Dentist', start: '2026-11-22T10:00:00.000Z', end: '2026-11-22T11:00:00.000Z', allDay: false, day: 'today' };
  const allDay: CalEvent = { ...timed, allDay: true };
  assert.equal(eventTime(allDay), '');
  assert.notEqual(eventTime(timed), '');
});

test('events that have ended are not upcoming; one under way still is', () => {
  const ended: CalEvent = { title: 'Lunch', start: '2026-11-22T10:00:00.000Z', end: '2026-11-22T11:00:00.000Z', allDay: false, day: 'today' };
  const under: CalEvent = { ...ended, title: 'Meeting', end: '2026-11-22T14:00:00.000Z' };
  const now = Date.parse('2026-11-22T12:00:00.000Z');
  assert.deepEqual(upcoming([ended, under], now).map(e => e.title), ['Meeting']);
});

test('a tool call is described in one line, with its key argument as the detail', () => {
  const bash = describeTool('Bash', { command: 'ls -la' });
  assert.equal(bash.detail, 'ls -la');
  const read = describeTool('Read', { file_path: '/home/u/notes/todo.txt' });
  assert.ok(read.summary.includes('todo.txt'), read.summary);
});

test('an approval card asks in the present tense and names the file', () => {
  const write = askFor('Write', { file_path: '/work/plan/draft.md' });
  assert.ok(write.summary.includes('draft.md'), write.summary);
});
