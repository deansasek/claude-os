// The Radio mock: stations have the fields the app reads and https streams, the catalogue answers a station list or
// a genre list by its path, and the title route answers. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMock } from '../src/core/web/mock-api.ts';
import '../src/apps/radio/web/mock.ts';

test('the mock stations are playable https streams', () => {
  const r = answerMock('GET', '/api/radio/stations', null, 'q=jazz');
  const s = r.body as { status: string; stations: { url: string; name: string }[] };
  assert.equal(s.status, 'ok');
  assert.ok(s.stations.length > 0);
  assert.ok(s.stations.every(x => x.url.startsWith('https://') && x.name.length > 0));
});

test('the catalogue answers a station list for stations paths and genres otherwise', () => {
  const list = answerMock('GET', '/api/radio/catalogue', null, 'path=' + encodeURIComponent('stations/bytag/jazz')).body as { stations?: unknown[] };
  assert.ok(Array.isArray(list.stations));
  const genres = answerMock('GET', '/api/radio/catalogue', null, 'path=' + encodeURIComponent('tags')).body as { facets?: unknown[] };
  assert.ok(Array.isArray(genres.facets));
});

test('the title route answers a sample title', () => {
  assert.equal(typeof (answerMock('GET', '/api/radio/title', null, 'url=x').body as { title: string }).title, 'string');
});
