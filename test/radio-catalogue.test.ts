// The Radio catalogue's pure choices: the allow-list of directory paths, the mirror order, the sleep timer,
// the recently played cap, the stream title and the search filters. Run with: npm test
import assert from 'node:assert/strict';
import { addSearch, browsePick } from '../src/apps/radio/web/catalogue.ts';
import { test } from 'node:test';
import type { Station } from '../src/apps/radio/api.ts';
import { RECENT_MAX, addRecent, cataloguePath, facetsFrom, filtersFrom, mirrorOrder, nextChoice, noMatchText } from '../src/apps/radio/web/catalogue.ts';
import { failMessage, icyTitle, sleepEnd, sleepLeft } from '../src/apps/radio/web/player.ts';

const st = (id: string): Station => ({ id, name: `Station ${id}`, url: `https://${id}.example/s`, country: '', codec: '', bitrate: 0 });

test('the allow-list lets only the catalogue paths through', () => {
  assert.deepEqual(cataloguePath('tags'), { kind: 'facets', facet: 'tags', path: 'tags' });
  assert.deepEqual(cataloguePath('/json/countries'), { kind: 'facets', facet: 'countries', path: 'countries' });
  assert.deepEqual(cataloguePath('languages'), { kind: 'facets', facet: 'languages', path: 'languages' });
  assert.deepEqual(cataloguePath('stations/topvote/60'), { kind: 'stations', path: 'stations/topvote/60' });
  assert.deepEqual(cataloguePath('stations/bytag/smooth jazz'), { kind: 'stations', path: 'stations/bytag/smooth%20jazz' });
  assert.deepEqual(cataloguePath('stations/bycountry/Germany'), { kind: 'stations', path: 'stations/bycountry/Germany' });
  assert.deepEqual(cataloguePath('stations/bylanguage/french'), { kind: 'stations', path: 'stations/bylanguage/french' });
  for (const bad of ['stations/topvote/0', 'stations/topvote/101', 'stations/search', 'stations/byuuid/x', 'stats', 'servers',
    'stations/bytag/../../stats', 'stations/bytag/a?b=1', 'stations/bytag/', 'stations/bytag/%2e%2e', 'add', '', 42, null]) {
    assert.equal(cataloguePath(bad), null, String(bad));
  }
});

test('the mirror that last answered is tried first, then the rest in order', () => {
  const m = ['a', 'b', 'c'];
  assert.deepEqual(mirrorOrder(m, null), ['a', 'b', 'c']);
  assert.deepEqual(mirrorOrder(m, 'b'), ['b', 'a', 'c']);
  assert.deepEqual(mirrorOrder(m, 'c'), ['c', 'a', 'b']);
  assert.deepEqual(mirrorOrder(m, 'gone'), ['a', 'b', 'c']);
});

test('the sleep timer ends 15, 30 or 60 minutes from now', () => {
  const now = 1_000_000;
  assert.equal(sleepEnd(now, 15), now + 15 * 60_000);
  assert.equal(sleepEnd(now, 30), now + 30 * 60_000);
  assert.equal(sleepEnd(now, 60), now + 60 * 60_000);
  assert.equal(sleepEnd(now, 0), null);
  assert.equal(sleepEnd(now, 45), null);
  assert.equal(sleepLeft(now + 14 * 60_000 + 1, now), 15);
  assert.equal(sleepLeft(now - 5, now), 0);
});

test('recently played keeps the last 20 stations, newest first, no repeats', () => {
  let list: Station[] = [];
  for (let i = 0; i < 25; i++) list = addRecent(list, st(String(i)));
  assert.equal(RECENT_MAX, 20);
  assert.equal(list.length, 20);
  assert.equal(list[0].id, '24');
  assert.equal(list[19].id, '5');
  list = addRecent(list, st('10'));
  assert.equal(list.length, 20);
  assert.equal(list[0].id, '10');
  assert.equal(list.filter(s => s.id === '10').length, 1);
});

test('the stream title comes from the ICY metadata block', () => {
  assert.equal(icyTitle("StreamTitle='Miles Davis - So What';StreamUrl='';"), 'Miles Davis - So What');
  assert.equal(icyTitle("StreamTitle='';"), '');
  assert.equal(icyTitle('nothing here'), '');
});

test('a failed station gets a clear line', () => {
  assert.match(failMessage(4), /format/);
  assert.match(failMessage(2), /not reachable/);
  assert.match(failMessage(undefined), /didn't play/);
});

test('search filters accept only known values', () => {
  assert.deepEqual(filtersFrom(new URLSearchParams('country=de&codec=aac&bitrate=128')), { country: 'DE', codec: 'AAC', bitrate: 128 });
  assert.deepEqual(filtersFrom(new URLSearchParams('country=Germany&codec=wav&bitrate=100')), { country: '', codec: '', bitrate: 0 });
  assert.equal(nextChoice([0, 64, 128], 128), 0);
  assert.equal(nextChoice(['', 'MP3'], ''), 'MP3');
});

test('an empty search says whether the words, the filters or both to change', () => {
  const none = { country: '', codec: '', bitrate: 0 };
  assert.equal(noMatchText('jazz', none), 'No stations match. Try fewer words.');
  assert.equal(noMatchText('', { ...none, codec: 'AAC' }), 'No stations match these filters. Try Any country, Any format or Any quality.');
  assert.equal(noMatchText('jazz', { ...none, bitrate: 128 }), 'No stations match. Try fewer words or fewer filters.');
});

test('genre and country lists drop empty and unsafe names, biggest first', () => {
  const got = facetsFrom([
    { name: 'jazz', stationcount: 10 }, { name: 'pop', stationcount: 50 }, { name: 'rock/pop', stationcount: 9 },
    { name: '', stationcount: 3 }, { name: 'none', stationcount: 0 },
  ], 'tags');
  assert.deepEqual(got.map(f => f.name), ['pop', 'jazz']);
  const c = facetsFrom([{ name: 'Germany', iso_3166_1: 'DE', stationcount: 5 }], 'countries');
  assert.deepEqual(c, [{ name: 'Germany', code: 'DE', count: 5 }]);
});

test('Browse all shows the eight largest genres, countries or languages, most stations first', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ name: `n${i}`, code: '', count: i }));
  const pick = browsePick(list);
  assert.equal(pick.length, 8);
  assert.equal(pick[0].name, 'n11');
  assert.equal(pick[7].name, 'n4');
});

test('recent searches keep six at most, newest first, with no repeats', () => {
  let list: string[] = [];
  for (const q of ['jazz', 'news', 'rock', 'talk', 'folk', 'soul', 'blues']) list = addSearch(list, q);
  assert.equal(list.length, 6);
  assert.equal(list[0], 'blues');
  assert.equal(list.includes('jazz'), false);
  list = addSearch(list, 'SOUL');
  assert.equal(list[0], 'SOUL');
  assert.equal(list.filter(x => x.toLowerCase() === 'soul').length, 1);
  assert.deepEqual(addSearch(list, '   '), list);
});

test('More like this uses the first tag the directory accepts, not a refused first tag', async () => {
  const { moreLikeTag } = await import('../src/apps/radio/web/catalogue.ts');
  assert.equal(moreLikeTag(['pop/rock', 'jazz']), 'jazz', 'a tag with a slash is refused, so the next one is used');
  assert.equal(moreLikeTag(['100% hits', '#fun', 'rock']), 'rock');
  assert.equal(moreLikeTag(['pop/rock', '50%']), null, 'every tag refused gives none');
  assert.equal(moreLikeTag([]), null);
  assert.equal(moreLikeTag(undefined), null);
});
