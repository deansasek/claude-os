// The Photos grid keeps the photos it shows when the PC cannot read its folder. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPhotoDays, type PhotoDay } from '../src/apps/photos/api.ts';

const shown: PhotoDay[] = [{ day: '2026-11-26', photos: [{ id: 'a', at: '2026-11-26T10:00:00Z', url: '/x', hasThumb: true }] }];
const fresh: PhotoDay[] = [{ day: '2026-11-27', photos: [] }];

test('a list the PC read replaces the grid', () => {
  assert.deepEqual(nextPhotoDays(shown, { ok: true, days: fresh }), fresh);
});

test('a list the PC could not read keeps the photos already shown', () => {
  assert.deepEqual(nextPhotoDays(shown, { ok: false, days: [] }), shown);
});

test('a list with no days keeps the photos already shown', () => {
  assert.deepEqual(nextPhotoDays(shown, { ok: true }), shown);
});
