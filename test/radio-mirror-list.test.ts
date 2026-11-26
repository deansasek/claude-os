// The radio directory: a mirror that answers something other than a list is a failed mirror, not an empty directory.
// The network is stubbed. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/apps/radio/server/index.ts';

test('when every mirror answers something other than a list, the stations are an error, not an empty list', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'not a list' }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const route = app.routes.find(r => r.path === 'stations')!;
    const r = await route.handle({ query: new URLSearchParams('q=jazz') } as never) as { status: string; stations: unknown[] };
    assert.equal(r.status, 'error');
    assert.deepEqual(r.stations, []);
  } finally {
    globalThis.fetch = real;
  }
});
