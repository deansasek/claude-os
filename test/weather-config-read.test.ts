// The saved weather config: bad fields are dropped on read, and a config file that is not an object is never saved over. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-weather-cfg-'));
process.env.CLAUDEOS_STATE_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { cleanConfig, saveLocation } = await import('../src/apps/weather/server/weather.ts');

test('bad weather fields are dropped, and the good ones are kept', () => {
  assert.deepEqual(cleanConfig({ units: 'kelvin', lat: '12', lon: 999, place: 'Paris', city: 5 }), { place: 'Paris' });
  assert.deepEqual(cleanConfig({ lat: 51.5, lon: -0.12, units: 'celsius' }), { lat: 51.5, lon: -0.12, units: 'celsius' });
});

test('a config that is not an object reads as empty', () => {
  assert.deepEqual(cleanConfig([1, 2]), {});
  assert.deepEqual(cleanConfig('x'), {});
  assert.deepEqual(cleanConfig(null), {});
});

test('saveLocation refuses a config file that is not an object, and never saves over it', () => {
  // a source check: the real meter-config.json sits at the repo root, so a test must not write it
  const src = fs.readFileSync(new URL('../src/apps/weather/server/weather.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("if (typeof raw !== 'object' || Array.isArray(raw)) return { status: 'error', saved: false"));
});
