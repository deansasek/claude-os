// Showing the welcome again starts the Network step without an earlier Wi-Fi join's state (src/core/web/welcome.ts).
// The page is DOM code, so this reads the source of showWelcome(). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/welcome.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('showWelcome clears the Wi-Fi join state before the steps are drawn', () => {
  const start = src.indexOf('export function showWelcome(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /joining = '';\s*joinedAt = 0;\s*joinError = '';/);
});
