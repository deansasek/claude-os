// The routines queue (routines.queue): a bad stored entry is dropped, so it cannot block the changes after it. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepOps, remapIds, type Op } from '../src/apps/routines/web/local.ts';

const good: Op = { path: 'save', body: { id: 'a', routine: { id: 'a', name: 'Morning' } } };

test('a queue with bad entries keeps only the changes', () => {
  assert.deepEqual(keepOps([null, good, 42, { path: 'save' }, 'x', { path: 'bogus', body: {} }]), { ops: [good], dropped: true });
});

test('an all-good queue is not reported as changed', () => {
  assert.deepEqual(keepOps([good]), { ops: [good], dropped: false });
});

test('a stored value that is not an array is an empty queue', () => {
  assert.deepEqual(keepOps({ path: 'save', body: {} }), { ops: [], dropped: false });
  assert.deepEqual(keepOps(null), { ops: [], dropped: false });
});

test('remapIds on the cleaned queue does not throw', () => {
  const { ops } = keepOps([null, { path: 'save', body: { id: 'a', routine: { id: 'a' } } }]);
  assert.doesNotThrow(() => remapIds(ops, 'a', 'b'));
  assert.equal(ops[0].body.id, 'b');
});
