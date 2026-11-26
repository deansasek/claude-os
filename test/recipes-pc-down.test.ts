// Recipes' error text when the tablet cannot reach the PC. The Recipes web code runs in the browser (DOM code), so these
// are source-text checks on search() and findPantry().
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/apps/recipes/web/index.ts', import.meta.url), 'utf8');
const PC_DOWN = 'Can’t reach your PC just now. Try again.';

const catchOf = (start: string, end: string): string => {
  const body = src.slice(src.indexOf(start), src.indexOf(end));
  return body.slice(body.indexOf('} catch {'));
};

test('the PC text is one shared constant', () => {
  assert.equal(src.split(PC_DOWN).length - 1, 1);
  assert.ok(src.includes(`const PC_DOWN = '${PC_DOWN}';`));
});

test('search() catch shows the PC text, not the TheMealDB text', () => {
  assert.ok(catchOf('async function search(', 'function keep(').includes('resultsError = PC_DOWN;'));
});

test('findPantry() catch shows the PC text, not the shared fail() text', () => {
  const catchBlock = catchOf('async function findPantry(', 'const missingNote');
  assert.ok(catchBlock.includes('foundError = PC_DOWN;'));
  assert.ok(!catchBlock.includes('fail()'));
});

test('loadNames() catch shows the PC text', () => {
  assert.ok(catchOf('async function loadNames(', '/** The shelf:').includes('namesError = PC_DOWN;'));
});

test('the TheMealDB connection text is gone', () => {
  assert.ok(!src.includes('No connection to TheMealDB'));
});
