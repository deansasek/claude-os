// An unlocked action that cannot reach the PC rejects, and its callers say the PC cannot be reached
// (src/apps/claude/web/reply.ts unlocked; src/apps/camera/web/look.ts send; src/apps/claude/web/voice.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `${from} exists`);
  return src.slice(start, src.indexOf(to, start + from.length));
};

const reply = read('src/apps/claude/web/reply.ts');
const look = read('src/apps/camera/web/look.ts');
const voice = read('src/apps/claude/web/voice.ts');

const OFFLINE_CATCH = /catch \{ say\('I can’t reach your PC right now\. Check that it’s on and ClaudeOS is running\.'\); return null; \}/;
const VOICE_CATCH = /\.catch\(\(\) => \{ failed\('I can’t reach your PC right now\.'\); return undefined; \}\)/;

test('unlocked() in reply.ts rejects when the action cannot run', () => {
  const body = between(reply, 'export function unlocked<', '\n}\n');
  assert.match(body, /\.then\(\(\) => \{ if \(!ran\) resolve\(null\); \}, reject\)/);
});

test('look.ts send() wraps both unlocked calls in a try/catch that says the PC is unreachable', () => {
  const body = between(look, 'async function send(', '\n}\n');
  const wrapped = body.match(/try \{ r = await unlocked\([\s\S]*?catch \{ say\('I can’t reach your PC right now\. Check that it’s on and ClaudeOS is running\.'\); return null; \}/g) || [];
  assert.equal(wrapped.length, 2, 'both unlocked calls are wrapped');
  assert.match(body, OFFLINE_CATCH, 'the catch says the offline line');
});

test('voice.ts send() and the new-session path catch an unreachable PC', () => {
  const handle = between(voice, 'async function handle(', '\nasync function send(');
  const send = between(voice, 'async function send(', '\nconst openHere');
  assert.match(handle, VOICE_CATCH, 'the new-session unlocked call has a catch');
  assert.match(send, VOICE_CATCH, 'the send unlocked call has a catch');
});

test('voice.ts stop command awaits the stop call and does not swallow its failure', () => {
  const branch = between(voice, "if (CANCEL.test(t) && convo?.turnId", "  if (CANCEL.test(t)) { sayLine");
  assert.match(branch, /await unlocked\(\(\) => apiCall<[^>]*>\('stop', \{ turn \}\)\)/, 'the stop call is awaited');
  assert.doesNotMatch(branch, /\.catch\(\(\) => \{\}\)/, 'no empty catch hides a failed stop');
  assert.match(branch, /void refreshView\(\);/, 'the view repaints');
});

test('voice.ts stop command says "Stopped Claude" only after an ok result', () => {
  const branch = between(voice, "if (CANCEL.test(t) && convo?.turnId", "  if (CANCEL.test(t)) { sayLine");
  const stopped = "notice('Stopped Claude'";
  assert.equal(branch.split(stopped).length - 1, 1, 'the stopped notice appears once');
  const okAt = branch.indexOf('if (r.ok) {');
  const failAt = branch.indexOf("notice('Couldn’t stop Claude'");
  assert.ok(okAt > 0, 'the ok branch exists');
  assert.ok(branch.indexOf(stopped) > okAt, 'the stopped notice is inside the ok branch');
  assert.ok(failAt > branch.indexOf(stopped), 'the failure notice is in the else branch');
  assert.match(branch, /Can’t reach your PC\. Try again\./, 'the failure says the PC cannot be reached');
  assert.match(branch, /if \(r === null\) \{ needPin\(\); return; \}/, 'a PIN pad with no stop shows no stopped notice');
});

test('voice.ts stop command gives not_running its own notice and clears the conversation', () => {
  const branch = between(voice, "if (CANCEL.test(t) && convo?.turnId", "  if (CANCEL.test(t)) { sayLine");
  const notRunningAt = branch.indexOf("r.error === 'not_running'");
  assert.ok(notRunningAt > branch.indexOf('if (r.ok) {'), 'the not_running branch follows the ok branch');
  const notRunning = branch.slice(notRunningAt, branch.indexOf("r.error === 'unreachable'"));
  assert.match(notRunning, /notice\('Claude already finished', 'Nothing to stop\.'\)/, 'not_running says Claude already finished');
  assert.match(notRunning, /convo = null; voiceUi\.setBase\(\{ kind: 'idle' \}\);/, 'not_running clears the conversation and goes idle');
  assert.doesNotMatch(notRunning, /try again/i, 'not_running does not ask the user to try again');
});

test('voice.ts stop command shows "Can’t reach your PC" only for the unreachable case', () => {
  const branch = between(voice, "if (CANCEL.test(t) && convo?.turnId", "  if (CANCEL.test(t)) { sayLine");
  const unreachableAt = branch.indexOf("r.error === 'unreachable'");
  const otherAt = branch.indexOf("notice('Couldn’t stop Claude', 'Try again in a moment.')");
  assert.ok(unreachableAt > 0, 'the unreachable branch exists');
  assert.ok(otherAt > unreachableAt, 'other errors get their own notice after the unreachable branch');
  const reach = branch.indexOf('Can’t reach your PC');
  assert.ok(reach > unreachableAt && reach < otherAt, '"Can’t reach your PC" appears only in the unreachable branch');
  assert.equal(branch.split('Can’t reach your PC').length - 1, 1, 'the reach message appears once in the stop branch');
  assert.match(branch, /catch \{ r = \{ ok: false, error: 'unreachable' \}; \}/, 'a thrown stop call is treated as unreachable');
});

test('voice.ts new session says a failed projects read is offline, and a missing Scratch space is not', () => {
  const start = voice.indexOf("let projects: Project[];");
  assert.ok(start > 0, 'the new-session path reads the projects');
  const body = voice.slice(start, voice.indexOf('\n  sayLine(', start));
  // (a) the projects catch says the PC is unreachable and returns instead of falling through
  const read = body.match(/catch \{ voiceUi\.notice\('Can’t reach your PC'[^\n]*\}/);
  assert.ok(read, 'the projects read has a catch');
  assert.match(read[0], /say\('I can’t reach your PC right now\.'\); return; \}$/);
  // (b) a read that worked with no Scratch space says so, without blaming the PC
  const missing = body.match(/if \(!where\) \{[^\n]*\}/);
  assert.ok(missing, 'the new-session path has a !where branch');
  assert.match(missing[0], /I need a Scratch space project on your PC first\./);
  assert.doesNotMatch(missing[0], /can’t reach your PC/);
});
