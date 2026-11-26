// The Photos mock: an upload shows in the list, a delete removes it and reports a missing id. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/photos/web/mock.ts';

test('an upload shows in the list, and a delete removes it', () => {
  const up = answerMock('POST', '/api/photos/upload').body as { ok: boolean; id: string };
  assert.equal(up.ok, true);
  const listed = () => (answerMock('GET', '/api/photos/list').body as { days: { photos: { id: string }[] }[] }).days.flatMap(d => d.photos.map(p => p.id));
  assert.ok(listed().includes(up.id));
  assert.deepEqual(answerMock('POST', '/api/photos/delete', { ids: [up.id, 'nope'] }).body, { ok: true, deleted: [up.id], missing: ['nope'], failed: [] });
  assert.ok(!listed().includes(up.id));
});

test('the picture file route answers not found, since the mock has no pictures', () => {
  assert.equal(answerMock('GET', '/api/photos/file', null, 'id=x').status, 404);
});
