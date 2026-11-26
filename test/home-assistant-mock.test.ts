// The Home Assistant mock: the made-up house reads, a light switches for the session, a sensor cannot be switched,
// and the connect test says it is not set up. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/home-assistant/web/mock.ts';

test('the dashboard lists the made-up house, and a light switches for the session', () => {
  const dash = answerMock('GET', '/api/home-assistant/layout').body as { layout: { rooms: { id: string }[] } };
  assert.ok(dash.layout.rooms.length > 0);
  const on = answerMock('POST', '/api/home-assistant/toggle', { entity_id: 'light.living_room', on: true }).body as { ok: boolean; entity: { on: boolean } };
  assert.equal(on.ok, true);
  assert.equal(on.entity.on, true);
});

test('a sensor cannot be switched, and the connect test says it is not set up', () => {
  assert.equal((answerMock('POST', '/api/home-assistant/toggle', { entity_id: 'sensor.hall_temperature', on: true }).body as { ok: boolean }).ok, false);
  assert.equal((answerMock('POST', '/api/home-assistant/test').body as { ok: boolean }).ok, false);
});
