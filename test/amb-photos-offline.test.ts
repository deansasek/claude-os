// A failed re-read of the photo list keeps the last list, so the photo on screen stays (src/core/web/amb-photos.ts).
// The frame runs in the page with the DOM, so this reads the source of loadList()'s catch. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/amb-photos.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadList()');
const body = src.slice(start, src.indexOf('function pick(', start));
const catchAt = body.indexOf('} catch {');

test('a failed photo list read keeps the last list and retries in five minutes', () => {
  assert.ok(start > 0, 'loadList() exists');
  assert.ok(catchAt > 0, 'loadList() has a catch');
  const handler = body.slice(catchAt);
  assert.ok(!/\bids\s*=/.test(handler), 'the catch does not clear ids');
  assert.ok(!/\bbag\s*=/.test(handler), 'the catch does not clear bag');
  assert.ok(handler.includes('listAt = Date.now() - LIST_MS + 5 * 60e3;'), 'the catch sets the five-minute retry');
});
