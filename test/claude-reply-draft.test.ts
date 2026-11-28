// A reply draft stays with the session it was typed in (src/apps/claude/web/reply.ts typeReply). The app is DOM code, so this
// reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('typeReply keeps the session id it was opened for, not the one open when the keyboard closes', () => {
  const src = readFileSync(new URL('../src/apps/claude/web/reply.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function typeReply(): void {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /const session = openId;/);
  assert.match(body, /onClose: \(reason, text\) => \{ if \(reason !== 'done'\) replyDraft = \{ id: session, text \}; \},/);
});
