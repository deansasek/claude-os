// The Settings > Browser > History row must disable its Clear action when there is no history
// (src/apps/browser/web/index.ts, historyRows()). The settings row is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/browser/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the History row disables Clear when the history is empty', () => {
  const start = src.indexOf('function historyRows(): SettingRow[] {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /disabled: \(\) => !S\.history\.length/);
});
