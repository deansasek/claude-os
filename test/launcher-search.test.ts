// The Apps screen search matcher (src/apps/launcher/web/search.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, score, searchAll, type SearchSources } from '../src/apps/launcher/web/search.ts';

const src: SearchSources = {
  apps: [{ key: 'c:photos', name: 'Photos' }, { key: 'a:com.google.android.gm', name: 'Gmail' }],
  lists: [{ id: 'shopping', name: 'Shopping', items: ['Milk', 'Wi-Fi router batteries'] }],
  sessions: [{ id: 's1', title: 'Garden planning', folder: 'Notes' }],
};

test('normalize ignores case, apostrophes and dashes', () => {
  assert.equal(normalize('  Wi‑Fi  '), 'wi fi');
  assert.equal(normalize('Don’t'), 'dont');
});

test('score ranks a prefix above a word start above a plain contains', () => {
  assert.equal(score('pho', 'Photos'), 3);
  assert.equal(score('bat', 'Wi-Fi router batteries'), 2);
  assert.equal(score('ter', 'Wi-Fi router batteries'), 1);
  assert.equal(score('xyz', 'Photos'), 0);
  assert.equal(score('', 'Photos'), 0);
});

test('a query without spaces finds a dashed name', () => {
  assert.equal(score('wifi', 'Wi-Fi'), 3);
  const wifi = searchAll('wifi', src).map(h => [h.kind, h.label]);
  assert.deepEqual(wifi, [['setting', 'Wi-Fi'], ['item', 'Wi-Fi router batteries']]);
});

test('an empty query finds nothing', () => {
  assert.deepEqual(searchAll('   ', src), []);
});

test('searchAll finds apps, Settings rows, lists, list items and sessions by name', () => {
  const app = searchAll('photo', src);
  assert.deepEqual(app.map(h => [h.kind, h.label, h.ref]), [['app', 'Photos', 'c:photos']]);

  const wifi = searchAll('wi-fi', src).map(h => [h.kind, h.label]);
  assert.deepEqual(wifi, [['setting', 'Wi-Fi'], ['item', 'Wi-Fi router batteries']]);

  assert.deepEqual(searchAll('shop', src).map(h => [h.kind, h.label, h.ref]), [['list', 'Shopping', 'shopping']]);
  assert.deepEqual(searchAll('milk', src).map(h => [h.kind, h.sub]), [['item', 'In Shopping']]);
  assert.deepEqual(searchAll('garden', src).map(h => [h.kind, h.ref]), [['session', 's1']]);
});

test('a better match comes first, and a tie keeps apps before Settings', () => {
  const hits = searchAll('g', src);
  assert.equal(hits[0].kind, 'app');   // "Gmail" starts with g
  const ties = searchAll('sound', src);
  assert.equal(ties[0].label, 'Sound');
});
