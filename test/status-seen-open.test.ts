// A notice that arrives while the notification shade is open is seen, so no unread dot follows it (src/core/web/status.ts).
// status.ts loads the page's DOM, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/status.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('a notification change marks the notices seen while the shade is open, before it recomputes', () => {
  const line = src.split('\n').find(l => l.includes('onNotificationsChange(() =>'));
  assert.ok(line, 'the notification handler exists');
  const seen = line.indexOf('if (controlCenterOpen()) markSeen();');
  assert.ok(seen > 0, 'the open shade marks the notices seen');
  assert.ok(seen < line.indexOf('recompute();'), 'before the unread count is recomputed');
});
