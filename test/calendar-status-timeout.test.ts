// The Calendar status, calendar and event reads give up on a PC that does not answer, and a late older status read does not undo
// a saved address (src/apps/calendar/web/index.ts). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/calendar/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const loadStatus = slice('async function loadStatus(');
const loadCalendars = slice('async function loadCalendars(');
const soon = slice('async function soonEvents(');

test('the timeout is defined, and the status, calendars and events reads pass it', () => {
  assert.match(src, /const READ_TIMEOUT_MS = 10_000;/);
  assert.match(loadStatus, /getJson<CalStatus>\(`\$\{API\}\/status`, READ_TIMEOUT_MS\)/);
  assert.match(loadCalendars, /`\$\{API\}\/calendars`, READ_TIMEOUT_MS\)/);
  assert.match(soon, /getJson<CalEvents>\(`\$\{API\}\/events`, READ_TIMEOUT_MS\)/);
});

test('a status read drops its answer when a newer read or a saved address came first', () => {
  assert.match(loadStatus, /const seq = \+\+statusSeq;/);
  const guards = loadStatus.match(/if \(seq !== statusSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(loadStatus.indexOf('if (seq !== statusSeq) return;') < loadStatus.indexOf('status = s;'), 'the check comes before the status is set');
});

test('saving an address makes any status read still out stale', () => {
  const save = slice('async function saveAddress(');
  assert.match(save, /if \(r\) \{ statusSeq\+\+;/);
});
