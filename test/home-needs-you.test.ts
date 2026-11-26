// Home's "needs you" count (src/apps/home/web/needs.ts): a session waiting for your OK counts as needs you.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busyOf, liveSessions, needsYou, type NeedSession } from '../src/apps/home/web/needs.ts';

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

test('a failed read gives no waiting and no busy sessions', () => {
  const usage = { sessions: [s('a', 'waiting', 3), s('b', 'tool', 3)], turns: [{ sessionId: 'c', status: 'approval' }] };
  const live = liveSessions(usage, true);
  assert.deepEqual(needsYou(live.sessions, live.turns), []);
  assert.deepEqual(busyOf(live.sessions, live.turns), []);
});

test('a good read passes the sessions and turns through unchanged', () => {
  const usage = { sessions: [s('a', 'waiting', 3), s('b', 'tool', 3)], turns: [{ sessionId: 'b', status: 'approval' }] };
  const live = liveSessions(usage, false);
  assert.deepEqual(live.sessions, usage.sessions);
  assert.deepEqual(live.turns, usage.turns);
});
