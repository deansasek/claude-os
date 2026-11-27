// The Settings update check gives up on a PC that does not answer, and a late older check does not undo a newer status
// (src/apps/settings/web/index.ts paintUpdate). The settings page talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function paintUpdate(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the PC build read has a 20 second timeout', () => {
  assert.match(src, /const UPDATE_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<\{ versionCode: number \}>\('\/apk\/version', UPDATE_TIMEOUT_MS\)/);
});

test('each check takes the next number before the read, and the check comes before the status is shown', () => {
  assert.ok(body.indexOf('const n = ++updateSeq;') >= 0, 'the number is taken');
  assert.ok(body.indexOf('const n = ++updateSeq;') < body.indexOf('await getJson'), 'the number is taken before the read');
  const guard = body.indexOf('if (n !== updateSeq) return;');
  assert.ok(guard > 0, 'the check exists');
  assert.ok(guard < body.indexOf('updateStatus('), 'the check comes before the status is computed');
  assert.ok(guard < body.indexOf("$('stUpdStatus')"), 'the check comes before the status is shown');
});
