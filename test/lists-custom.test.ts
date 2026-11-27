// Voice for the lists the family made: "add tent to the camping list", named like the list in the Lists app. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

const camping = [{ id: 'camping', name: 'Camping' }];

test('a list the family made is heard by its name', () => {
  assert.deepEqual(matchList('add tent to the camping list', camping), { op: 'add', list: 'camping', text: 'Tent' });
  assert.deepEqual(matchList("what's on the camping list", camping), { op: 'read', list: 'camping' });
  assert.deepEqual(matchList('take gas off my camping list', camping), { op: 'remove', list: 'camping', text: 'Gas' });
});

test('a multi-word list name and a name with punctuation both match', () => {
  assert.deepEqual(matchList('put seeds on my garden party list', [{ id: 'garden-party', name: 'Garden party' }]),
    { op: 'add', list: 'garden-party', text: 'Seeds' });
  assert.deepEqual(matchList('add socks to mum’s gifts list', [{ id: 'gifts', name: 'Mum’s (gifts)' }]),
    { op: 'add', list: 'gifts', text: 'Socks' });
});

test('without the list, a camping phrase is left to Claude', () => {
  assert.equal(matchList('add tent to the camping list'), null);
  assert.equal(matchList('add tent to the camping list', []), null);
});

test('Shopping and To-do still match with a family list present', () => {
  assert.deepEqual(matchList('add milk to the shopping list', camping), { op: 'add', list: 'shopping', text: 'Milk' });
  assert.deepEqual(matchList('what is on the to-do list', camping), { op: 'read', list: 'todo' });
});

test('a list whose name ends in "list" is heard once, not "list list"', () => {
  const packing = [{ id: 'packing-list', name: 'Packing list' }];
  assert.deepEqual(matchList('add socks to the packing list', packing), { op: 'add', list: 'packing-list', text: 'Socks' });
  assert.deepEqual(matchList("what's on the packing list", packing), { op: 'read', list: 'packing-list' });
  assert.deepEqual(matchList('take socks off the packing list', packing), { op: 'remove', list: 'packing-list', text: 'Socks' });
  assert.equal(matchList('add socks to the packing list list', packing), null);
});

test('a list named only "List" still matches the phrase "the list list"', () => {
  assert.deepEqual(matchList('add milk to the list list', [{ id: 'plain', name: 'List' }]), { op: 'add', list: 'plain', text: 'Milk' });
});

test('the reply names a list ending in "list" once', () => {
  const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8');
  assert.match(src, /const spokenList = \(name: string\)/);
});
