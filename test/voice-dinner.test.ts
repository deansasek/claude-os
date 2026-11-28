// Voice "what's for dinner tonight" and "what's for dinner on Friday" (src/core/web/voice-dinner.ts, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dinnerSay, dinnerWord } from '../src/core/web/voice-dinner.ts';

// Thursday (4) is "today" for these tests
const THU = 4;

test('a dinner question is heard for tonight or tomorrow, and a plain one means tonight', () => {
  assert.deepEqual(dinnerWord("what's for dinner", THU), { ahead: 0, name: 'tonight', lead: 'Tonight' });
  assert.deepEqual(dinnerWord("what's for dinner tonight", THU), { ahead: 0, name: 'tonight', lead: 'Tonight' });
  assert.deepEqual(dinnerWord("what's for dinner tomorrow", THU), { ahead: 1, name: 'tomorrow', lead: 'Tomorrow' });
  assert.deepEqual(dinnerWord('what are we having for dinner', THU), { ahead: 0, name: 'tonight', lead: 'Tonight' });
});

test('a weekday is the next one, today included', () => {
  assert.deepEqual(dinnerWord("what's for dinner on friday", THU), { ahead: 1, name: 'on Friday', lead: 'On Friday' });
  assert.deepEqual(dinnerWord("what's for dinner on thursday", THU), { ahead: 0, name: 'on Thursday', lead: 'On Thursday' });
  assert.equal(dinnerWord("what's for dinner on monday", THU)?.ahead, 4);   // Monday is four days after Thursday
  assert.deepEqual(dinnerWord("what are we having for dinner friday", THU)?.ahead, 1);
});

test('other phrases are not dinner questions', () => {
  assert.equal(dinnerWord('what is for lunch', THU), null);
  assert.equal(dinnerWord('what is on for dinner party', THU), null);
  assert.equal(dinnerWord("what's for dinner on funday", THU), null);
});

test('the reply names the planned dinner, or says none is planned', () => {
  const tonight = { ahead: 0, name: 'tonight', lead: 'Tonight' };
  const tomorrow = { ahead: 1, name: 'tomorrow', lead: 'Tomorrow' };
  const friday = { ahead: 1, name: 'on Friday', lead: 'On Friday' };
  assert.equal(dinnerSay('Tacos', tonight), 'Tonight it’s tacos.');
  assert.equal(dinnerSay('Fish pie', tomorrow), 'Tomorrow it’s fish pie.');
  assert.equal(dinnerSay('Tacos', friday), 'On Friday it’s tacos.');
  assert.equal(dinnerSay('BBQ ribs', tonight), 'Tonight it’s BBQ ribs.');
  assert.equal(dinnerSay('KFC', tomorrow), 'Tomorrow it’s KFC.');
  assert.equal(dinnerSay(null, tonight), 'Nothing planned for dinner tonight.');
  assert.equal(dinnerSay(null, friday), 'Nothing planned for dinner on Friday.');
});

test('the voice reads the calendar for that night and picks its dinner, with a reply when the calendar cannot be read', () => {
  const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const dinner = dinnerWord\(t\);/);
  assert.match(src, /return dinnerCommand\(dinner\);/);
  assert.match(src, /getJson\(`\/api\/calendar\/local\?from=\$\{from\}&to=\$\{to\}`, READ_TIMEOUT_MS\)/);
  assert.match(src, /dinnersIn\(r\.events \?\? \[\]\)\.find\(x => x\.start === day\.getTime\(\)\)/);
  assert.match(src, /catch \{ return \{ say: 'I can’t reach the calendar right now\.' \}; \}/);
});

test('"what\'s for dinner today" is heard, as tonight is', () => {
  assert.deepEqual(dinnerWord("what's for dinner today"), { ahead: 0, name: 'tonight', lead: 'Tonight' });
  assert.deepEqual(dinnerWord('what are we having for dinner today'), { ahead: 0, name: 'tonight', lead: 'Tonight' });
});
