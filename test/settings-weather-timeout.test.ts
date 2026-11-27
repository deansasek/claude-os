// The Settings weather-city reads and save give up on a PC that does not answer, and a late older read does not undo a saved city
// (src/apps/settings/web/index.ts paintWeatherPlace, findWeatherCity, saveWeatherPlace). The module talks to the tablet at load,
// so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const paint = slice('async function paintWeatherPlace(');
const find = slice('async function findWeatherCity(');
const save = slice('async function saveWeatherPlace(');

test('the timeout is defined, and the forecast, places and save calls all pass it', () => {
  assert.match(src, /const WX_TIMEOUT_MS = 20e3;/);
  assert.match(paint, /getJson<Weather>\('\/api\/weather\/forecast', WX_TIMEOUT_MS\)/);
  assert.match(find, /getJson<PlacesResponse>\(`\/api\/weather\/places\?q=\$\{encodeURIComponent\(q\)\}`, WX_TIMEOUT_MS\)/);
  assert.match(save, /postJson<Weather>\('\/api\/weather\/location', \{ lat: p\.lat, lon: p\.lon, place: p\.name \}, WX_TIMEOUT_MS\)/);
});

test('a forecast read checks its number on both paths, and a saved city bumps it before the note is written', () => {
  assert.match(paint, /const seq = \+\+wxSeq;/);
  const guards = paint.match(/if \(seq !== wxSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(paint.indexOf('if (seq !== wxSeq) return;') < paint.indexOf('note.innerHTML'), 'the first check comes before the note is written');
  assert.match(save, /wxSeq\+\+;/);
  assert.ok(save.indexOf('wxSeq++;') < save.indexOf("$('stWxNote').innerHTML"), 'the bump comes before the note is written');
});
