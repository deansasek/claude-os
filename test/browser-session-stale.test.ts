// A slow session reply does not paint over a newer choice in the Browser's Claude panel (src/apps/browser/web/claude-panel.ts
// openSession). The panel is DOM code, so this reads the source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/browser/web/claude-panel.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function openSession(id: string): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));
const check = 'if (sessionId !== id) return;';

test('a late session reply is dropped when a newer choice has been made', () => {
  assert.ok(start > 0, 'openSession() exists');
  assert.equal(body.split(check).length - 1, 2, 'both the failure and the success path check it');
  const fetched = body.indexOf('await getJson<SessionView>');
  assert.ok(fetched > 0 && body.indexOf(check) > fetched, 'the check comes after the reply arrives');
});
