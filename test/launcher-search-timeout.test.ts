// The launcher search reads give up on a PC that does not answer, and a late older load does not overwrite newer search data
// (src/apps/launcher/web/index.ts loadSearchData; src/apps/lists/web/readers.ts readLists). The module talks to the tablet at load,
// so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = readFileSync(path.join(root, 'src/apps/launcher/web/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const readers = readFileSync(path.join(root, 'src/apps/lists/web/readers.ts'), 'utf8').replace(/\r\n/g, '\n');
const start = launcher.indexOf('async function loadSearchData(');
const body = launcher.slice(start, launcher.indexOf('\n}\n', start));

test('the search reads pass the search timeout', () => {
  assert.match(launcher, /const SEARCH_TIMEOUT_MS = 10e3;/);
  assert.match(body, /readLists\(SEARCH_TIMEOUT_MS\)/);
  assert.match(body, /\/api\/claude\/usage', SEARCH_TIMEOUT_MS\)/);
  assert.match(readers, /export const readLists = \(timeoutMs\?: number\)/);
  assert.match(readers, /getJson<ListsResult>\('\/api\/lists\/lists', timeoutMs\)/);
});

test('each load takes the next number, and every await checks it before the search data is set', () => {
  assert.match(body, /const seq = \+\+searchSeq;/);
  const guards = body.match(/if \(seq !== searchSeq\) return;/g) ?? [];
  assert.equal(guards.length, 4, 'both reads check the number on the success and failure paths');
  assert.ok(body.indexOf('if (seq !== searchSeq) return;') < body.indexOf('lists = l;'), 'the first check comes before the lists are set');
});
