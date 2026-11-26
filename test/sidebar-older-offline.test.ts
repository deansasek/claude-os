// The Sessions sidebar's "Show older" when the PC cannot be reached (src/apps/claude/web/sessions/history.ts):
// the folder whose page failed is remembered, so the button can say so, and a retry that works clears it. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { History, HistoryItem } from '../src/apps/claude/api.ts';

// The modules read the page's location when they load (via dom.ts); node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { historyNow, historyOlderFailed, loadHistory, loadOlder } = await import('../src/apps/claude/web/sessions/history.ts');

const item = (id: string, at: string): HistoryItem => ({ id, title: id, at, messages: 2, open: false, live: false, hub: false });
const page = (items: HistoryItem[], more: boolean): History => ({
  q: '', total: 30, archived: 0,
  groups: [{ id: 'f1', name: 'proj', count: 30, latest: items[0]!.at, more, items }],
});

test('a failed "Show older" remembers its folder; a retry that works clears it', async () => {
  const realFetch = globalThis.fetch;
  const first = [item('s1', '2026-11-23T10:00:00.000Z'), item('s2', '2026-11-23T09:00:00.000Z')];
  const older = [item('s3', '2026-11-22T10:00:00.000Z')];
  let calls = 0;
  // 1: the first page loads. 2: the older page cannot reach the PC. 3: the retry loads the older page.
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 2) throw new TypeError('fetch failed');
    return { json: async () => (calls === 1 ? page(first, true) : page(older, false)) } as unknown as Response;
  }) as typeof fetch;
  try {
    await loadHistory();
    assert.equal(historyOlderFailed(), null);

    await loadOlder('f1');
    assert.equal(historyOlderFailed(), 'f1');
    const failed = historyNow()!.groups[0]!;
    assert.deepEqual(failed.items.map(i => i.id), ['s1', 's2']);
    assert.equal(failed.more, true);

    await loadOlder('f1');
    assert.equal(historyOlderFailed(), null);
    assert.deepEqual(historyNow()!.groups[0]!.items.map(i => i.id), ['s1', 's2', 's3']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
