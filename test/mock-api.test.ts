// The mock layer: routes an app defines answer requests, a route with no mock answers 404, and only /api paths are
// answered. Pure: the test runs mock-api.ts in Node, without the page or fetch. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock, defineMock, hasMock, isApiPath } from '../src/core/web/mock-api.ts';

defineMock({
  'GET /api/mocktest/list': () => ({ items: ['a', 'b'] }),
  'POST /api/mocktest/save': ({ body }) => ({ status: 201, body: { saved: body } }),
});

test('a defined route answers with its value, as status 200', () => {
  assert.deepEqual(answerMock('GET', '/api/mocktest/list'), { status: 200, body: { items: ['a', 'b'] } });
});

test('a handler can choose its own status and body', () => {
  assert.deepEqual(answerMock('POST', '/api/mocktest/save', { x: 1 }), { status: 201, body: { saved: { x: 1 } } });
});

test('a route with no mock answers 404 with ok false', () => {
  const r = answerMock('GET', '/api/mocktest/none');
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { ok: false, error: 'no mock for GET /api/mocktest/none' });
});

test('the method matters: a GET mock does not answer a POST', () => {
  assert.equal(answerMock('POST', '/api/mocktest/list').status, 404);
});

test('hasMock reports defined routes only', () => {
  assert.equal(hasMock('get', '/api/mocktest/list'), true);
  assert.equal(hasMock('GET', '/api/mocktest/none'), false);
});

test('only /api paths belong to the mock', () => {
  assert.equal(isApiPath('/api/core/version'), true);
  assert.equal(isApiPath('/src/apps/clock/view.html'), false);
});
