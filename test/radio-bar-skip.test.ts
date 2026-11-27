// The Radio bar's Previous and Next skip exactly when the Now playing view does (src/apps/radio/web/player.ts canStepFavourites). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { canStepFavourites } from '../src/apps/radio/web/player.ts';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/radio/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function render(): void {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('one favourite cannot skip, two can', () => {
  assert.equal(canStepFavourites([{ id: 'a' }]), false);
  assert.equal(canStepFavourites([{ id: 'a' }, { id: 'b' }]), true);
});

test('the bar sets Previous and Next from canStepFavourites, not from the favourites count', () => {
  assert.ok(start > 0, 'render() exists');
  assert.match(body, /const canSkip = canStepFavourites\(favs\);/);
  assert.match(body, /rdPrev'\)\.disabled = !canSkip;/);
  assert.match(body, /rdNext'\)\.disabled = !canSkip;/);
  assert.doesNotMatch(body, /rdPrev'\)\.disabled = !favs\.length/);
  assert.doesNotMatch(body, /rdNext'\)\.disabled = !favs\.length/);
});
