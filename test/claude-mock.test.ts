// The Claude mock: the screens read with nothing in them, and every change answers not_connected. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/claude/web/mock.ts';

test('the usage, models, projects and history read with nothing in them', () => {
  const u = answerMock('GET', '/api/claude/usage').body as { sessions: unknown[]; hourly: number[] };
  assert.deepEqual(u.sessions, []);
  assert.equal(u.hourly.length, 24);
  assert.deepEqual(answerMock('GET', '/api/claude/projects').body, []);
  assert.deepEqual(answerMock('GET', '/api/claude/history', null, 'q=').body, { q: '', total: 0, groups: [], archived: 0 });
});

test('a session reads as not found, and a reply is refused as not connected', () => {
  assert.equal((answerMock('GET', '/api/claude/session', null, 'id=x').body as { canReply: boolean }).canReply, false);
  assert.deepEqual(answerMock('POST', '/api/claude/reply', { text: 'hi' }).body, { ok: false, error: 'not_connected' });
});
