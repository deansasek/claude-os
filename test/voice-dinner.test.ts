// Voice "what's for dinner tonight" (src/core/web/voice-dinner.ts, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dinnerSay, dinnerWord } from '../src/core/web/voice-dinner.ts';

test('a dinner question is heard for tonight or tomorrow, and a plain one means tonight', () => {
  assert.equal(dinnerWord("what's for dinner"), 'tonight');
  assert.equal(dinnerWord("what's for dinner tonight"), 'tonight');
  assert.equal(dinnerWord("what's for dinner tomorrow"), 'tomorrow');
  assert.equal(dinnerWord('what are we having for dinner'), 'tonight');
});

test('other phrases are not dinner questions', () => {
  assert.equal(dinnerWord('what is for lunch'), null);
  assert.equal(dinnerWord('what is on for dinner party'), null);
});

test('the reply names the planned dinner, or says none is planned', () => {
  assert.equal(dinnerSay('Tacos', 'tonight'), 'Tonight it’s tacos.');
  assert.equal(dinnerSay('Fish pie', 'tomorrow'), 'Tomorrow it’s fish pie.');
  assert.equal(dinnerSay(null, 'tonight'), 'Nothing planned for dinner tonight.');
});

test('the voice reads the calendar for that night and picks its dinner, with a reply when the calendar cannot be read', () => {
  const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const dinner = dinnerWord\(t\);/);
  assert.match(src, /return dinnerCommand\(dinner\);/);
  assert.match(src, /getJson\(`\/api\/calendar\/local\?from=\$\{from\}&to=\$\{to\}`, READ_TIMEOUT_MS\)/);
  assert.match(src, /dinnersIn\(r\.events \?\? \[\]\)\.find\(x => x\.start === day\.getTime\(\)\)/);
  assert.match(src, /catch \{ return \{ say: 'I can’t reach the calendar right now\.' \}; \}/);
});
