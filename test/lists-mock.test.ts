// The Lists mock: a session store. Add, tick, clear, make a list, and refuse to delete a built-in one; each change
// shows on the next read. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/lists/web/mock.ts';

const post = (path: string, body: unknown) => answerMock('POST', `/api/lists/${path}`, body).body as { ok: boolean; lists: { id: string; items: { id: string; text: string; done: boolean }[] }[]; error?: string };

test('add, tick and clear-done change the list the next read returns', () => {
  const added = post('add', { list: 'shopping', text: 'Eggs' });
  assert.equal(added.ok, true);
  const shop = () => (answerMock('GET', '/api/lists/lists').body as { lists: { id: string; items: { id: string; text: string; done: boolean }[] }[] }).lists.find(l => l.id === 'shopping')!;
  assert.ok(shop().items.some(i => i.text === 'Eggs'));
  const eggs = shop().items.find(i => i.text === 'Eggs')!;
  post('tick', { list: 'shopping', id: (added as unknown as { item: { id: string } }).item.id, done: true });
  assert.equal(shop().items.find(i => i.text === 'Eggs')?.done, true);
  const cleared = post('clear-done', { list: 'shopping' }) as unknown as { removed: number };
  assert.ok(cleared.removed >= 1);
  assert.ok(!shop().items.some(i => i.id === eggs.id));
});

test('a new list appears, and a built-in list cannot be deleted', () => {
  const made = post('new-list', { name: 'Garden jobs' });
  assert.ok(made.lists.some(l => l.id === 'garden-jobs'));
  assert.equal(post('delete-list', { list: 'shopping' }).ok, false);
  assert.equal(post('delete-list', { list: 'garden-jobs' }).ok, true);
});

test('an add to a list that is not there is refused', () => {
  const r = post('add', { list: 'nope', text: 'x' });
  assert.equal(r.ok, false);
});
