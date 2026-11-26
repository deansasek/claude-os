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

test('openSheet tracks a failed read and paintList shows the read-failed message', () => {
  assert.match(fn('openSheet'), /launchOk = false/);
  assert.match(fn('paintList'), /Couldn’t read the tablet’s apps\. Close this and try again\./);
});
