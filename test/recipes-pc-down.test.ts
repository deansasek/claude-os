// Recipes' error text when the tablet cannot reach the PC. The Recipes web code runs in the browser (DOM code), so these
// are source-text checks on search() and findPantry().
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8');
const PC_DOWN = 'Can’t reach your PC just now. Try again.';

test('search() catch shows the PC text, not the TheMealDB text', () => {
  const body = src.slice(src.indexOf('async function search('), src.indexOf('function keep('));
  const catchBlock = body.slice(body.indexOf('} catch {'));
  assert.ok(catchBlock.includes(PC_DOWN));
});

test('findPantry() catch shows the PC text, not the shared fail() text', () => {
  const body = src.slice(src.indexOf('async function findPantry('), src.indexOf('const missingNote'));
  const catchBlock = body.slice(body.indexOf('} catch {'));
  assert.ok(catchBlock.includes(PC_DOWN));
  assert.ok(!catchBlock.includes('fail()'));
});

test('the TheMealDB connection text is gone', () => {
  assert.ok(!src.includes('No connection to TheMealDB'));
});
