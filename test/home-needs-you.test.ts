// Home's "needs you" count (src/apps/home/web/needs.ts): a session waiting for your OK counts as needs you.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busyOf, needsYou, type NeedSession } from '../src/apps/home/web/needs.ts';

const s = (id: string | null, state: string, age = 3): NeedSession => ({ id, state, age });

test('a session waiting for its turn needs you, within 15 min', () => {
  assert.deepEqual(needsYou([s('a', 'waiting', 90), s('b', 'waiting', 16 * 60)], []), [s('a', 'waiting', 90)]);
});

test('a working session whose turn waits for your OK needs you, and is not busy', () => {
  const sessions = [s('a', 'tool'), s('b', 'thinking'), s('c', 'tool')];
  const turns = [{ sessionId: 'a', status: 'approval' }, { sessionId: 'c', status: 'running' }];
  assert.deepEqual(needsYou(sessions, turns), [s('a', 'tool')]);
  assert.deepEqual(busyOf(sessions, turns), [s('b', 'thinking'), s('c', 'tool')]);
});

test('a session with no id, or a stalled one, does not need you', () => {
  assert.deepEqual(needsYou([s(null, 'waiting', 3), s('x', 'stalled', 3)], [{ sessionId: 'x', status: 'running' }]), []);
});
