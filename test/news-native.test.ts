// The native feed read (android NewsFetch.java and the Bridge.newsFetch gate): the two feed hosts only, https only,
// an 8 second limit, a 1 MB cap, redirects only to the same host, and no read on the main thread. Source-text checks,
// because the Android build does not run here. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FEEDS } from '../src/apps/news/web/feeds.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const java = fs.readFileSync(path.join(here, '../android/src/hub/kiosk/NewsFetch.java'), 'utf8');
const bridge = fs.readFileSync(path.join(here, '../android/src/hub/kiosk/Bridge.java'), 'utf8');
const hosts = [...(/HOSTS = new HashSet<>\(Arrays\.asList\(([^)]*)\)\)/.exec(java)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1]);

test('the allowlist names only the two feed hosts, and every feed is on it over https', () => {
  assert.deepEqual(hosts.sort(), ['feeds.bbci.co.uk', 'feeds.npr.org']);
  for (const feed of FEEDS) {
    const u = new URL(feed.url);
    assert.equal(u.protocol, 'https:');
    assert.ok(hosts.includes(u.host), `${u.host} is on the allowlist`);
  }
  assert.match(java, /"https"\.equalsIgnoreCase\(u\.getProtocol\(\)\)/);
  assert.match(java, /u\.getPort\(\) != 443/);
});

test('the read is capped at 1 MB and limited to 8 seconds', () => {
  assert.match(java, /MAX_BYTES = 1024 \* 1024;/);
  assert.match(java, /out\.size\(\) \+ n > MAX_BYTES/);
  assert.match(java, /TIMEOUT_MS = 8000;/);
  assert.match(java, /task\.get\(TIMEOUT_MS, TimeUnit\.MILLISECONDS\)/);
});

test('a redirect is followed only to the same host, and the read is off the main thread', () => {
  assert.match(java, /setInstanceFollowRedirects\(false\)/);
  assert.match(java, /next\.getHost\(\)\.equalsIgnoreCase\(url\.getHost\(\)\)/);
  assert.match(java, /new Thread\(task, "news-fetch"\)/);
  assert.doesNotMatch(java, /runOnUiThread/);
  assert.match(java, /USER_AGENT = "ClaudeOS-news";/);
});

test('the Bridge method refuses unless the Hub page is allowed, then calls NewsFetch', () => {
  assert.match(bridge, /public String newsFetch\(String url\) \{\s*if \(!allowed\) return DENIED;\s*return NewsFetch\.fetch\(url\);/);
});
