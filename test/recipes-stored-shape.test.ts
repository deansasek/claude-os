// Saved recipes, pantry and timers that are not the right shape do not stop the Recipes page from loading. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

// the page code reads the location and localStorage when it loads; give node a stand-in for each first
Object.assign(globalThis, { window: globalThis, location: { search: '', href: 'http://localhost/' }, dispatchEvent: () => true, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } } });

// any DOM call at load returns a stand-in, so the module can run without a browser
const deep = (): any => new Proxy(function () {}, { get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : deep()), apply: () => deep(), construct: () => deep(), set: () => true });
Object.assign(globalThis, { document: deep(), matchMedia: deep(), addEventListener: () => {}, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), getComputedStyle: deep() });

function withStore(values: Record<string, string>): void {
  const data = new Map(Object.entries(values));
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) } });
}

test('stored values that are objects or strings load as empty lists', async () => {
  withStore({ 'recipes.list': '{}', 'recipes.pantry': '"x"', 'recipes.timers': '5' });
  await assert.doesNotReject(() => import(`../src/apps/recipes/web/index.ts?objects=${Date.now()}`));
});

test('null entries and timers missing a name or an end time are left out, and the page still loads', async () => {
  withStore({
    'recipes.list': JSON.stringify([null, 3, 'x']),
    'recipes.pantry': JSON.stringify([null, { name: 'onion' }]),
    'recipes.timers': JSON.stringify([null, { id: 't1', name: 'Rice' }, { id: 't2', name: 'Eggs', end: 1 }]),
  });
  await assert.doesNotReject(() => import(`../src/apps/recipes/web/index.ts?entries=${Date.now()}`));
});
