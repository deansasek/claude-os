// Claude's radio_search tool lists the stations a search finds (src/apps/radio/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { radioSearchReply } from '../src/apps/radio/server/tools.ts';

const station = (name: string, extra: object = {}) => ({ id: name, name, url: 'https://example.test/s', country: 'Canada', codec: 'MP3', bitrate: 128, ...extra }) as never;
const found = (list: unknown[]) => async () => ({ status: 'ok', stations: list }) as never;

test('each station comes with its country, codec, bitrate and tags, up to the count asked', async () => {
  const r = await radioSearchReply({ q: 'jazz', count: 2 }, found([
    station('Smooth FM', { tags: ['jazz', 'smooth jazz', 'easy', 'lounge'] }),
    station('Late Night', { codec: '', bitrate: 0, country: 'Germany' }),
    station('Third'),
  ]));
  assert.equal(r.content[0].text, 'Smooth FM (Canada, MP3 128 kbps, jazz, smooth jazz, easy)\nLate Night (Germany)');
});

test('no match says so, and a failed search says it could not be read', async () => {
  const none = await radioSearchReply({ q: 'zzz' }, found([]));
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /No radio stations match “zzz”/);
  const failed = await radioSearchReply({ q: 'jazz' }, async () => ({ status: 'error', stations: [], error: 'down' }) as never);
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /couldn’t be read/);
});

test('the tool is wired into each session, and its approval card has plain words', () => {
  const tools = readFileSync(new URL('../src/apps/radio/server/tools.ts', import.meta.url), 'utf8');
  const turns = readFileSync(new URL('../src/apps/claude/server/turns.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tools.includes("tool('radio_search',"));
  assert.ok(turns.includes('claudeos_radio: radioServer'));
  assert.ok(cards.includes("'mcp__claudeos_radio__radio_search': { now: 'Search radio stations', past: 'Searched radio stations', doing: 'Searching radio stations' },"));
});
