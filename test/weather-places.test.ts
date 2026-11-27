// A city search keeps every usable result, and drops a bad entry without hiding the others (src/apps/weather/server/weather.ts
// placesFrom). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-weather-places-'));
process.env.CLAUDEOS_STATE_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { placesFrom } = await import('../src/apps/weather/server/weather.ts');

const london = { name: 'London', admin1: 'England', country: 'United Kingdom', latitude: 51.5, longitude: -0.12 };

test('a usable result is kept as a place', () => {
  assert.deepEqual(placesFrom([london]), [{ name: 'London', region: 'England', country: 'United Kingdom', lat: 51.5, lon: -0.12 }]);
});

test('a bad entry is dropped and the others stay', () => {
  const r = placesFrom([null, 42, { name: 'Nowhere', latitude: 'abc', longitude: 1 }, { latitude: 1, longitude: 1 }, london]);
  assert.deepEqual(r.map(p => p.name), ['London']);
});

test('a search answer that is not a list gives no places', () => {
  assert.deepEqual(placesFrom({}), []);
  assert.deepEqual(placesFrom(null), []);
});
