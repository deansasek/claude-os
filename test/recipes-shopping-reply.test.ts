// The recipe's "Add to shopping list" reply counts only saved writes (src/apps/recipes/web/index.ts). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { addManyReply } from '../src/apps/lists/web/voice-match.ts';

const items = ['flour', 'eggs', 'milk', 'salt', 'oil'];

test('all items saved names them all', () => {
  assert.equal(addManyReply(items, 5, 0, 'Shopping'), 'Added flour, eggs, milk, salt and oil to Shopping.');
});

test('a partial run says how many went', () => {
  assert.equal(addManyReply(items, 2, 0, 'Shopping'), 'Added 2 of 5 to Shopping.');
});

test('queued items keep the when-the-PC-is-back wording', () => {
  assert.equal(addManyReply(items, 0, 5, 'Shopping'), 'I can’t reach Shopping right now. The 5 items will be added when the PC is back.');
});

// The recipe screen is DOM code with no unit seam, so this reads the source of addToShopping().
test('addToShopping counts only saved writes and says so when none saved', () => {
  const src = fs.readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('async function addIngredientsToShopping');
  assert.ok(start > 0, 'addIngredientsToShopping() exists');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /if \(r\?\.ok\) ok\+\+;/, 'a refused write is not counted');
  assert.match(body, /addManyReply\(items, ok, waiting, 'Shopping'\)/, 'the reply gets every item, so a partial run shows how many');
  assert.match(body, /I couldn’t add those to Shopping\./, 'a run with nothing saved gets the failure line');
});
