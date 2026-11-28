// A late older Claude usage read does not repaint the old data or flip the pill to Offline after a newer read
// (src/apps/claude/web/index.ts load). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function load(): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('load takes the next number and drops an answer that is no longer the newest', () => {
  assert.ok(start > 0, 'load() exists');
  assert.match(src, /let usageSeq = 0;/);
  assert.match(body, /const seq = \+\+usageSeq;/);
  const guards = body.match(/if \(seq !== usageSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});

test('the success path checks the number before it repaints', () => {
  const guard = body.indexOf('if (seq !== usageSeq) return;');
  const paint = body.indexOf('render(u);');
  assert.ok(guard > 0 && paint > guard, 'the number is checked before render runs');
});
