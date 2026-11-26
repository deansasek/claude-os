// The mocks for the Apps layout, routines, and the settings backup: each saves for the session and reads it back.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/launcher/web/mock.ts';
import '../src/apps/routines/web/mock.ts';
import '../src/apps/settings/web/mock.ts';

test('the Apps layout is saved per screen and read back', () => {
  assert.deepEqual(answerMock('GET', '/api/launcher/layout', null, 'screen=hub').body, { ok: true, screen: 'hub', layout: null });
  answerMock('POST', '/api/launcher/layout', { screen: 'tablet', layout: { order: ['c:clock', 'c:weather'], hidden: [] } });
  assert.deepEqual((answerMock('GET', '/api/launcher/layout', null, 'screen=tablet').body as { layout: { order: string[] } }).layout.order, ['c:clock', 'c:weather']);
  assert.equal((answerMock('POST', '/api/launcher/layout', { screen: 'tablet', layout: { order: 'x' } }).body as { ok: boolean }).ok, false);
});

test('a routine is saved, listed, and deleted', () => {
  const saved = answerMock('POST', '/api/routines/save', { routine: { name: 'Morning', phrases: ['good morning'], steps: [] } }).body as { ok: boolean; id: string };
  assert.equal(saved.ok, true);
  const listed = () => (answerMock('GET', '/api/routines/list').body as { routines: { id: string }[] }).routines.map(r => r.id);
  assert.ok(listed().includes(saved.id));
  answerMock('POST', '/api/routines/delete', { id: saved.id });
  assert.ok(!listed().includes(saved.id));
});

test('the settings backup is saved and read back', () => {
  answerMock('POST', '/api/settings/backup', { values: { theme: 'light' } });
  assert.deepEqual((answerMock('GET', '/api/settings/backup').body as { values: Record<string, string> }).values, { theme: 'light' });
});
