// The Home Assistant settings rows must say "Couldn’t load" when the PC cannot answer, not "Not set".
// The page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('loadStatus sets the status-failed flag when the read fails', () => {
  const start = src.indexOf('async function loadStatus(');
  const body = src.slice(start, src.indexOf('// keepNote:', start));
  assert.match(body, /catch \{ statusFailed = true;/);
  assert.match(body, /statusFailed = false;/);
});

test('the Status row tests statusFailed alone, without the !s guard', () => {
  const start = src.indexOf("id: 'mode'");
  const row = src.slice(start, src.indexOf("id: 'address'", start));
  assert.match(row, /statusFailed\s*\?\s*'Couldn/);
  assert.doesNotMatch(row, /!s && statusFailed/);
});

test('settingRows checks the status-failed flag before it shows Not set', () => {
  const start = src.indexOf('function settingRows(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const flag = body.indexOf('statusFailed');
  const notSet = body.indexOf("'Not set'");
  assert.ok(flag > 0, 'settingRows reads statusFailed');
  assert.ok(notSet > flag, 'the Not set text comes after the statusFailed check');
});

test('settingRows adds a scenesErr row with the scene read reason when the scene list fails', () => {
  const start = src.indexOf('function settingRows(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const head = body.indexOf("id: 'scenesHead'");
  const err = body.indexOf("id: 'scenesErr'");
  assert.ok(err > head, 'the scenesErr row comes after the scenesHead row');
  assert.match(body, /if \(sl\?\.status === 'error'\) rows\.push\(\{ kind: 'info', id: 'scenesErr', title: 'Couldn’t list your scenes', detail: plain\(sl\.error\)/);
});
