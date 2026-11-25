// The speech model and warmed recognisers are kept between taps while the wake word is off
// (android/src/hub/kiosk/VoiceService.java, Bridge.java). The APK has no JVM test harness, so this checks the Java
// source text: the run's exit keeps them, the next run takes them back, and Settings frees them.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const HOST_DIR = path.resolve(import.meta.dirname, '..');
const KIOSK = path.join(HOST_DIR, 'android', 'src', 'hub', 'kiosk');
const voice = fs.readFileSync(path.join(KIOSK, 'VoiceService.java'), 'utf8').replace(/\r\n/g, '\n');
const bridge = fs.readFileSync(path.join(KIOSK, 'Bridge.java'), 'utf8').replace(/\r\n/g, '\n');

/** The text of run()'s finally block, from its `} finally {` to the stopSelf post. */
function finallyBlock(src: string): string {
  const start = src.indexOf('} finally {', src.indexOf('private void run(int listenFirst)'));
  const end = src.indexOf('main.post(this::stopSelf);', start);
  assert.ok(start > 0 && end > start, 'run() has a finally block that posts stopSelf');
  return src.slice(start, end);
}

test('the run keeps the model and recognisers when the wake word is off and the run did not fail', () => {
  const fin = finallyBlock(voice);
  assert.match(fin, /!failed && !dropKept && !wakeOn\(this\)/);
  assert.match(fin, /keptModel = model;\s*keptListen = listenRec;\s*keptSpeak = speakRec;/);
});

test('the kept objects are closed only on the else path, not on a kept run', () => {
  const fin = finallyBlock(voice);
  const keepAt = fin.indexOf('keptModel = model');
  const elseAt = fin.indexOf('} else {');
  assert.ok(keepAt > 0 && elseAt > keepAt, 'the keep branch comes before the else branch');
  const keepBranch = fin.slice(keepAt, elseAt);
  assert.doesNotMatch(keepBranch, /\.close\(\)/, 'the keep branch closes nothing');
  assert.match(fin.slice(elseAt), /listenRec\.close\(\)[\s\S]*speakRec\.close\(\)[\s\S]*model\.close\(\)/);
});

test('a new run takes the kept model and recognisers back before it loads a model', () => {
  const runStart = voice.indexOf('private void run(int listenFirst)');
  const take = voice.indexOf('model = keptModel; listenRec = keptListen; speakRec = keptSpeak;', runStart);
  const load = voice.indexOf('new Model(path)', runStart);
  assert.ok(take > runStart, 'run() takes the kept objects');
  assert.ok(load > take, 'the model is loaded only after the kept one is taken');
  assert.match(voice, /if \(model == null\) \{\s*String path = StorageService\.sync/);
});

test('warm-up runs only for a recogniser that was not kept', () => {
  assert.match(voice, /if \(listenRec == null\) \{ listenRec = new Recognizer\(model, RATE\); warm\(listenRec\); \}/);
  assert.match(voice, /if \(speakRec == null\) warmSpeakLater\(\);/);
});

test('Settings turning the wake word off frees the kept model', () => {
  assert.match(voice, /static void forgetModel\(\) \{[\s\S]*dropKept = true;[\s\S]*keptModel\.close\(\)/);
  const off = bridge.indexOf('if (!on) {', bridge.indexOf('voiceSetWake(boolean on)'));
  const forget = bridge.indexOf('VoiceService.forgetModel();', off);
  const stop = bridge.indexOf('VoiceService.stop(act)', off);
  assert.ok(forget > off && forget < stop, 'voiceSetWake(false) calls forgetModel() before any stop');
});
