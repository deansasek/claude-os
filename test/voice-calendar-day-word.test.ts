// "When is the dentist" says "today" or "tomorrow" for an event in the next two days (src/core/web/voice-calendar.ts,
// wired in src/core/web/voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dayWordFor } from '../src/core/web/voice-calendar.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// local times, so the day boundaries are the same on any machine
const now = new Date(2026, 10, 28, 9, 0);   // Saturday 28 November 2026, 9:00

test('an event on today’s date is "today"', () => {
  assert.equal(dayWordFor(new Date(2026, 10, 28, 15, 0).getTime(), now), 'today');
  assert.equal(dayWordFor(new Date(2026, 10, 28, 0, 0).getTime(), now), 'today');
});

test('an event on tomorrow’s date is "tomorrow", including just after midnight', () => {
  assert.equal(dayWordFor(new Date(2026, 10, 29, 15, 0).getTime(), now), 'tomorrow');
  assert.equal(dayWordFor(new Date(2026, 10, 29, 0, 5).getTime(), now), 'tomorrow');
});

test('any later day, or a day already past, is left to the weekday and date', () => {
  assert.equal(dayWordFor(new Date(2026, 10, 30, 15, 0).getTime(), now), null);
  assert.equal(dayWordFor(new Date(2026, 10, 27, 15, 0).getTime(), now), null);
});

test('the when reply uses the day word, and keeps the weekday and date for later days', () => {
  assert.ok(voice.includes('const word = dayWordFor(hit.start, new Date(Date.now()));'));
  assert.ok(voice.includes("const day = word ?? `on ${new Date(hit.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`;"));
  assert.ok(voice.includes('const when = hit.allDay ? day : `${day} at ${timeText(new Date(hit.start))}`;'));
});
