// The one queue (lists.queue): a voice change queued while the Lists page holds an older queue is kept, and each flush
// removes only the entry it sent (src/apps/lists/web/local.ts queueAppend, queueRemove; queue.ts is the storage writer).
// The page and the voice write are modelled on the stored queue, as the page does it. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepOps, queueAppend, queueRemove, type Op } from '../src/apps/lists/web/local.ts';

const add = (text: string): Op => ({ path: 'add', body: { list: 'shopping', text } });

test('a change queued by voice is kept by the page\'s next queue write and sent on the next flush', () => {
  let stored: Op[] = [];
  stored = queueAppend(stored, add('Milk'));              // the page queues a change
  const pageMemory = [...stored];                          // the page holds this older queue in memory
  stored = queueAppend(stored, add('Eggs'));              // voice queues a change while the page is open
  stored = queueAppend(stored, add('Bread'));             // the page's next queue write: it reads the store first
  assert.deepEqual(stored.map(o => o.body.text), ['Milk', 'Eggs', 'Bread']);
  assert.equal(pageMemory.length, 1);                     // the page's memory was stale; the store was not

  const sent: string[] = [];
  for (let op = stored[0]; op; op = stored[0]) {          // the flush: read, send, remove only the sent entry
    sent.push(String(op.body.text));
    stored = queueRemove(stored, op.key!);
  }
  assert.deepEqual(sent, ['Milk', 'Eggs', 'Bread']);
});

test('a flush removes only the entry it sent: a change queued during the flush stays', () => {
  let stored = queueAppend([], add('Milk'));
  const first = stored[0];
  stored = queueAppend(stored, add('Tea'));               // voice, while the PC answers the first entry
  stored = queueRemove(stored, first.key!);               // the flush removes what it sent
  assert.deepEqual(stored.map(o => o.body.text), ['Tea']);
});

test('an entry without a key gets one, and two entries never share a key', () => {
  const a = queueAppend([], add('A'))[0];
  const b = queueAppend([a], add('B'));
  assert.ok(a.key && b[1].key && a.key !== b[1].key);
});

test('a stored queue with a bad entry keeps the good ones and drops the rest', () => {
  const good: Op = { path: 'add', body: { list: 'shopping', text: 'Milk' }, key: 'k1' };
  assert.deepEqual(keepOps([null, good, 42, { path: 'add' }, 'x']), { ops: [good], dropped: true });
});

test('a queue of only good entries is not reported as changed', () => {
  const good: Op = { path: 'add', body: { list: 'shopping', text: 'Milk' }, key: 'k1' };
  assert.deepEqual(keepOps([good]), { ops: [good], dropped: false });
});

test('a stored value that is not an array is an empty queue', () => {
  assert.deepEqual(keepOps({ path: 'add', body: {} }), { ops: [], dropped: false });
});
