// A weather preview checks its lat and lon as a saved place does (src/apps/weather/server/weather.ts weather). A bad value is
// refused with no outbound call. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-weather-preview-'));
process.env.CLAUDEOS_STATE_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { weather } = await import('../src/apps/weather/server/weather.ts');

const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = (async () => { calls += 1; throw new Error('offline in the test'); }) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

test('a preview with a latitude that is not a number is refused, with no outbound call', async () => {
  calls = 0;
  const r = await weather({ lat: NaN, lon: 1, place: 'Preview' });
  assert.equal(r.status, 'no_location');
  assert.equal(calls, 0);
});

test('a preview with a latitude off the map is refused, with no outbound call', async () => {
  calls = 0;
  const r = await weather({ lat: 95, lon: 1, place: 'Preview' });
  assert.equal(r.status, 'no_location');
  assert.equal(calls, 0);
});

test('a valid preview does reach the forecast service', async () => {
  calls = 0;
  try { await weather({ lat: 51.5, lon: -0.12, place: 'Preview' }); } catch { /* the stub is offline: the answer does not matter here */ }
  assert.ok(calls > 0);
});
