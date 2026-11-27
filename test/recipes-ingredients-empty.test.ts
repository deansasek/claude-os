// The ingredient list: an empty answer from TheMealDB is an error, and is not kept, so a later good answer shows. The network is stubbed.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/apps/recipes/server/index.ts';

test('an empty ingredient answer is an error, and the next good answer is shown', async () => {
  const real = globalThis.fetch;
  const route = app.routes.find(r => r.path === 'ingredients')!;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ meals: null }), { status: 200 })) as typeof fetch;
    const bad = await route.handle({} as never) as { status: string; error?: string };
    assert.equal(bad.status, 'error');
    assert.ok(bad.error);

    globalThis.fetch = (async () => new Response(JSON.stringify({ meals: [{ strIngredient: 'Egg' }] }), { status: 200 })) as typeof fetch;
    const good = await route.handle({} as never);
    assert.deepEqual(good, { status: 'ok', names: ['Egg'] });
  } finally {
    globalThis.fetch = real;
  }
});
