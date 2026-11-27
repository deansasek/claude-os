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

test('loadDevices keeps the last good device list when the read fails', () => {
  const start = src.indexOf('async function loadDevices(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /catch \{ devicesFailed = true; if \(!devices\) devices = \{ status: 'error'/);
  assert.match(body, /devicesFailed = false;/);
  assert.doesNotMatch(body, /catch \{ devices = \{ status: 'error'/);
});

test('loadScenes keeps the last good scene list when the read fails', () => {
  const start = src.indexOf('async function loadScenes(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /catch \{ (?:if \(gen !== scenesGen\) return; )?scenesFailed = true; if \(!sceneList\) sceneList = \{ status: 'error'/);
  assert.match(body, /scenesFailed = false;/);
  assert.doesNotMatch(body, /catch \{ sceneList = \{ status: 'error'/);
});

test('settingRows shows the out-of-date detail on allowHead and scenesHead when a kept list is stale', () => {
  const start = src.indexOf('function settingRows(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const stale = 'Can’t reach the PC right now, so this may be out of date.';
  const allow = body.indexOf("id: 'allowHead'");
  const scenes = body.indexOf("id: 'scenesHead'");
  assert.ok(allow > 0 && scenes > 0, 'settingRows has the allowHead and scenesHead rows');
  assert.match(body, /devicesFailed && dev\?\.status === 'ok'/);
  assert.match(body, /scenesFailed && sl\?\.status === 'ok'/);
  assert.ok(body.split(stale).length - 1 === 2, 'the out-of-date detail appears once for each head row');
  assert.ok(body.indexOf(stale) > allow, 'the devices out-of-date detail sits on the allowHead row');
  assert.ok(body.lastIndexOf(stale) > scenes, 'the scenes out-of-date detail sits on the scenesHead row');
});

test('settingRows adds a scenesErr row with the scene read reason when the scene list fails', () => {
  const start = src.indexOf('function settingRows(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const head = body.indexOf("id: 'scenesHead'");
  const err = body.indexOf("id: 'scenesErr'");
  assert.ok(err > head, 'the scenesErr row comes after the scenesHead row');
  assert.match(body, /if \(sl\?\.status === 'error'\) rows\.push\(\{ kind: 'info', id: 'scenesErr', title: 'Couldn’t list your scenes', detail: plain\(sl\.error\)/);
});
