// "Is milk on the list" with no list named (src/apps/lists/web/voice-match.ts, src/core/web/voice-commands.ts). The command
// handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('is, are or do we have an item on the list, with no list named, is a has-any question', () => {
  assert.deepEqual(matchList('is milk on the list'), { op: 'has-any', text: 'Milk' });
  assert.deepEqual(matchList('are eggs on my list'), { op: 'has-any', text: 'Eggs' });
  assert.deepEqual(matchList('do we have bread on the list'), { op: 'has-any', text: 'Bread' });
});

test('a named list still means that list, and it or a bare list is not a question', () => {
  assert.deepEqual(matchList('is milk on the shopping list'), { op: 'has', list: 'shopping', text: 'Milk' });
  assert.equal(matchList('is it on the list'), null);
  assert.equal(matchList('is on the list'), null);
});

test('the voice looks on every list and answers yes, ticked, no, or names the lists', () => {
  assert.match(voice, /else if \(list\?\.op === 'has-any'\) \{/);
  assert.match(voice, /const r = await hasAnywhere\(list\.text\);/);
  assert.match(voice, /No, \$\{said\} isn’t on any of your lists\./);
  assert.match(voice, /is on more than one list\. Say which list\./);
});
