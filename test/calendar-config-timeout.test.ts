// The Calendar address save (POST config) and the show or hide switch (POST calendar-shown) pass WRITE_TIMEOUT_MS,
// so a PC that does not answer gives up and the page recovers. Reads the page source. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const web = fs.readFileSync(path.join(ROOT, 'src', 'apps', 'calendar', 'web', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

test('the show or hide switch passes the write timeout', () => {
  assert.match(
    web,
    /postJson<[^>]*>\(`\$\{API\}\/calendar-shown`, \{ id, shown: next \}, WRITE_TIMEOUT_MS\)/,
  );
});

test('the address save passes the write timeout', () => {
  assert.match(
    web,
    /postJson<CalConfigResult>\(`\$\{API\}\/config`, \{ address \}, WRITE_TIMEOUT_MS\)/,
  );
});
