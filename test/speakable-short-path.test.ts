// A short file path is spoken as its file name (src/apps/claude/web/voice.ts speakable). voice.ts loads the page's window,
// so this checks its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/claude/web/voice.ts', import.meta.url), 'utf8');

test('speakable keeps only the file name of a one-slash path', () => {
  assert.ok(src.includes("\\w{0,4})\\b/g, '$1')"), 'the short-path rule is in speakable()');
});
