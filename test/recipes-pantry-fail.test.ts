// The pantry search when the full recipes cannot load: an error, not "no recipes use these". The network is stubbed.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/apps/recipes/server/index.ts';

test('when every full recipe fails to load, the pantry search is an error', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('filter.php')) return new Response(JSON.stringify({ meals: [{ idMeal: '1', strMeal: 'Sample' }] }), { headers: { 'Content-Type': 'application/json' } });
    throw new TypeError('network down');
  }) as typeof fetch;
  try {
    const route = app.routes.find(r => r.path === 'pantry')!;
    const r = await route.handle({ query: new URLSearchParams('have=onion&want=') } as never) as { status: string; recipes: unknown[] };
    assert.equal(r.status, 'error');
    assert.deepEqual(r.recipes, []);
  } finally {
    globalThis.fetch = real;
  }
});
