// A weather place or unit that the PC cannot save is said as not saved, not as saved. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-weather-save-'));
process.env.CLAUDEOS_STATE_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { saveLocation } = await import('../src/apps/weather/server/weather.ts');

test('a place that is not on the map is refused as not saved, and nothing is written', async () => {
  const r = await saveLocation({ lat: 200, lon: 0, place: 'Nowhere' });
  assert.deepEqual(r, { status: 'error', saved: false, error: 'That place isn’t on the map.' });
  assert.equal(fs.existsSync(path.join(dir, 'meter-config.json')), false);
});

test('a place the PC cannot write is reported as not saved, not as a saved place', async () => {
  mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); });
  try {
    const r = await saveLocation({ units: 'celsius' });
    assert.equal(r.status, 'error');
    assert.equal((r as { saved?: boolean }).saved, false);
  } finally {
    mock.restoreAll();
  }
});
