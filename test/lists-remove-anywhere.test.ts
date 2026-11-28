// "Remove milk from the list" with no list named (src/apps/lists/web/voice-match.ts, src/core/web/voice-commands.ts).
// The command handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchList } from '../src/apps/lists/web/voice-match.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('remove or take off an item with no list named is a remove-any command', () => {
  assert.deepEqual(matchList('remove milk from the list'), { op: 'remove-any', text: 'Milk' });
  assert.deepEqual(matchList('take bread off the list'), { op: 'remove-any', text: 'Bread' });
  assert.deepEqual(matchList('delete the eggs from my list'), { op: 'remove-any', text: 'Eggs' });
});

test('a named list still means that list, and a remove with no item is not a command', () => {
  assert.deepEqual(matchList('remove milk from the shopping list'), { op: 'remove', list: 'shopping', text: 'Milk' });
  assert.equal(matchList('remove it from the list'), null);
  assert.equal(matchList('remove from the list'), null);
});

test('the voice removes the one exact item and says which list, or lets the phrase go on', () => {
  assert.match(voice, /else if \(list\?\.op === 'remove-any'\) \{/);
  assert.match(voice, /const r = await removeAnywhere\(list\.text\);/);
  assert.match(voice, /if \(hits\.length > 1\) return \{ say: `\$\{text\} is on more than one list\. Say which list\.` \};/);
  assert.match(voice, /return \{ say: `Removed \$\{said\} from \$\{name\}\.`, react: 'hop' \};/);
});
