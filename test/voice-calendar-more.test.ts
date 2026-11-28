// Today's and tomorrow's calendar replies say how many more events there are past the first three
// (src/core/web/voice-calendar.ts and src/core/web/voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calendarDaySay, listSay } from '../src/core/web/voice-calendar.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a list shows up to three events, then says how many more', () => {
  assert.equal(listSay(['A at 9:00 AM']), 'A at 9:00 AM');
  assert.equal(listSay(['A', 'B']), 'A; and B');
  assert.equal(listSay(['A', 'B', 'C']), 'A; B; and C');
  assert.equal(listSay(['A', 'B', 'C', 'D']), 'A; B; and C, and 1 more');
  assert.equal(listSay(['A', 'B', 'C', 'D', 'E']), 'A; B; and C, and 2 more');
});

test('the Saturday reply keeps its wording', () => {
  assert.equal(calendarDaySay(['A', 'B', 'C', 'D'], 'saturday'), 'Saturday: A; B; and C, and 1 more.');
  assert.equal(calendarDaySay([], 'saturday'), 'Nothing on your calendar saturday.');
});

test('the today, tomorrow and connector replies use the full list, not the first three', () => {
  assert.equal(voice.includes('.slice(0, 3)'), false);
  assert.ok(voice.includes('`${old}Tomorrow: ${listSay(tmr)}.`'));
  assert.ok(voice.includes('`${old}${next.length === 1 ? \'Next up\' : \'Coming up\'}: ${listSay(next)}.`'));
  assert.ok(voice.includes('`${day === \'today\' ? \'Coming up\' : \'Tomorrow\'}: ${listSay(shown)}.`'));
});
