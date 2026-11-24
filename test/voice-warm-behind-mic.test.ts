// The mic opens after only the listen recogniser is warmed. The barge-in recogniser warms on its own thread behind
// the mic (android/src/hub/kiosk/VoiceService.java). The APK has no JVM test harness, so this checks the Java source
// text: the order of the warm-ups, the hand-over, and the wait for that thread before the model closes.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const HUB = path.resolve(import.meta.dirname, '..');
const voice = fs.readFileSync(path.join(HUB, 'android', 'src', 'hub', 'kiosk', 'VoiceService.java'), 'utf8').replace(/\r\n/g, '\n');

/** The body of a method: from its signature to the next line that starts a method or section comment. */
function methodBody(src: string, signature: string): string {
  const at = src.indexOf(signature);
  assert.ok(at > 0, `${signature} exists`);
  const next = src.indexOf('\n  }\n', at);
  return src.slice(at, next);
}

test('before the mic opens, only the listen recogniser is warmed', () => {
  const runStart = voice.indexOf('private void run(int listenFirst)');
  const warmAt = voice.indexOf('listenRec = new Recognizer(model, RATE); warm(listenRec);', runStart);
  const openAt = voice.indexOf('rec.startRecording();', runStart);
  assert.ok(warmAt > runStart && openAt > warmAt, 'the listen warm-up comes before startRecording');
  assert.doesNotMatch(voice.slice(runStart, openAt), /speakRec\s*=\s*new Recognizer|warm\(speakRec\)/);
});

test('the barge-in warm-up starts only after the mic has opened', () => {
  const runStart = voice.indexOf('private void run(int listenFirst)');
  const openAt = voice.indexOf('rec.startRecording();', runStart);
  const bgAt = voice.indexOf('warmSpeakLater();', openAt);
  assert.ok(bgAt > openAt, 'warmSpeakLater() is called after startRecording()');
  assert.match(voice, /if \(speakRec == null\) warmSpeakLater\(\);/);
});

test('the warm-up thread leaves its recogniser for takeFull and never assigns speakRec', () => {
  const body = methodBody(voice, 'private void warmSpeakLater()');
  assert.doesNotMatch(body, /speakRec\s*=/, 'the thread does not touch speakRec');
  assert.match(body, /speakWarmed = r;/);
  assert.match(body, /synchronized \(warmLock\)/);
  const take = methodBody(voice, 'private Recognizer takeFull(boolean forSpeaking)');
  assert.match(take, /if \(r == null && forSpeaking\) r = takeWarmed\(\);/);
});

test('the run waits for the warm-up thread before it closes the model', () => {
  const fin = voice.slice(voice.indexOf('} finally {', voice.indexOf('private void run(int listenFirst)')));
  const joinAt = fin.indexOf('speakWarmThread.join()');
  const closeAt = fin.indexOf('model.close()');
  assert.ok(joinAt > 0 && closeAt > joinAt, 'the join comes before any model close');
  assert.match(fin, /warmAbort = true;/);
});

test('an aborted warm-up stops at its next buffer', () => {
  const body = methodBody(voice, 'private void warm(Recognizer r)');
  assert.match(body, /at < s\.length && !warmAbort/);
});
