// The start-up retry for wireless debugging (android/src/hub/kiosk/AdbWifi.java). The APK has no JVM test harness,
// so this checks the Java source text: the delays are present, there are at most three, and the last is 90 s or less.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const HOST_DIR = path.resolve(import.meta.dirname, '..');
const adb = fs.readFileSync(path.join(HOST_DIR, 'android', 'src', 'hub', 'kiosk', 'AdbWifi.java'), 'utf8');
const main = fs.readFileSync(path.join(HOST_DIR, 'android', 'src', 'hub', 'kiosk', 'MainActivity.java'), 'utf8');

/** The delays in RETRY_MS, in ms. Underscores in Java literals are ignored. */
function retryDelays(src: string): number[] {
  const m = src.match(/static final long\[\] RETRY_MS = \{([^}]*)\};/);
  assert.ok(m, 'RETRY_MS is declared as a long array');
  return m[1].split(',').map(s => Number(s.trim().replace(/_/g, '')));
}

test('the start-up retry delays are 10 s, 30 s and 90 s', () => {
  assert.deepEqual(retryDelays(adb), [10_000, 30_000, 90_000]);
});

test('the retry list is bounded: at most three delays, the last at or below 90 s', () => {
  const delays = retryDelays(adb);
  assert.ok(delays.length >= 1 && delays.length <= 3, `got ${delays.length} delays`);
  assert.ok(delays[delays.length - 1] <= 90_000, 'last delay is 90 s or less');
  for (const d of delays) assert.ok(d > 0, 'every delay is positive');
});

test('retryAtStart posts reapply on the main looper for each delay, and only when the keep pref is on', () => {
  assert.match(adb, /static void retryAtStart\(Context c\) \{\s*if \(!keep\(c\)\) return;/);
  assert.match(adb, /new Handler\(Looper\.getMainLooper\(\)\);\s*for \(long ms : RETRY_MS\) ui\.postDelayed\(\(\) -> reapply\(app\), ms\);/);
});

test('MainActivity.onCreate starts the retries next to the existing reapply and watch calls', () => {
  assert.match(main, /AdbWifi\.reapply\(this\);[\s\S]*?AdbWifi\.watch\(this\);[^\n]*\n\s*AdbWifi\.retryAtStart\(this\);/);
});

test('the retries add no dialog, permission request or pref default change', () => {
  // the array and retryAtStart's body: the slice ends at the next method, watch
  const block = adb.slice(adb.indexOf('static final long[] RETRY_MS'), adb.indexOf('static synchronized void watch'));
  assert.match(block, /postDelayed/, 'the retry body is in the checked slice');
  assert.doesNotMatch(block, /requestPermissions|Dialog|Toast|startActivity/);
  assert.match(adb, /private static final String PREF_KEEP = "adbWifiKeep";/);
  assert.match(adb, /static boolean keep\(Context c\) \{ return prefs\(c\)\.getBoolean\(PREF_KEEP, false\); \}/);
});
