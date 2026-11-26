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

test('voice.ts stop command handles a rejected unlocked call', () => {
  const handle = between(voice, 'async function handle(', '\nasync function send(');
  assert.match(handle, /unlocked\(\(\) => apiCall\('stop', \{ turn \}\)\)\.catch\(\(\) => \{\}\)/);
});
