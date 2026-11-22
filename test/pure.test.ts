// Unit tests for the pure helpers the hub relies on. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHHMM, minutesWords } from '../src/apps/claude/server/tablet.ts';
import { checkOpen } from '../src/apps/claude/server/browser.ts';
import { cleanStep, cleanText } from '../src/apps/routines/api.ts';
import { parseIcs, occurrences } from '../src/apps/calendar/server/ics.ts';

test('parseHHMM reads 24-hour times and rejects the rest', () => {
  assert.deepEqual(parseHHMM('17:05'), { h: 17, m: 5 });
  assert.deepEqual(parseHHMM('7:05'), { h: 7, m: 5 });
  assert.deepEqual(parseHHMM(' 00:00 '), { h: 0, m: 0 });
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(parseHHMM('12:60'), null);
  assert.equal(parseHHMM('noon'), null);
  assert.equal(parseHHMM(1705), null);
});

test('minutesWords says a duration in words', () => {
  assert.equal(minutesWords(1), '1 minute');
  assert.equal(minutesWords(10), '10 minutes');
  assert.equal(minutesWords(90), '1 hour and 30 minutes');
  assert.equal(minutesWords(120), '2 hours');
  assert.equal(minutesWords(1.5), '1 minute and 30 seconds');
  assert.equal(minutesWords(0.5), '30 seconds');
});

test('checkOpen accepts plain http and https addresses and words', () => {
  assert.ok('text' in checkOpen('https://example.com'));
  assert.ok('text' in checkOpen('example.com'));
  assert.ok('text' in checkOpen('weather in london'));
});

test('checkOpen refuses empty input, other schemes, credentials and control characters', () => {
  assert.ok('error' in checkOpen(''));
  assert.ok('error' in checkOpen(42));
  assert.ok('error' in checkOpen('javascript:alert(1)'));
  assert.ok('error' in checkOpen('https://user:pw@example.com'));
  assert.ok('error' in checkOpen('a\u0000b'));
  assert.ok('error' in checkOpen('a‮b'));   // right-to-left override
});

test('cleanText collapses whitespace and strips control characters', () => {
  assert.equal(cleanText('  hello \n   there  '), 'hello there');
  assert.equal(cleanText(12), '');
});

test('cleanStep accepts the simple steps and rejects bad ones', () => {
  assert.deepEqual(cleanStep({ kind: 'weather' }), { kind: 'weather' });
  assert.deepEqual(cleanStep({ kind: 'say', text: '  hi  \n there ' }), { kind: 'say', text: 'hi there' });
  assert.ok('error' in cleanStep({ kind: 'say', text: '   ' }));
  assert.ok('error' in cleanStep({ kind: 'scene', entity_id: '../etc' }));
  assert.ok('error' in cleanStep(null));
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:one',
  'SUMMARY:Dentist',
  'DTSTART:20260101T100000Z',
  'DTEND:20260101T110000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseIcs reads a single event', () => {
  const events = parseIcs(ICS);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Dentist');
});

test('occurrences lists an event inside the window and skips it outside', () => {
  const events = parseIcs(ICS);
  const day = Date.UTC(2026, 0, 1);
  // times are in ms; the event runs 10:00 to 11:00 UTC, so a window of 00:00 to 12:00 covers it
  const inside = occurrences(events, day, day + 12 * 3600e3);
  assert.equal(inside.length, 1);
  assert.equal(inside[0].title, 'Dentist');
  assert.equal(occurrences(events, day + 5 * 86400e3, day + 6 * 86400e3).length, 0);
});
