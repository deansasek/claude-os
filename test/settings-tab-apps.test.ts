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

test('the stTabApps handler restores tabAllowed in its catch block', () => {
  const start = src.indexOf("$('stTabApps').addEventListener('click'");
  const handler = src.slice(start, src.indexOf('onAppSettingsChange(', start));
  assert.match(handler, /catch \{ tabAllowed = before; confirmSheet\('Couldn’t change it'/);
});
