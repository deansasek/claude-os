// The Apps grid draws each app's live rail icon, so the Clock tile shows the current time (src/core/web/shell.ts installedApps).
// Source-text check: shell and launcher are DOM code with no unit seam, so this reads their source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const shell = readFileSync(new URL('../src/core/web/shell.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const launcher = readFileSync(new URL('../src/apps/launcher/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('installedApps reads the live rail icon, falling back to the app icon', () => {
  const start = shell.indexOf('export function installedApps(');
  const body = shell.slice(start, shell.indexOf('\n}\n', start));
  assert.ok(start > 0, 'installedApps() exists');
  assert.match(body, /ownBtns\.get\(a\.id\)\?\.querySelector\('\.ri-icon'\)\?\.innerHTML \|\| a\.icon/);
});

test('the Apps grid tiles come from installedApps', () => {
  assert.match(launcher, /installedApps\(\)/);
});
