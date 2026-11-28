// A list item said mid-sentence lowers its first letter only when the next letter is lower case, so "AA batteries"
// and "DVD" keep their capitals (lowerFirst in src/apps/lists/web/voice-match.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { addManyReply, lowerFirst } from '../src/apps/lists/web/voice-match.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a word with a lower-case second letter loses its capital, as before', () => {
  assert.equal(lowerFirst('Milk'), 'milk');
  assert.equal(lowerFirst('Bread and butter'), 'bread and butter');
});

test('an acronym or a word with a capital inside keeps its capitals', () => {
  assert.equal(lowerFirst('AA batteries'), 'AA batteries');
  assert.equal(lowerFirst('DVD'), 'DVD');
  assert.equal(lowerFirst('iPad charger'), 'iPad charger');
  assert.equal(lowerFirst('I'), 'I');
});

test('the added-items reply keeps an acronym’s capitals', () => {
  assert.equal(addManyReply(['AA batteries', 'Milk'], 2, 0, 'the shopping list'), 'Added AA batteries and milk to the shopping list.');
});

test('the ticked, removed, changed and read replies all use the same rule', () => {
  assert.ok(voice.includes('`Ticked off ${lowerFirst(hit.text)} on ${name}.`'));
  assert.ok(voice.includes('`Removed ${lowerFirst(hit.text)} from ${name}.`'));
  assert.ok(voice.includes('`Added ${lowerFirst(c.text)} to ${name}.`'));
  assert.equal(voice.includes('.replace(/^./, ch => ch.toLowerCase())'), false);
});
