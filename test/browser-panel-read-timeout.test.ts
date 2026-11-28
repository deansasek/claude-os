// The Claude panel's folder, session and Recent reads give up on a PC that does not answer, and an older Recent open does not paint
// over a newer one (src/apps/browser/web/claude-panel.ts). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/browser/web/claude-panel.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const recent = slice('async function openRecent(');

test('the folder, session and Recent reads all pass the read timeout', () => {
  assert.match(src, /list = await getJson<Project\[\]>\('\/api\/claude\/projects', READ_TIMEOUT_MS\)/);
  assert.match(slice('async function openSession('), /\(id\)\}`, READ_TIMEOUT_MS\)/);
  assert.match(recent, /getJson<History>\('\/api\/claude\/history\?limit=30', READ_TIMEOUT_MS\)/);
});

test('each Recent open takes the next number, and checks it on both paths before it paints', () => {
  assert.ok(recent.indexOf('const seq = ++recentSeq;') >= 0, 'the number is taken');
  const guards = recent.match(/if \(seq !== recentSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the failure path and the success path both check the number');
  assert.ok(recent.indexOf('if (seq !== recentSeq) return;') < recent.indexOf('el.clList.innerHTML = items'), 'the success check comes before the list is painted');
});
