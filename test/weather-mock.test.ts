// The Weather mock: its forecast has the shape the app reads (matching list lengths) and the places route answers.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/weather/web/mock.ts';

test('the mock forecast has one value per hour and per day in every list', () => {
  const r = answerMock('GET', '/api/weather/forecast');
  assert.equal(r.status, 200);
  const w = r.body as { status: string; hourly: Record<string, unknown[]>; daily: Record<string, unknown[]> };
  assert.equal(w.status, 'ok');
  for (const [k, list] of Object.entries(w.hourly)) assert.equal(list.length, 24, `hourly.${k}`);
  for (const [k, list] of Object.entries(w.daily)) assert.equal(list.length, 7, `daily.${k}`);
});

test('the mock places route answers with one sample place', () => {
  const r = answerMock('GET', '/api/weather/places');
  assert.deepEqual((r.body as { results: unknown[] }).results.length, 1);
});
