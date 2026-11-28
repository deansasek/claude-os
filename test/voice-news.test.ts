// Top headlines by voice (src/core/web/voice-news.ts, wired in voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newsSay, newsWord } from '../src/core/web/voice-news.ts';
import { matchOpenApp } from '../src/core/web/voice-open.ts';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the headline phrases are heard, and "news" alone is still an app to open', () => {
  assert.equal(newsWord("what's the news"), true);
  assert.equal(newsWord("what's in the news"), true);
  assert.equal(newsWord('read me the headlines'), true);
  assert.equal(newsWord('news headlines'), true);
  assert.equal(newsWord('news'), false);
  assert.equal(matchOpenApp('open news')?.id, 'news');
});

test('the reply says the top three titles, with no doubled full stops', () => {
  assert.equal(newsSay(['Rain on Monday.', 'Trains delayed', 'New park opens!', 'Fourth story']), 'Top headlines: Rain on Monday; Trains delayed; and New park opens.');
  assert.equal(newsSay(['Only one']), 'Top headlines: Only one.');
});

test('a story carried by two feeds is said once, and the next title moves up', () => {
  assert.equal(newsSay(['Storm hits coast', 'storm  hits coast', 'Trains delayed', 'New park opens']), 'Top headlines: Storm hits coast; Trains delayed; and New park opens.');
});

test('the voice reads the News feed and says so when it cannot', () => {
  assert.match(voice, /if \(newsWord\(t\)\) \{/);
  assert.match(voice, /getJson<NewsFeedResponse>\('\/api\/news\/feed', READ_TIMEOUT_MS\)/);
  assert.match(voice, /I can’t get the news right now\./);
});
