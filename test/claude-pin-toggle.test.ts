// A message pin is shown only after the PC saves it. A failed save leaves the message as it was. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/reply.ts'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function togglePin(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the pin is set on the message only after the PC answers ok', () => {
  const setAt = body.indexOf('e.pinned = on;');
  const okAt = body.indexOf('if (!ok) {');
  assert.ok(setAt > 0 && okAt > 0 && okAt < setAt, 'the failure check comes before the change');
  assert.match(body, /catch \(err\) \{ if \(\(err as Error\)\.message === 'locked_out'\) throw err; \}/, 'a locked PIN is passed on, and nothing is changed');
  assert.match(body, /flashSub\('Couldn’t pin that\. Try again\.'\)/);
});
