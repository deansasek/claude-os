// The merged calendar range (src/apps/calendar/server/range-merge.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeRange } from '../src/apps/calendar/server/range-merge.ts';

const local = { title: 'Dentist', start: 2000, end: 3000, allDay: false, calendar: 'claudeos' };
const conn = { title: 'Standup', start: 1000, end: 1500, allDay: false };

test('with no ICS address and local events, the connector events stay in the merged range', () => {
  const r = mergeRange({ status: 'not_set', events: [] }, [local], { status: 'ok', events: [conn] });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.events.map(e => [e.title, e.calendar]), [['Standup', 'connector'], ['Dentist', 'claudeos']]);
});

test('with an ICS address, the ICS events and the local events are both kept, each with its calendar id', () => {
  const ics = { title: 'Team', start: 500, end: 600, allDay: false, calendar: 'ics' };
  const r = mergeRange({ status: 'ok', events: [ics] }, [local], null);
  assert.deepEqual(r.events.map(e => [e.title, e.calendar]), [['Team', 'ics'], ['Dentist', 'claudeos']]);
});

test('with no address and a connector error, the local events are still shown, with the error', () => {
  const r = mergeRange({ status: 'not_set', events: [] }, [local], { status: 'error', error: 'connector down' });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.events.map(e => e.title), ['Dentist']);
  assert.equal(r.error, 'connector down');
  assert.equal(r.stale, true);
});

test('with no address, no local events and a range the connector does not read, the answer is not set', () => {
  const r = mergeRange({ status: 'not_set', events: [] }, [], null);
  assert.equal(r.status, 'not_set');
  assert.deepEqual(r.events, []);
});
