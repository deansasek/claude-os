// "How many days until the dentist" by voice (src/core/web/voice-calendar.ts, wired in src/core/web/voice-commands.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calendarDaysUntil, eventCountdownSay, eventCountdownWord } from '../src/core/web/voice-calendar.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a days or sleeps count to a named event gives the words to find', () => {
  assert.equal(eventCountdownWord('how many days until the dentist'), 'dentist');
  assert.equal(eventCountdownWord('how many sleeps until swimming'), 'swimming');
  assert.equal(eventCountdownWord('how many more days till my holiday'), 'holiday');
  assert.equal(eventCountdownWord('days until sam’s party'), 'sam’s party');
});

test('Christmas, sun, and phrases that are not a count are left to their own answers', () => {
  assert.equal(eventCountdownWord('how many days until christmas'), null);
  assert.equal(eventCountdownWord('how many days until sunset'), null);
  assert.equal(eventCountdownWord('how many days until'), null);
  assert.equal(eventCountdownWord('when is the dentist'), null);
});

test('the count is in calendar days: 0 on the day, 1 for tomorrow, more after', () => {
  const now = new Date(2026, 10, 28, 9, 0);   // Saturday 28 November 2026, 9:00
  assert.equal(calendarDaysUntil(new Date(2026, 10, 28, 15, 0).getTime(), now), 0);
  assert.equal(calendarDaysUntil(new Date(2026, 10, 29, 0, 5).getTime(), now), 1);
  assert.equal(calendarDaysUntil(new Date(2026, 11, 3, 9, 30).getTime(), now), 5);
});

test('the answer says the count with the title, and the sleeps wording for sleeps', () => {
  assert.equal(eventCountdownSay('Dentist', 0, false), 'Dentist is today.');
  assert.equal(eventCountdownSay('Dentist', 1, false), 'Dentist is tomorrow.');
  assert.equal(eventCountdownSay('Dentist', 5, false), '5 days until Dentist.');
  assert.equal(eventCountdownSay('Swimming', 1, true), 'One more sleep until Swimming.');
  assert.equal(eventCountdownSay('Swimming', 4, true), '4 sleeps until Swimming.');
});

test('the voice command counts from the calendar read, and falls through when no event matches', () => {
  assert.ok(voice.includes('async function eventCountdownCommand(want: string, sleeps: boolean)'));
  assert.ok(voice.includes('if (!hit) return null;   // no such event: the phrase goes on'));
  assert.ok(voice.includes('eventCountdownSay(hit.title, calendarDaysUntil(hit.start, new Date()), sleeps)'));
  assert.ok(voice.includes("const countWant = eventCountdownWord(t);"));
});
