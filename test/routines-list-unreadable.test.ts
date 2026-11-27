// A routines list the PC could not read is not treated as an empty list (src/apps/routines/web/run.ts loadRoutines).
// run.ts touches the page at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/routines/web/run.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadRoutines(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('loadRoutines rejects a list reply the PC marked not ok, so it is not kept as an empty list', () => {
  assert.ok(start > 0, 'loadRoutines() exists');
  assert.match(body, /r\.ok === false/);
  assert.match(body, /throw new Error\('no routines'\)/);
});
