// Opening an app's settings page clears the Android app list under it (src/apps/settings/web/index.ts, the stApps click
// handler in bindApps). The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('a tap on an app row repaints the Android app list too, so it clears under the app page', () => {
  const line = src.split('\n').find(l => l.includes('if (appBtn && !open) {'));
  assert.ok(line, 'the app-row tap branch exists');
  assert.ok(line.indexOf('paintApps();') > 0, 'the branch repaints the app list');
  assert.ok(line.indexOf('paintTabApps();') > line.indexOf('paintApps();'), 'and then repaints the Android list');
});
