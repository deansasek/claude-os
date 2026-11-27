// A settings restore that fails partway puts every setting back as it was (src/apps/settings/web/backup.ts restoreSettings).
// The storage and the PC's backup are stubbed. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(globalThis, { location: { search: '' } });

const store = new Map<string, string>([['os.a', '0']]);
let writes = 0;
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { writes++; if (writes === 2) throw new Error('storage is full'); store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
  fetch: async () => new Response(JSON.stringify({ ok: true, saved: 'x', values: { 'os.a': '1', 'os.b': '2' } }), {
    headers: { 'Content-Type': 'application/json' },
  }),
});

const { restoreSettings } = await import('../src/apps/settings/web/backup.ts');

test('a restore that fails partway puts the first setting back as it was', async () => {
  assert.equal(await restoreSettings(), -3);
  assert.equal(store.get('os.a'), '0');
});
