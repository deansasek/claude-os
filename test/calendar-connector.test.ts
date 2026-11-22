// Reading a connector answer into calendar events (src/apps/calendar/server/connector-parse.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConnectorEvents } from '../src/apps/calendar/server/connector-parse.ts';

test('an answer in a code fence is read', () => {
  const text = 'Here you go:\n```json\n[{"title":"Dentist","start":"2026-11-23T09:00:00-05:00","end":"2026-11-23T09:30:00-05:00","allDay":false}]\n```';
  const ev = parseConnectorEvents(text);
  assert.equal(ev?.length, 1);
  assert.equal(ev?.[0].title, 'Dentist');
  assert.equal(ev?.[0].allDay, false);
});

test('a bare array is read, and a valid empty list is an empty list', () => {
  assert.equal(parseConnectorEvents('[]')?.length, 0);
  assert.equal(parseConnectorEvents('[{"title":"Bins","start":"2026-11-23T00:00:00-05:00","end":"2026-11-24T00:00:00-05:00","allDay":true}]')?.[0].allDay, true);
});

test('an answer with no list is not an event list at all', () => {
  assert.equal(parseConnectorEvents('Sorry, the connector is unavailable.'), null);
  assert.equal(parseConnectorEvents('[not json'), null);
  assert.equal(parseConnectorEvents('{"title":"x"}'), null);
});

test('an item with no title, a bad time, or an end before its start is dropped', () => {
  const text = JSON.stringify([
    { title: '', start: '2026-11-23T09:00:00-05:00', end: '2026-11-23T09:30:00-05:00' },
    { title: 'Bad', start: 'soon', end: 'later' },
    { title: 'Backwards', start: '2026-11-23T10:00:00-05:00', end: '2026-11-23T09:00:00-05:00' },
    { title: 'Kept', start: '2026-11-23T11:00:00-05:00', end: '2026-11-23T11:30:00-05:00' },
  ]);
  assert.deepEqual(parseConnectorEvents(text)?.map(e => e.title), ['Kept']);
});

test('events come out in start order, with a title kept to 120 characters', () => {
  const text = JSON.stringify([
    { title: 'Late', start: '2026-11-23T15:00:00-05:00', end: '2026-11-23T16:00:00-05:00' },
    { title: 'x'.repeat(200), start: '2026-11-23T08:00:00-05:00', end: '2026-11-23T08:10:00-05:00' },
  ]);
  const ev = parseConnectorEvents(text) ?? [];
  assert.equal(ev[0].title.length, 120);
  assert.equal(ev[1].title, 'Late');
});
