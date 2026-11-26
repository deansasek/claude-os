// The Settings Apps switches flip tabAllowed before androidApps.setAllowed. A failed save must put the set back
// (src/apps/settings/web/index.ts, the stTabApps click handler in bindApps). The settings page is DOM code with no
// unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const paint = src.slice(src.indexOf('function paintTabApps('), src.indexOf('function bindApps('));

test('paintTabApps sets tabFailed in its catch block and clears it on a good read', () => {
  assert.match(paint, /catch \{ tabList = \[\]; tabFailed = true; \}/);
  assert.match(paint, /tabFailed = false;/);
});

test('paintTabApps shows the read-failed text instead of "No apps found." when tabFailed is set', () => {
  assert.match(paint, /tabFailed \? 'Couldn’t read the apps on this tablet\. Check the tablet app is up to date, then try again\.' : 'No apps found\.'/);
});

test('the stTabApps handler restores tabAllowed in its catch block', () => {
  const start = src.indexOf("$('stTabApps').addEventListener('click'");
  const handler = src.slice(start, src.indexOf('onAppSettingsChange(', start));
  assert.match(handler, /catch \{ tabAllowed = before; confirmSheet\('Couldn’t change it'/);
});

test('the stTabApps handler re-reads allowed() before it saves with setAllowed', () => {
  const start = src.indexOf("$('stTabApps').addEventListener('click'");
  const handler = src.slice(start, src.indexOf('onAppSettingsChange(', start));
  const read = handler.indexOf('androidApps.allowed()');
  assert.ok(read > 0, 'the handler reads androidApps.allowed()');
  assert.ok(read < handler.indexOf('androidApps.setAllowed('), 'the read comes before the save');
});

test('the stTabApps handler does not save when the re-read throws', () => {
  const start = src.indexOf("$('stTabApps').addEventListener('click'");
  const handler = src.slice(start, src.indexOf('onAppSettingsChange(', start));
  assert.match(handler, /try \{ tabAllowed = new Set\(androidApps\.allowed\(\)\.map\(a => a\.id\)\); \}\s*catch \{ confirmSheet\('Couldn’t change it', 'Couldn’t read the tablet’s apps, so nothing changed\. Try again\.', 'OK', \(\) => \{\}\); return; \}/);
  assert.ok(handler.indexOf('return; }') < handler.indexOf('androidApps.setAllowed('), 'the return is before the save');
});
