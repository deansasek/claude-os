// What's next on the calendar by voice (src/core/web/voice-calendar.ts; the wiring is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nextEventWord } from '../src/core/web/voice-calendar.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('"what\'s next" and "when\'s my next appointment" are accepted, with or without "on my calendar"', () => {
  assert.equal(nextEventWord("what's next"), true);
  assert.equal(nextEventWord("what's next on my calendar"), true);
  assert.equal(nextEventWord("what's next today"), true);
  assert.equal(nextEventWord("when's my next appointment"), true);
  assert.equal(nextEventWord("what's my next event"), true);
  assert.equal(nextEventWord('what have i got next'), true);
});

test('other calendar questions are not the next-event question', () => {
  assert.equal(nextEventWord("what's on today"), false);
  assert.equal(nextEventWord("what's next for dinner"), false);
  assert.equal(nextEventWord("what's on tomorrow"), false);
});

test('the next-event question reads today’s calendar', () => {
  assert.ok(voice.includes('if (nextEventWord(t)) return calendarCommand();'));
});
