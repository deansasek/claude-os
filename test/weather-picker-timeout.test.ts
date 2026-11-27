// The Weather city search and place or unit save give up on a PC that does not answer, so the picker does not stay on Searching or Saving
// (src/apps/weather/web/index.ts searchPlaces, sendLocation). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/weather/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const search = slice('async function searchPlaces(');
const send = slice('async function sendLocation(');

test('the city search and the place save both pass the forecast timeout', () => {
  assert.match(src, /const WX_TIMEOUT_MS = 20e3;/);
  assert.match(search, /getJson<PlacesResponse>\(`\/api\/weather\/places\?q=\$\{encodeURIComponent\(q\)\}`, WX_TIMEOUT_MS\)/);
  assert.match(send, /postJson<Weather>\('\/api\/weather\/location', body, WX_TIMEOUT_MS\)/);
});

test('a failed search still checks its number before it paints the retry', () => {
  assert.match(search, /if \(seq === searchSeq\) \{ places = \[\]; paintPlaces\('City search can’t reach ClaudeOS’s server right now/);
});
