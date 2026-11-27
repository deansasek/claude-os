// The Claude app's usage poll gives up on a usage read the PC never answers, before the next poll is due
// (src/apps/claude/web/index.ts load). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the usage read has a timeout that is shorter than the 10 s poll', () => {
  assert.match(src, /const USAGE_TIMEOUT_MS = 8e3;/);
  assert.match(src, /getJson<Usage>\('\/api\/claude\/usage', USAGE_TIMEOUT_MS\)/);
  assert.match(src, /setTimeout\(loop, busy \? 3e3 : 10e3\);/);
});
