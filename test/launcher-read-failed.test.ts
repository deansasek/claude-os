// The launcher says the wrong thing when the tablet cannot return its apps (src/apps/launcher/web/index.ts, openSheet,
// paintList, paintEmpty). The launcher is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/launcher/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fn = (name: string) => {
  const start = src.indexOf(`function ${name}(`);
  return src.slice(start, src.indexOf('\n}\n', start));
};

test('paintEmpty reads tabOk and shows the read-failed message', () => {
  const body = fn('paintEmpty');
  assert.match(body, /tabOk/);
  assert.match(body, /Couldn’t read the tablet’s apps\. Open Apps again to retry\./);
});

test('toggleAllowed shows the change-failed message when setAllowed throws', () => {
  assert.match(fn('toggleAllowed'), /showSheetNote\('Couldn’t change it\. Check the tablet app is up to date, then try again\.'\)/);
});

test('openSheet tracks a failed read and paintList shows the read-failed message', () => {
  assert.match(fn('openSheet'), /launchOk = false/);
  assert.match(fn('paintList'), /Couldn’t read the tablet’s apps\. Close this and try again\./);
});

test('installApps shows the Play-failed message when the launch fails or throws', () => {
  assert.match(fn('installApps'), /showSheetNote\('Couldn’t open Google Play\. Try again\.'\)/);
});

test('openSheet removes the old sheet note before the sheet opens', () => {
  assert.match(fn('openSheet'), /querySelector\('\.ln-sheet-note'\)\?\.remove\(\)/);
});

// A save writes the whole allowed list. When the read failed, tabApps is [], so a save would drop every app.
// Each saving function must reload the list, check tabOk, and return before setAllowed when the read failed.
const assertReadGuardBeforeSave = (body: string) => {
  const reload = body.indexOf('loadTablet()');
  const guard = body.indexOf('if (!tabOk)');
  const save = body.indexOf('setAllowed(');
  assert.ok(reload >= 0 && reload < guard, 'loadTablet() runs before the tabOk check');
  assert.ok(guard >= 0 && guard < save, 'the tabOk check runs before setAllowed');
  assert.match(body.slice(guard, save), /return; \}/, 'the failed-read branch returns before setAllowed');
  assert.match(body.slice(guard, save), /showSheetNote\('Couldn’t read the tablet’s apps, so nothing changed\. Try again\.'\)/);
};

test('installApps reloads the allowed apps and returns before setAllowed when the read failed', () => {
  assertReadGuardBeforeSave(fn('installApps'));
});

test('toggleAllowed reloads the allowed apps and returns before setAllowed when the read failed', () => {
  assertReadGuardBeforeSave(fn('toggleAllowed'));
});
