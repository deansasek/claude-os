// The search and random routes when TheMealDB cannot be reached: a fixed message, never the raw error text. The network is stubbed.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/apps/recipes/server/index.ts';

const FIXED = 'TheMealDB did not answer. Try again.';

test('when TheMealDB cannot be reached, search shows the fixed message', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  try {
    const route = app.routes.find(r => r.path === 'search')!;
    const r = await route.handle({ query: new URLSearchParams('q=chicken') } as never) as { status: string; error: string };
    assert.equal(r.status, 'error');
    assert.equal(r.error, FIXED);
    assert.ok(!r.error.includes('fetch failed'));
  } finally {
    globalThis.fetch = real;
  }
});

test('when TheMealDB cannot be reached, the random path shows the fixed message', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  try {
    const route = app.routes.find(r => r.path === 'search')!;
    const r = await route.handle({ query: new URLSearchParams('q=') } as never) as { status: string; error: string };
    assert.equal(r.status, 'error');
    assert.equal(r.error, FIXED);
  } finally {
    globalThis.fetch = real;
  }
});
