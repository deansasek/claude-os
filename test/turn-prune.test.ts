// The turn list pruning (src/apps/claude/server/turns.ts turnsToDrop): a session's latest error turn stays.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnsToDrop, type KeepTurn } from '../src/apps/claude/server/turns.ts';

const KEEP = 10 * 60e3;
const NOW = 10_000_000;
const turn = (id: string, sessionId: string, status: string, startedAt: string, finishedAt: number | null): KeepTurn =>
  ({ id, sessionId, status, startedAt, finishedAt });

test('a finished turn is dropped after KEEP, and a running turn never is', () => {
  const list = [turn('old', 'S1', 'done', '2026-01-01T00:00:00Z', NOW - KEEP - 1), turn('fresh', 'S1', 'done', '2026-01-01T00:05:00Z', NOW - KEEP + 1), turn('run', 'S2', 'running', '2026-01-01T00:00:00Z', null)];
  assert.deepEqual(turnsToDrop(list, NOW, KEEP), ['old']);
});

test('the latest error turn of a session is kept after KEEP', () => {
  const list = [turn('err', 'S1', 'error', '2026-01-02T00:00:00Z', NOW - KEEP - 1)];
  assert.deepEqual(turnsToDrop(list, NOW, KEEP), []);
});

test('an error turn is dropped once a later turn of the same session exists', () => {
  const list = [turn('err', 'S1', 'error', '2026-01-02T00:00:00Z', NOW - KEEP - 1), turn('ok', 'S1', 'done', '2026-01-03T00:00:00Z', NOW - KEEP - 2)];
  assert.deepEqual(turnsToDrop(list, NOW, KEEP), ['err', 'ok']);
});

test('an error turn with no session id is not kept', () => {
  const list = [turn('err', '', 'error', '2026-01-02T00:00:00Z', NOW - KEEP - 1)];
  assert.deepEqual(turnsToDrop(list, NOW, KEEP), ['err']);
});
