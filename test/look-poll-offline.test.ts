// A Look answer that cannot reach the PC while it polls says so instead of waiting silently (src/apps/camera/web/look.ts, follow).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/look.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function follow(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('a Look poll that cannot reach the PC says so', () => {
  assert.ok(start > 0, 'follow() exists');
  assert.doesNotMatch(body, /catch \{ continue; \}/, 'the failed read is not skipped silently');
  assert.match(body, /catch \{\n/, 'the failed read has its own catch block');
  assert.match(body, /I can’t reach your PC right now\. Check that it’s on and ClaudeOS is running\./, 'follow() says the PC line');
});
