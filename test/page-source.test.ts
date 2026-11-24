// The pageSource setting the tablet loader reads (android/src/hub/kiosk/PageAssets.java). The APK has no JVM test
// harness, so this checks the Java source text: the default is pc, and the parser accepts pc, auto and bundle.
// The rule below mirrors PageAssets.sourceOf. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const HUB = path.resolve(import.meta.dirname, '..');
const java = fs.readFileSync(path.join(HUB, 'android', 'src', 'hub', 'kiosk', 'PageAssets.java'), 'utf8');

/** The rule PageAssets.sourceOf applies: trimmed, lower case; auto and bundle pass; anything else is pc. */
function sourceOf(raw: string | null | undefined): string {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'auto' || v === 'bundle' ? v : 'pc';
}

test('the default page source is pc', () => {
  assert.match(java, /static final String DEFAULT_SOURCE = SOURCE_PC;/);
  assert.equal(sourceOf(undefined), 'pc');
  assert.equal(sourceOf(null), 'pc');
});

test('pc, auto and bundle are the three values', () => {
  assert.match(java, /static final String SOURCE_PC = "pc";/);
  assert.match(java, /static final String SOURCE_AUTO = "auto";/);
  assert.match(java, /static final String SOURCE_BUNDLE = "bundle";/);
  assert.equal(sourceOf('pc'), 'pc');
  assert.equal(sourceOf('auto'), 'auto');
  assert.equal(sourceOf('bundle'), 'bundle');
});

test('the value is trimmed and case-insensitive; an unknown value is pc', () => {
  assert.match(java, /raw == null \? "" : raw\.trim\(\)\.toLowerCase\(Locale\.ROOT\)/);
  assert.equal(sourceOf(' Bundle '), 'bundle');
  assert.equal(sourceOf('bundel'), 'pc');
  assert.equal(sourceOf(''), 'pc');
});
