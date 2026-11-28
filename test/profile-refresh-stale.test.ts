// The profile refresh gives up on a PC that does not answer, and a read from before a save does not undo the saved name or photo
// (src/core/web/profile.ts). The module runs a refresh when it loads, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/profile.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const apply = slice('export function applyProfile(');
const refresh = slice('export async function refreshProfile(');

test('the profile read has a timeout', () => {
  assert.match(src, /const PROFILE_READ_TIMEOUT_MS = 20e3;/);
  assert.match(refresh, /getJson<Profile>\('\/api\/settings\/profile', PROFILE_READ_TIMEOUT_MS\)/);
});

test('every applied profile bumps the counter, and a read applies only if nothing applied since it started', () => {
  assert.match(apply, /profileGen\+\+;/);
  assert.ok(refresh.indexOf('const gen = profileGen;') > 0, 'the counter is taken before the read');
  assert.ok(refresh.indexOf('const gen = profileGen;') < refresh.indexOf('await getJson'), 'taken before the await');
  assert.ok(refresh.indexOf('if (gen === profileGen) applyProfile(p);') > 0, 'the guard applies only the current read');
});
