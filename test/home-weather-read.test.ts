// Home's weather read (src/apps/home/web/weather-read.ts): a route error is a failed read, and keeps the last good forecast.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { emptyTileText, weatherAfterRead } from '../src/apps/home/web/weather-read.ts';

const ok: { status: string; place?: string } = { status: 'ok', place: 'Home' };

test('a route error (status error) is a failed read, not a forecast', () => {
  const r = weatherAfterRead<{ status: string }>(null, { status: 'error' });
  assert.equal(r.failed, true);
  assert.equal(r.wx, null);   // no forecast yet: the tile shows Offline
});

test('a route error keeps the last good forecast on the tile', () => {
  const r = weatherAfterRead(ok, { status: 'error' });
  assert.equal(r.failed, true);
  assert.equal(r.wx, ok);
});

test('a good read replaces the forecast and clears the failure', () => {
  const next = { status: 'ok', place: 'Office' };
  const r = weatherAfterRead(ok, next);
  assert.equal(r.failed, false);
  assert.equal(r.wx, next);
});

test('a no-location answer is a read, not a failure', () => {
  const r = weatherAfterRead(null, { status: 'no_location' });
  assert.equal(r.failed, false);
  assert.deepEqual(r.wx, { status: 'no_location' });
});

test('a city the hub cannot find says City not found on the tile', () => {
  const r = weatherAfterRead(null, { status: 'not_found' });
  assert.equal(r.failed, false);
  assert.equal(emptyTileText(r.wx?.status, r.failed).temp, 'City not found');
});

test('the empty tile keeps its no-location words', () => {
  assert.equal(emptyTileText('no_location', false).temp, 'Set your city');
  assert.equal(emptyTileText('no_location', false).sub, 'Tap to choose where you live');
});

test('a failed read with no forecast says Offline', () => {
  assert.equal(emptyTileText(undefined, true).temp, 'Offline');
  assert.equal(emptyTileText(undefined, true).sub, 'Can’t reach the forecast');
});

test('the tile keeps its loading words before the first read', () => {
  assert.equal(emptyTileText(undefined, false).temp, '–');
  assert.equal(emptyTileText(undefined, false).sub, 'Checking the sky…');
});

// The ambient screen's weather chip (src/core/web/system.ts loadWeather). The page runs with the DOM, so these tests
// read the source of loadWeather(), as test/amb-photos-offline.test.ts does for the photo list.
const systemSrc = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/system.ts'), 'utf8')
  .replace(/\r\n/g, '\n');
const wxStart = systemSrc.indexOf('async function loadWeather(');
const wxBody = systemSrc.slice(wxStart, systemSrc.indexOf('// ---------- the next alarm', wxStart));
const errorAt = wxBody.indexOf("if (r.status === 'error')");
const otherAt = wxBody.indexOf("if (r.status !== 'ok' || !r.current)");

test('an error answer keeps the last chip and retries in about two minutes', () => {
  assert.ok(wxStart > 0, 'loadWeather() exists');
  assert.ok(errorAt > 0, 'loadWeather() handles status error');
  const branch = wxBody.slice(errorAt, otherAt);
  assert.ok(!/\bwx\s*=[^=]/.test(branch), 'the error branch does not clear wx');
  assert.ok(branch.includes('wxAt = Date.now() - 13 * 60e3;'), 'the error branch sets the two-minute retry');
  assert.ok(branch.includes('return;'), 'the error branch returns');
});

test('a not_found or no_location answer clears the chip and repaints the ambient screen', () => {
  assert.ok(otherAt > errorAt, 'the other-status branch follows the error branch');
  const branch = wxBody.slice(otherAt, wxBody.indexOf('wx = {', otherAt));
  assert.ok(branch.includes('wx = null;'), 'the other-status branch clears wx');
  assert.ok(branch.includes('if (ambientOn) paintAmbient();'), 'the other-status branch repaints when ambient is on');
});
