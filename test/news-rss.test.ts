// The News RSS parser and the newest-first sort. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, parseFeed, sortNewest } from '../src/apps/news/web/rss.ts';
import type { NewsItem } from '../src/apps/news/api.ts';

const SOURCE = { id: 'bbc', name: 'BBC News' };

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Channel title is not a story</title>
    <item>
      <title><![CDATA[Harbour <b>reopens</b> after storm]]></title>
      <link>https://www.example.com/news/harbour</link>
      <description><![CDATA[<p>Ships &amp; ferries return on Monday.</p>]]></description>
      <pubDate>Mon, 23 Nov 2026 09:30:00 GMT</pubDate>
      <media:thumbnail url="https://img.example.com/harbour.jpg?w=320&amp;h=180" width="320"/>
    </item>
    <item>
      <title>Rail &#8211; strike &#x2019;called off&#x2019;</title>
      <link>https://www.example.com/news/rail</link>
      <description>Talks &quot;ended well&quot;.</description>
      <pubDate>Tue, 24 Nov 2026 07:00:00 GMT</pubDate>
      <enclosure url="https://img.example.com/rail.png" type="image/png" length="1000"/>
    </item>
  </channel>
</rss>`;

test('an RSS item gives title, link, date, plain description and image', () => {
  const items = parseFeed(SAMPLE, SOURCE);
  assert.equal(items.length, 2);
  const [harbour, rail] = items;
  assert.equal(harbour.title, 'Harbour reopens after storm');
  assert.equal(harbour.link, 'https://www.example.com/news/harbour');
  assert.equal(harbour.id, 'https://www.example.com/news/harbour');
  assert.equal(harbour.description, 'Ships & ferries return on Monday.');
  assert.equal(harbour.published, '2026-11-23T09:30:00.000Z');
  assert.equal(harbour.image, 'https://img.example.com/harbour.jpg?w=320&h=180');
  assert.equal(harbour.source, 'BBC News');
  assert.equal(harbour.sourceId, 'bbc');
  assert.equal(rail.title, 'Rail – strike ’called off’');
  assert.equal(rail.description, 'Talks "ended well".');
  assert.equal(rail.image, 'https://img.example.com/rail.png');
});

test('an Atom entry gives its link from href and its date from published', () => {
  const atom = `<feed><entry><title>Atom story</title>
    <link rel="alternate" href="https://www.example.com/a?x=1&amp;y=2"/>
    <summary>Short.</summary><published>2026-11-22T12:00:00Z</published></entry></feed>`;
  const [item] = parseFeed(atom, SOURCE);
  assert.equal(item.link, 'https://www.example.com/a?x=1&y=2');
  assert.equal(item.description, 'Short.');
  assert.equal(item.published, '2026-11-22T12:00:00.000Z');
});

test('an item with missing fields still parses, with null or empty values', () => {
  const xml = '<rss><channel><item><title>Only a title</title></item><item><link>https://www.example.com/x</link></item></channel></rss>';
  const [titled, linked] = parseFeed(xml, SOURCE);
  assert.deepEqual(titled, {
    id: 'Only a title', title: 'Only a title', link: null, published: null,
    description: '', image: null, source: 'BBC News', sourceId: 'bbc',
  });
  assert.equal(linked.title, '');
  assert.equal(linked.link, 'https://www.example.com/x');
  assert.equal(linked.id, 'https://www.example.com/x');
});

test('an item with neither title nor link is skipped, and a bad date is null', () => {
  const xml = '<rss><item><description>No title or link</description></item>'
    + '<item><title>Bad date</title><pubDate>not a date</pubDate></item></rss>';
  const items = parseFeed(xml, SOURCE);
  assert.equal(items.length, 1);
  assert.equal(items[0].published, null);
});

test('broken XML gives no stories and never throws', () => {
  assert.deepEqual(parseFeed('<rss><channel><item><title>Cut off', SOURCE), []);
  assert.deepEqual(parseFeed('<<<not xml at all>>>', SOURCE), []);
  assert.deepEqual(parseFeed('', SOURCE), []);
  assert.deepEqual(parseFeed(undefined as unknown as string, SOURCE), []);
});

test('a broken item does not hide the good items around it', () => {
  const xml = '<rss><item><title>First</title><link>https://www.example.com/1</link></item>'
    + '<item><title>Unclosed'
    + '<item><title>Last</title><link>https://www.example.com/3</link></item></rss>';
  const titles = parseFeed(xml, SOURCE).map(item => item.title);
  assert.ok(titles.includes('First'));
  assert.ok(titles.includes('Last'));
});

test('decodeEntities handles names and numbers, and leaves unknown names alone', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x41;'), "a & b <c> 'd' A");
  assert.equal(decodeEntities('&bogus; &#99999999;'), '&bogus; &#99999999;');
});

test('sortNewest puts the newest first and undated stories last', () => {
  const make = (title: string, published: string | null): NewsItem => ({
    id: title, title, link: null, published, description: '', image: null, source: 'x', sourceId: 'x',
  });
  const sorted = sortNewest([
    make('undated A', null),
    make('old', '2026-11-20T00:00:00.000Z'),
    make('new', '2026-11-24T00:00:00.000Z'),
    make('undated B', null),
  ]).map(item => item.title);
  assert.deepEqual(sorted, ['new', 'old', 'undated A', 'undated B']);
});

test('the merge of two feeds sorts by date across sources', () => {
  const bbc = parseFeed(SAMPLE, SOURCE);
  const npr = parseFeed('<rss><item><title>NPR story</title><link>https://www.example.com/npr</link>'
    + '<pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item></rss>', { id: 'npr', name: 'NPR' });
  const titles = sortNewest([...bbc, ...npr]).map(item => `${item.sourceId}:${item.title}`);
  assert.deepEqual(titles, ['npr:NPR story', 'bbc:Rail – strike ’called off’', 'bbc:Harbour reopens after storm']);
});
