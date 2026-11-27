// A News topic save gives up on a PC that does not answer, and a late older read or save does not undo a newer topic choice
// (src/apps/news/web/index.ts saveTopic, loadTopics). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/news/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const save = slice('async function saveTopic(');
const load = slice('async function loadTopics(');

test('the topic save has the news timeout', () => {
  assert.match(save, /postJson<\{ ok: boolean \}>\('\/api\/news\/topics', \{ id, on \}, NEWS_TIMEOUT_MS\)/);
});

test('each save takes the next number, and a save or read that is no longer the newest changes nothing', () => {
  assert.match(save, /const seq = \+\+topicsSeq;/);
  assert.match(save, /if \(topicSeq\.get\(id\) !== seq\) return;/);
  assert.match(load, /const seq = \+\+topicsSeq;/);
  assert.equal((load.match(/if \(seq !== topicsSeq\) return;/g) ?? []).length, 2, 'the read checks on both paths');
});

test('a failed topics read still marks the topics as failed', () => {
  assert.match(load, /topicsFailed = true;/);
});
