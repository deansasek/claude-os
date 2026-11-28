// Leaving the Claude Sessions screen closes its menu, confirm, replace text and photo (src/apps/claude/web/reply.ts closeSession,
// src/apps/claude/web/sessions/manage.ts). The app is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('closing the Sessions screen also closes its menu, confirm and photo', () => {
  const reply = readFileSync(new URL('../src/apps/claude/web/reply.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const manage = readFileSync(new URL('../src/apps/claude/web/sessions/manage.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = reply.indexOf('export function closeSession(): void {');
  const body = reply.slice(start, reply.indexOf('\n}\n', start));
  assert.match(body, /closeSessionMenu\(\); \$\('ncConfirm'\)\.hidden = true; replaceText = null; hidePhoto\(\);/);
  assert.match(manage, /export function closeSessionMenu\(\): void \{ close\(\); \}/);
});
