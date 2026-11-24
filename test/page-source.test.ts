// The pageSource setting the tablet loader reads (android/src/hub/kiosk/PageAssets.java). The APK has no JVM test
// harness, so this checks the Java source text: the default is bundle, and the parser accepts pc, auto and bundle.
// The rule below mirrors PageAssets.sourceOf. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const HUB = path.resolve(import.meta.dirname, '..');
const java = fs.readFileSync(path.join(HUB, 'android', 'src', 'hub', 'kiosk', 'PageAssets.java'), 'utf8');

/** The rule PageAssets.sourceOf applies: trimmed, lower case; pc, auto and bundle pass; anything else is bundle. */
function sourceOf(raw: string | null | undefined): string {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'pc' || v === 'auto' || v === 'bundle' ? v : 'bundle';
}

test('the default page source is bundle: the tablet starts from the page in the APK', () => {
  assert.match(java, /static final String DEFAULT_SOURCE = SOURCE_BUNDLE;/);
  assert.doesNotMatch(java, /static final String DEFAULT_SOURCE = SOURCE_PC;/);
  assert.equal(sourceOf(undefined), 'bundle');
  assert.equal(sourceOf(null), 'bundle');
});

test('pc, auto and bundle are the three values; pc still selects the PC page', () => {
  assert.match(java, /static final String SOURCE_PC = "pc";/);
  assert.match(java, /static final String SOURCE_AUTO = "auto";/);
  assert.match(java, /static final String SOURCE_BUNDLE = "bundle";/);
  assert.match(java, /if \(SOURCE_PC\.equals\(v\) \|\| SOURCE_AUTO\.equals\(v\) \|\| SOURCE_BUNDLE\.equals\(v\)\) return v;/);
  assert.equal(sourceOf('pc'), 'pc');
  assert.equal(sourceOf('auto'), 'auto');
  assert.equal(sourceOf('bundle'), 'bundle');
});

test('the value is trimmed and case-insensitive; an unknown value is the default, bundle', () => {
  assert.match(java, /raw == null \? "" : raw\.trim\(\)\.toLowerCase\(Locale\.ROOT\)/);
  assert.equal(sourceOf(' Bundle '), 'bundle');
  assert.equal(sourceOf(' PC '), 'pc');
  assert.equal(sourceOf('bundel'), 'bundle');
  assert.equal(sourceOf(''), 'bundle');
});

test('with no bundle in the APK, bundle and auto fall back to pc', () => {
  const body = activity.match(/private String pageSourceFor\(String raw\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.notEqual(body, '');
  assert.match(body, /if \(PageAssets\.SOURCE_PC\.equals\(src\) \|\| pageAssets\.hasBundle\(\)\) return src;/);
  assert.match(body, /return PageAssets\.SOURCE_PC;/);
  assert.match(activity, /pageSource = pageSourceFor\(prefs\.getString\("pageSource", null\)\);/);
});

// The auto fallback lives in MainActivity.java. The APK has no JVM test harness, so these checks read the Java text
// and confirm the rule is there: auto shows the bundle when the PC page fails, the probe brings the PC back, and
// the 7-tap escape works on the bundled page too. The Java itself is not compiled or run by this test.
const activity = fs.readFileSync(path.join(HUB, 'android', 'src', 'hub', 'kiosk', 'MainActivity.java'), 'utf8');

test('a failed PC page falls back to the bundle only in auto, and otherwise shows the offline screen', () => {
  assert.match(activity, /private void pcPageFailed\(\) \{[\s\S]*?if \(!PageAssets\.SOURCE_AUTO\.equals\(pageSource\) \|\| !pageAssets\.hasBundle\(\)\) \{ showOffline\(\); return; \}/);
  assert.match(activity, /bundleFallback = true;[\s\S]*?loadHub\(\);[\s\S]*?ui\.postDelayed\(this::probe, 5000\);/);
  // both main-frame failures (network error and 5xx) go through pcPageFailed
  assert.equal(activity.match(/if \(r\.isForMainFrame\(\)[^\n]*pcPageFailed\(\);/g)?.length, 2);
  assert.doesNotMatch(activity, /isForMainFrame\(\)\) showOffline\(\);/);
});

test('the first load that never boots falls back to the bundle in auto, once', () => {
  assert.match(activity, /if \(firstLoad && !bundleFallback && PageAssets\.SOURCE_AUTO\.equals\(pageSource\) && pageAssets\.hasBundle\(\)\) \{/);
  assert.match(activity, /firstLoad = false;[\s\S]*?bundleFallback = true;/);
  assert.match(activity, /bootFails = 0; firstLoad = false; \}\);/);
});

test('the bundle serves the Hub origin in bundle, or in auto while the PC is down', () => {
  assert.match(activity, /private boolean servesBundle\(\) \{\s*return PageAssets\.SOURCE_BUNDLE\.equals\(pageSource\) \|\| \(PageAssets\.SOURCE_AUTO\.equals\(pageSource\) && bundleFallback\);/);
  assert.match(activity, /if \(u != null && servesBundle\(\) && isServer\(u\.toString\(\)\)/);
});

test('the probe loads the PC page again as soon as the PC answers', () => {
  assert.match(activity, /if \(!showingOffline && !bundleFallback\) return;/);
  assert.match(activity, /if \(ok\) \{ bundleFallback = false; loadHub\(\); \}[^\n]*\s*else ui\.postDelayed\(this::probe, 5000\);/);
});

test('the 7-tap escape to maintenance works on the offline screen and on the bundled page', () => {
  assert.match(activity, /if \(\(showingOffline \|\| servesBundle\(\)\) && ev\.getActionMasked\(\)/);
  assert.match(activity, /if \(\+\+taps >= 7\) \{ taps = 0; maintenance\(\); \}/);
});

test('PageAssets reports whether the APK holds a bundle', () => {
  assert.match(java, /boolean hasBundle\(\) \{\s*return !files\(\)\.isEmpty\(\);/);
});
