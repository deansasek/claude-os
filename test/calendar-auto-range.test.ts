// The timer's range request (auto=1) never makes a connector read (range-merge.ts connectorForRange). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectorForRange, type ConnectorRead } from '../src/apps/calendar/server/range-merge.ts';

const fresh: ConnectorRead = { status: 'ok', events: [] };

function spies(cached: ConnectorRead | null) {
  const calls = { cached: 0, read: 0 };
  const src = {
    cached: () => { calls.cached++; return cached; },
    read: async (): Promise<ConnectorRead> => { calls.read++; return { status: 'ok', events: [] }; },
  };
  return { src, calls };
}

test('an automatic range request never calls the connector read, on a cache miss', async () => {
  const { src, calls } = spies(null);
  const r = await connectorForRange('today', true, src);
  assert.equal(r, null);
  assert.equal(calls.read, 0);
});

test('an automatic range request uses only a fresh cached read', async () => {
  const { src, calls } = spies(fresh);
  const r = await connectorForRange('tomorrow', true, src);
  assert.equal(r, fresh);
  assert.equal(calls.read, 0);
  assert.equal(calls.cached, 1);
});

test('a user request may call the connector read', async () => {
  const { src, calls } = spies(null);
  const r = await connectorForRange('today', false, src);
  assert.equal(r?.status, 'ok');
  assert.equal(calls.read, 1);
  assert.equal(calls.cached, 0);
});

test('a range that is not one connector day never reads, for a user or an automatic request', async () => {
  const { src, calls } = spies(fresh);
  assert.equal(await connectorForRange(null, false, src), null);
  assert.equal(await connectorForRange(null, true, src), null);
  assert.equal(calls.read, 0);
});
