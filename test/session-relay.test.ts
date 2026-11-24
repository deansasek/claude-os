// The session relay's pure parts (scripts/session-relay.ts): the message line, the text it posts, the fallback decision.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewakeText } from '../src/apps/claude/server/pclink.ts';
import { messageLine, relayDelivered, relayReply, relayText, send } from '../scripts/session-relay.ts';

test('the message line is one user turn ending in a newline', () => {
  const line = messageLine('hi "there"\nnext');
  assert.ok(line.endsWith('\n'));
  assert.equal(line.trimEnd().includes('\n'), false);
  assert.deepEqual(JSON.parse(line), { type: 'user', message: { role: 'user', content: 'hi "there"\nnext' } });
});

test('the relay posts the tablet words, not the hook-note wrapper', () => {
  assert.equal(relayText(rewakeText('relay live test')), 'relay live test');
  assert.equal(relayText('plain text'), 'plain text');
});

test('delivered only when the lines were written and no error came back', () => {
  assert.equal(relayDelivered({ ok: true, reply: '' }), true);
  assert.equal(relayDelivered({ ok: true, reply: '', error: 'no close within 3 s' }), true);
  assert.equal(relayDelivered({ ok: false, reply: '', error: 'ENOENT' }), false);
  assert.equal(relayDelivered({ ok: true, reply: '{"type":"error","message":"bad token"}\n' }), false);
  assert.equal(relayDelivered(null), false);
});

test('no messaging variables: fall back, no throw', async () => {
  assert.equal(await relayReply(rewakeText('x'), {}), false);
});

test('a socket that does not exist: not written, so fall back', async () => {
  const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\claude-os-relay-test-missing' : '/tmp/claude-os-relay-test-missing.sock';
  const r = await send(pipe, 'x', 'y');
  assert.equal(r.ok, false);
  assert.equal(relayDelivered(r), false);
});
