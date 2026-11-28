// A late older Calendar address save does not overwrite a newer one (src/apps/calendar/web/index.ts saveAddress).
// The page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/calendar/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function saveAddress(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each address save takes the next number and drops its reply when a newer save has started', () => {
  assert.ok(start > 0, 'saveAddress() exists');
  assert.match(src, /let saveSeq = 0;/);
  assert.match(body, /const seq = \+\+saveSeq;/);
  const post = body.indexOf('postJson<CalConfigResult>');
  const guard = body.indexOf('if (seq !== saveSeq) return;');
  assert.ok(guard > post && post > 0, 'the guard comes after the POST and before the reply is applied');
  assert.ok(guard < body.indexOf('if (r) {'), 'the guard comes before the reply is applied');
});
