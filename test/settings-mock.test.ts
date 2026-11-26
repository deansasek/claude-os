// The Settings mock: the profile and "Your Claude" text are kept for the session, the PIN reads as not set, and the
// welcome can be marked done. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/settings/web/mock.ts';

test('the profile and instructions are saved for the session', () => {
  const p = answerMock('POST', '/api/settings/profile', { nickname: 'Sam' }).body as { nickname: string };
  assert.equal(p.nickname, 'Sam');
  assert.equal((answerMock('GET', '/api/settings/profile').body as { nickname: string }).nickname, 'Sam');
  answerMock('POST', '/api/settings/instructions', { text: 'Be brief.' });
  assert.deepEqual(answerMock('GET', '/api/settings/instructions').body, { text: 'Be brief.' });
});

test('no PIN is set, so the lock opens', () => {
  assert.deepEqual(answerMock('GET', '/api/settings/pin').body, { set: false, lockedFor: 0, fingerprint: null });
});

test('the welcome can be marked done', () => {
  assert.deepEqual(answerMock('POST', '/api/settings/welcome', { done: true }).body, { done: true });
});
