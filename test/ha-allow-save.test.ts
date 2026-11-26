// The Home Assistant "Devices Claude can control" switches must report a failed save to Settings.
// setAllowed returns its promise, so the Settings row can catch the error and show the sheet.
// The page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the Settings device row returns the setAllowed promise', () => {
  assert.match(src, /set: v => setAllowed\(d\.entity_id, v\)/);
});

test('setAllowed throws when the PC answer is not ok', () => {
  const start = src.indexOf('async function setAllowed(');
  const body = src.slice(start, src.indexOf('// ---------- layout edits', start));
  assert.match(body, /if \(r\?\.ok === true\)/);
  assert.match(body, /throw new Error\(r\?\.error \|\| 'Can’t reach the PC right now, so that wasn’t saved\.'\)/);
});
