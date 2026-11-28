// What's for dinner this week by voice (src/core/web/voice-dinner.ts; the calendar read is in voice-commands.ts, read as source).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dinnerWeekSay, dinnerWeekWord } from '../src/core/web/voice-dinner.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the week’s dinner questions are matched, and a single night’s question is not', () => {
  assert.equal(dinnerWeekWord("what's for dinner this week"), true);
  assert.equal(dinnerWeekWord('what are we having for dinner this week'), true);
  assert.equal(dinnerWeekWord("what's for dinner tonight"), false);
  assert.equal(dinnerWeekWord("what's for dinner on friday"), false);
});

test('a list that starts with a weekday keeps its capital, and Tomorrow is lower case as Tonight is', () => {
  assert.equal(dinnerWeekSay([{ name: 'Friday', text: 'pizza' }]), 'This week, Friday: pizza.');
  assert.equal(dinnerWeekSay([{ name: 'Friday', text: 'pizza' }, { name: 'Saturday', text: 'curry' }]), 'This week, Friday: pizza; and Saturday: curry.');
  assert.equal(dinnerWeekSay([{ name: 'Tomorrow', text: 'soup' }, { name: 'Friday', text: 'pizza' }]), 'This week, tomorrow: soup; and Friday: pizza.');
});

test('the reply lists each planned night, and says so when nothing is planned', () => {
  assert.equal(dinnerWeekSay([]), 'Nothing is planned for dinner this week.');
  assert.equal(dinnerWeekSay([{ name: 'Tonight', text: 'lasagne' }]), 'This week, tonight: lasagne.');
  assert.equal(
    dinnerWeekSay([{ name: 'Tonight', text: 'lasagne' }, { name: 'Wednesday', text: 'tacos' }, { name: 'Friday', text: 'pizza' }]),
    'This week, tonight: lasagne; Wednesday: tacos; and Friday: pizza.',
  );
});

test('the week question reads the local calendar for the seven nights, and is routed before the single-night question', () => {
  assert.ok(voice.includes('if (dinnerWeekWord(t)) return dinnerWeekCommand();'));
  assert.ok(voice.includes('/api/calendar/local?from=${from}&to=${to}'));
  assert.ok(voice.indexOf('dinnerWeekWord(t)') > voice.indexOf('const dinner = dinnerWord(t)'));
});
