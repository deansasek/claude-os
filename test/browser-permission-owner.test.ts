// The in-app Browser's camera, microphone and location answer does not show Android's dialog to the device owner
// (android/src/hub/kiosk/BrowserView.java answerPermission). The APK has no JVM test, so this reads the Java source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android/src/hub/kiosk/BrowserView.java');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  void answerPermission(String id, boolean allow) {');
const body = src.slice(start, src.indexOf('\n  }\n', start));

test('as device owner, a permission the Browser asks for is granted silently, with no Android dialog', () => {
  assert.ok(start > 0, 'answerPermission() exists');
  const owner = body.indexOf('if (act.isOwner())');
  assert.ok(owner > 0, 'there is an owner branch');
  assert.match(body.slice(owner), /setPermissionGrantState\(AdminReceiver\.component\(act\), act\.getPackageName\(\), perm,/);
  assert.ok(body.indexOf('act.requestPermissions(') > owner, 'the dialog call comes after the owner branch, so the owner never reaches it');
});
