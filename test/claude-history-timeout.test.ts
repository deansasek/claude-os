// The Claude sessions history read gives up on a PC that does not answer, and a late older read does not mark a newer search as failed
// (src/apps/claude/web/sessions/history.ts). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/sessions/history.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const load = slice('export async function loadHistory(');
const older = slice('export async function loadOlder(');

test('the timeout is defined, and both history reads pass it', () => {
  assert.match(src, /const HISTORY_TIMEOUT_MS = 20e3;/);
  assert.match(load, /getJson<History>\(url\(\{ q, \.\.\.scope\(\) \}\), HISTORY_TIMEOUT_MS\)/);
  assert.match(older, /HISTORY_TIMEOUT_MS\); \} catch/);
});

test('a late failure of an older search checks its number before it marks the search failed', () => {
  const catchAt = load.indexOf('catch {');
  assert.ok(catchAt > 0, 'the failure path exists');
  const guard = load.indexOf('if (my !== gen) return;', catchAt);
  const failed = load.indexOf('failed = true;', catchAt);
  assert.ok(guard > catchAt && guard < failed, 'the check comes before failed is set');
});

test('the success path only clears the failure once the search is still the newest', () => {
  const check = load.indexOf('if (my !== gen) return;', load.indexOf('finally'));
  assert.ok(check > 0 && check < load.indexOf('failed = false;'), 'the check comes before failed is cleared');
});
