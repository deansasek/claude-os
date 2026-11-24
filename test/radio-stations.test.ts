// The Radio app keeps only https streams. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpsUrl, playable, playableStations, stationFrom } from '../src/apps/radio/web/stations.ts';

test('only an https address plays', () => {
  assert.equal(httpsUrl('https://radio.example.org/stream'), 'https://radio.example.org/stream');
  assert.equal(httpsUrl('http://radio.example.org/stream'), null);
  assert.equal(httpsUrl('rtmp://radio.example.org/live'), null);
  assert.equal(httpsUrl('javascript:alert(1)'), null);
  assert.equal(httpsUrl('not a url'), null);
  assert.equal(httpsUrl(42), null);
});

test('records keep only the https streams and the resolved address wins', () => {
  const records = [
    { stationuuid: 'a', name: ' Jazz FM ', url: 'http://old.example/jazz', url_resolved: 'https://jazz.example/live', codec: 'mp3', bitrate: 128.4 },
    { stationuuid: 'b', name: 'Plain Http', url: 'http://plain.example/stream', url_resolved: 'http://plain.example/stream' },
    { stationuuid: 'c', name: 'Secure Only', url: 'https://secure.example/only' },
    { stationuuid: 'd', name: '', url: 'https://nameless.example/stream' },
  ];
  const got = playableStations(records);
  assert.deepEqual(got.map(s => s.id), ['a', 'c']);
  assert.equal(got[0].url, 'https://jazz.example/live');
  assert.equal(got[0].name, 'Jazz FM');
  assert.equal(got[0].codec, 'MP3');
  assert.equal(got[0].bitrate, 128);
  assert.equal(got[1].bitrate, 0);
});

test('a station with no playable stream is dropped', () => {
  assert.equal(stationFrom({ stationuuid: 'x', name: 'No Stream', url: 'ftp://files.example/x' }), null);
  assert.equal(stationFrom(null), null);
});

test('saved favourites are checked again before they play', () => {
  const saved = [
    { id: 'ok', name: 'Good', url: 'https://good.example/s', country: 'DE', codec: 'AAC', bitrate: 96 },
    { id: 'bad', name: 'Bad', url: 'http://bad.example/s', country: '', codec: '', bitrate: 0 },
  ];
  assert.deepEqual(playable(saved).map(s => s.id), ['ok']);
});
