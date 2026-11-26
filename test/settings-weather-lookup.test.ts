// Settings > Privacy > Weather city must tell a failed city search from a PC that cannot be reached
// (src/apps/settings/web/index.ts, findWeatherCity).
// The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

type Sheet = { title: string; body: string };

// Load findWeatherCity from the source, with stubbed getJson, confirmSheet and openChooser.
function loadFindWeatherCity(
  getJson: (url: string) => Promise<unknown>,
  confirmSheet: (title: string, body: string, ok: string, done: () => void) => void,
  openChooser: (...args: unknown[]) => void,
) {
  const start = src.indexOf('async function findWeatherCity(q: string): Promise<void> {');
  const end = src.indexOf('\n}\n', start) + 3;
  // Strip the type annotations the body uses, so the TypeScript text runs as plain JavaScript.
  const body = src.slice(start, end)
    .replace('(q: string): Promise<void>', '(q)')
    .replace('let r: PlacesResponse;', 'let r;')
    .replace(/<PlacesResponse>/g, '');
  return new Function('getJson', 'confirmSheet', 'openChooser', 'encodeURIComponent', `${body}\nreturn findWeatherCity;`)(
    getJson, confirmSheet, openChooser, encodeURIComponent,
  ) as (q: string) => Promise<void>;
}

function recorder(): { sheets: Sheet[]; confirmSheet: (t: string, b: string, ok: string, done: () => void) => void } {
  const sheets: Sheet[] = [];
  return { sheets, confirmSheet: (title, body) => { sheets.push({ title, body }); } };
}

test('findWeatherCity shows the service message when the place search answers with an error', async () => {
  const rec = recorder();
  let chooserOpened = false;
  const find = loadFindWeatherCity(
    async () => ({ status: 'error', results: [], error: 'forecast down' }),
    rec.confirmSheet,
    () => { chooserOpened = true; },
  );
  await find('Lisbon');
  assert.deepEqual(rec.sheets, [{
    title: 'Couldn’t look that up',
    body: 'The city search service didn’t answer. Try again in a moment.',
  }]);
  assert.equal(chooserOpened, false);
});

test('findWeatherCity shows the PC message when the read throws', async () => {
  const rec = recorder();
  const find = loadFindWeatherCity(
    async () => { throw new Error('network'); },
    rec.confirmSheet,
    () => { throw new Error('chooser should not open'); },
  );
  await find('Lisbon');
  assert.deepEqual(rec.sheets, [{
    title: 'Couldn’t look that up',
    body: 'Check the connection to your PC, then try again.',
  }]);
});

test('findWeatherCity opens the chooser when the place search answers with places', async () => {
  const rec = recorder();
  let chooserOpened = false;
  const find = loadFindWeatherCity(
    async () => ({ status: 'ok', results: [{ name: 'Lisbon', lat: 38.7, lon: -9.1, country: 'Portugal' }] }),
    rec.confirmSheet,
    () => { chooserOpened = true; },
  );
  await find('Lisbon');
  assert.equal(rec.sheets.length, 0);
  assert.equal(chooserOpened, true);
});
