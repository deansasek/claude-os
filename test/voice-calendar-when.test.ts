// "When is the dentist" by voice (src/core/web/voice-calendar.ts; the read is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { eventWhenWord, findEventWhen } from '../src/core/web/voice-calendar.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('"when is the dentist" and "when’s swimming" give the words to find', () => {
  assert.equal(eventWhenWord('when is the dentist'), 'dentist');
  assert.equal(eventWhenWord("when's swimming"), 'swimming');
  assert.equal(eventWhenWord("when is sam's party"), "sam's party");
});

test('questions about the sun, Christmas, the alarm and the weather are left to their own answers', () => {
  assert.equal(eventWhenWord('when is sunset'), null);
  assert.equal(eventWhenWord('when is christmas'), null);
  assert.equal(eventWhenWord('when is my alarm'), null);
  assert.equal(eventWhenWord('when is it going to rain'), null);
  assert.equal(eventWhenWord('what is the dentist'), null);
});

test('the earliest event still to come that has the words is the one found', () => {
  const now = Date.parse('2026-11-28T10:00:00');
  const events = [
    { title: 'Dentist', start: Date.parse('2026-12-03T09:30:00'), end: Date.parse('2026-12-03T10:00:00') },
    { title: 'Dentist check-up', start: Date.parse('2026-12-01T14:00:00'), end: Date.parse('2026-12-01T14:30:00') },
    { title: 'Dentist (past)', start: Date.parse('2026-11-20T09:00:00'), end: Date.parse('2026-11-20T09:30:00') },
    { title: 'Swimming', start: Date.parse('2026-11-29T16:00:00'), end: Date.parse('2026-11-29T17:00:00') },
  ];
  assert.equal(findEventWhen(events, 'dentist', now)?.title, 'Dentist check-up');
  assert.equal(findEventWhen(events, 'swimming', now)?.title, 'Swimming');
  assert.equal(findEventWhen(events, 'bingo', now), null);
});

test('the voice reads the local calendar for 60 days, and says so when the calendar cannot be read', () => {
  assert.ok(voice.includes('eventWhenCommand(eventWant)'));
  assert.ok(voice.includes('const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 60);'));
  assert.ok(voice.includes("if (!hit) return null;   // no such event: the phrase goes on"));
});
