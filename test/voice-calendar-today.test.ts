// Today's calendar phrases (src/core/web/voice-commands.ts). The command handler needs the browser, so it is read as source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('"what do I have today", "do I have anything today" and "my schedule today" are accepted, with or without "on"', () => {
  assert.ok(voice.includes('what do i have (?:on )?today|do i have anything (?:on )?today|have i got (?:anything )?on today|what have i got on today|what(?:\'s|s| is) on my schedule today'));
});

test('the today phrases still call the calendar read, and the tomorrow phrases are unchanged', () => {
  assert.ok(voice.includes('return calendarCommand();'));
  assert.ok(voice.includes('what do i have (?:on )?tomorrow'));
});

test('the British have-I-got and what-have-I-got phrasings for today and tomorrow are in the calendar read', () => {
  assert.ok(voice.includes('have i got (?:anything )?on today|what have i got on today'));
  assert.ok(voice.includes('have i got (?:anything )?on tomorrow|what have i got on tomorrow'));
});
