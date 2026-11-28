// Voice "untick everything on the packing list" (the same as the Untick all button). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('unticking everything is read for Shopping and To-do', () => {
  assert.deepEqual(matchList('untick everything on the shopping list'), { op: 'untick', list: 'shopping' });
  assert.deepEqual(matchList('untick all the items on my to-do list'), { op: 'untick', list: 'todo' });
  assert.deepEqual(matchList('uncheck every item from the grocery list'), { op: 'untick', list: 'shopping' });
});

test('unticking with no list named is not a command', () => {
  assert.equal(matchList('untick everything'), null);
  assert.equal(matchList('untick all'), null);
});

test('a family list is unticked by its name too', () => {
  assert.deepEqual(matchList('untick everything on the packing list', [{ id: 'packing', name: 'Packing' }]),
    { op: 'untick', list: 'packing' });
});

test('the voice reply writes untick-all, and says nothing is ticked when none was', () => {
  assert.ok(voice.includes("if (c.op === 'untick') {"));
  assert.ok(voice.includes("writeList('untick-all', { list: c.list })"));
  assert.ok(voice.includes('if (r.unticked === 0) return { say: `Nothing is ticked on ${name}.` };'));
});
