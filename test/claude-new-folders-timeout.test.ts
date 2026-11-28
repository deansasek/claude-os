// The New session folder read gives up on a PC that does not answer, and an earlier open's late answer does not replace the list
// (src/apps/claude/web/reply.ts openNew). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/reply.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('export async function openNew(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the read timeout is at most 30 seconds, and the folder read passes it', () => {
  const m = src.match(/const READ_TIMEOUT_MS = ([\d.e]+);/);
  assert.ok(m && Number(m[1]) > 0 && Number(m[1]) <= 30e3, 'READ_TIMEOUT_MS is set');
  assert.match(body, /getJson<Project\[\]>\('\/api\/claude\/projects', READ_TIMEOUT_MS\)/);
});

test('the catch still marks the folders failed, and an earlier open returns before the list is set', () => {
  assert.match(body, /catch \{ if \(seq !== foldersSeq\) return; projects = \[\]; foldersFailed = true; \}/);
  assert.ok(body.indexOf('if (seq !== foldersSeq) return;') < body.indexOf('projects = p;'), 'the check comes before the list is set');
});
