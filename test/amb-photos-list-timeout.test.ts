// The ambient photo frame's list read gives up on a PC that does not answer, and a late read from before a stop or start does not
// replace the list (src/core/web/amb-photos.ts loadList). The frame runs in the page with the DOM, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/amb-photos.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadList()');
const body = src.slice(start, src.indexOf('function pick(', start));

test('the list read has a timeout of 20 seconds', () => {
  assert.match(src, /const LIST_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<PhotoList>\('\/api\/photos\/list\?limit=500', LIST_TIMEOUT_MS\)/);
});

test('the read takes the generation first, and both paths drop a read from an older run', () => {
  assert.ok(body.indexOf('const g = gen;') > 0 && body.indexOf('const g = gen;') < body.indexOf('await getJson'), 'the generation is taken before the read');
  const guards = body.match(/if \(g !== gen\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the generation');
  assert.ok(body.indexOf('if (g !== gen) return;') < body.indexOf('ids = [...seen];'), 'the check comes before the list is replaced');
});
