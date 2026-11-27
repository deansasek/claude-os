// Voice parsing for durations, times of day and day lists (src/core/web/voice-parse.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysText, durationAndLabel, morningDays, namedTimerReply, parseDays, parseDuration, parseTime, resolveHour, sayDuration } from '../src/core/web/voice-parse.ts';

test('a duration phrase becomes milliseconds', () => {
  assert.equal(parseDuration('10 minutes'), 600_000);
  assert.equal(parseDuration('a minute and a half'), 90_000);
  assert.equal(parseDuration('1 hour 30 minutes'), 5_400_000);
  assert.equal(parseDuration('nonsense'), null);
  assert.equal(parseDuration('30 hours'), null);   // over 24 hours
});

test('a time of day is read with or without am and pm', () => {
  assert.deepEqual(parseTime('7'), { h: 7, m: 0, meridiem: null });
  assert.deepEqual(parseTime('6 30 am'), { h: 6, m: 30, meridiem: 'am' });
  assert.deepEqual(parseTime('half past 6'), { h: 6, m: 30, meridiem: null });
  assert.deepEqual(parseTime('quarter to 7'), { h: 6, m: 45, meridiem: null });
  // "to 1" is the hour before 1: 12, so "quarter to 1" can be 12:45 pm, or 0:45 with am
  assert.equal(parseTime('quarter to 1')?.h, 12);
  assert.deepEqual(resolveHour(parseTime('quarter to 1 am')!, false), { h: 0, m: 45 });
  assert.deepEqual(resolveHour(parseTime('quarter to 1 pm')!, false), { h: 12, m: 45 });
  assert.deepEqual(parseTime('noon'), { h: 12, m: 0, meridiem: 'pm' });
  assert.equal(parseTime('25'), null);
  assert.equal(parseTime('some time'), null);
});

test('a day list becomes day numbers, and no days means once', () => {
  assert.deepEqual(parseDays(''), []);
  assert.deepEqual(parseDays('tomorrow'), []);
  assert.deepEqual(parseDays('every day'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseDays('on weekdays'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays('on mondays'), [1]);
  assert.deepEqual(parseDays('every monday and friday'), [1, 5]);
  assert.deepEqual(parseDays('every monday and monday'), [1]);
  assert.deepEqual(parseDays('on mondays, fridays and mondays'), [1, 5]);
  assert.equal(parseDays('frobnicate'), null);
});

test('a tomorrow day phrase is a morning alarm', () => {
  assert.equal(morningDays('tomorrow'), true);
  assert.equal(morningDays('tomorrow morning'), true);
  assert.equal(morningDays('for tomorrow'), true);
  assert.equal(morningDays(''), false);
  assert.equal(morningDays('on weekdays'), false);
});

test('a duration is said back in words', () => {
  assert.equal(sayDuration(600_000), '10 minutes');
  assert.equal(sayDuration(90_000), 'a minute and a half');
  assert.equal(sayDuration(5_400_000), '1 hour and 30 minutes');
  assert.equal(sayDuration(1_000), '1 second');
});

test('a spoken time with am or pm, or a 24-hour hour, is exact', () => {
  assert.deepEqual(resolveHour({ h: 6, m: 30, meridiem: 'am' }, false), { h: 6, m: 30 });
  assert.deepEqual(resolveHour({ h: 6, m: 30, meridiem: 'pm' }, false), { h: 18, m: 30 });
  assert.deepEqual(resolveHour({ h: 12, m: 0, meridiem: 'pm' }, false), { h: 12, m: 0 });
  assert.deepEqual(resolveHour({ h: 13, m: 0, meridiem: null }, false), { h: 13, m: 0 });
  assert.deepEqual(resolveHour({ h: 0, m: 0, meridiem: null }, false), { h: 0, m: 0 });
});

test('a wake-up with no am or pm is in the morning', () => {
  assert.deepEqual(resolveHour({ h: 7, m: 0, meridiem: null }, true), { h: 7, m: 0 });
});

test('a day list is said back in words', () => {
  assert.equal(daysText([]), '');
  assert.equal(daysText([1, 2, 3, 4, 5]), ' on weekdays');
  assert.equal(daysText([0, 6]), ' at weekends');
  assert.equal(daysText([0, 1, 2, 3, 4, 5, 6]), ' every day');
  assert.equal(daysText([1]), ' on Mondays');
  assert.equal(daysText([1, 3, 5]), ' on Mondays, Wednesdays and Fridays');
  assert.equal(daysText([5, 1]), ' on Mondays and Fridays');
  assert.equal(daysText([6, 0]), ' at weekends');
  assert.equal(daysText([2, 1, 3, 4, 5]), ' on weekdays');
  assert.equal(daysText([1, 1]), ' on Mondays');
});

test('a named timer reply starts with a capital letter', () => {
  assert.equal(namedTimerReply('pasta', 600_000), 'Pasta timer set for 10 minutes.');
});

test('a duration with a name after it keeps the name', () => {
  assert.deepEqual(durationAndLabel('10 minute pasta'), { ms: 600_000, label: 'pasta' });
  assert.deepEqual(durationAndLabel('1 hour 30 minutes bread'), { ms: 5_400_000, label: 'bread' });
  assert.equal(durationAndLabel('pasta'), null);
  assert.equal(durationAndLabel('10 minutes'), null);   // a duration with no name
});

test('"12 tonight" and "12 at night" are midnight, and "8 tonight" is 8 pm', () => {
  assert.deepEqual(resolveHour(parseTime('12 tonight')!, false), { h: 0, m: 0 });
  assert.deepEqual(resolveHour(parseTime('half past 12 at night')!, false), { h: 0, m: 30 });
  assert.deepEqual(resolveHour(parseTime('8 tonight')!, false), { h: 20, m: 0 });
});
