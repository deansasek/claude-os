// The Settings storage read gives up on a PC that does not answer, the tablet's own rows paint first, and a late older read does not
// overwrite the photos size (src/apps/settings/web/index.ts paintStorage). The settings page talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function paintStorage(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the storage read has a 20 second timeout', () => {
  assert.match(src, /const STORAGE_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<\{ photos: number \}>\('\/api\/settings\/storage', STORAGE_TIMEOUT_MS\)/);
});

test('the downloads row paints before the PC is asked, and each read takes the next number', () => {
  assert.ok(body.indexOf('const n = ++storageSeq;') >= 0, 'the number is taken');
  assert.ok(body.indexOf("$('stStDownloads')") < body.indexOf('await getJson'), 'the downloads row is painted before the read');
  assert.ok(body.indexOf('const n = ++storageSeq;') < body.indexOf('await getJson'), 'the number is taken before the read');
});

test('the photos size is only written when the read is still the newest, on both paths', () => {
  const writes = [...body.matchAll(/\$\('stStPhotos'\)\.textContent/g)].map(m => m.index as number);
  assert.equal(writes.length, 2, 'the photos size is written on both paths');
  for (const at of writes) {
    const before = body.slice(0, at);
    assert.ok(before.lastIndexOf('if (n !== storageSeq) return;') > before.lastIndexOf('await getJson') - 1, 'the check comes before the write');
  }
});
