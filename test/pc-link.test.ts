// The PC link's pure parts (src/apps/claude/server/pclink.ts): the reply inbox, the hook output, the settings merge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOOK_MARK, PcInbox, permissionOutput, rewakeText, withBridgeHooks, withoutBridgeHooks } from '../src/apps/claude/server/pclink.ts';

const S = '11111111-2222-3333-4444-555555555555';

test('a reply is refused while no hook listens', () => {
  const box = new PcInbox();
  assert.equal(box.listening(S), false);
  assert.equal(box.deliver(S, 'hi'), false);
});

test('a waiting hook gets the reply at once', async () => {
  const box = new PcInbox();
  const p = box.wait(S, 'waiter-aaaa', true, 5000);
  assert.equal(box.listening(S), true);
  assert.equal(box.deliver(S, 'hello'), true);
  assert.deepEqual(await p, { kind: 'reply', text: 'hello' });
});

test('a reply sent between polls waits for the next poll', async () => {
  const box = new PcInbox();
  assert.deepEqual(await box.wait(S, 'waiter-aaaa', true, 5), { kind: 'again' });
  assert.equal(box.deliver(S, 'queued'), true);
  assert.deepEqual(await box.wait(S, 'waiter-aaaa', false, 5000), { kind: 'reply', text: 'queued' });
});

test('a new hook replaces the old one, and the old one is told to stop', async () => {
  const box = new PcInbox();
  const old = box.wait(S, 'waiter-old1', true, 5000);
  const now = box.wait(S, 'waiter-new1', true, 5000);
  assert.deepEqual(await old, { kind: 'stop' });
  assert.deepEqual(await box.wait(S, 'waiter-old1', false, 5000), { kind: 'stop' });
  box.deliver(S, 'to the new one');
  assert.deepEqual(await now, { kind: 'reply', text: 'to the new one' });
});

test('a hook that stopped polling no longer counts as listening', () => {
  let t = 0;
  const box = new PcInbox(45e3, () => t);
  void box.wait(S, 'waiter-aaaa', true, 1);
  t = 44e3; assert.equal(box.listening(S), true);
  t = 46e3; assert.equal(box.listening(S), false);
});

test('forget stops the waiting hook', async () => {
  const box = new PcInbox();
  const p = box.wait(S, 'waiter-aaaa', true, 5000);
  box.forget(S);
  assert.deepEqual(await p, { kind: 'stop' });
  assert.equal(box.listening(S), false);
});

test('an aborted poll ends without a reply', async () => {
  const box = new PcInbox();
  const ac = new AbortController();
  const p = box.wait(S, 'waiter-aaaa', true, 5000, ac.signal);
  ac.abort();
  assert.deepEqual(await p, { kind: 'again' });
});

test('permissionOutput prints a decision, or nothing', () => {
  assert.equal(permissionOutput(null), '');
  assert.equal(permissionOutput({ behavior: 'maybe' }), '');
  assert.deepEqual(JSON.parse(permissionOutput({ behavior: 'allow' })), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  const deny = JSON.parse(permissionOutput({ behavior: 'deny', message: 'no', interrupt: true }));
  assert.deepEqual(deny.hookSpecificOutput.decision, { behavior: 'deny', message: 'no', interrupt: true });
});

test('rewakeText carries the reply', () => {
  assert.match(rewakeText('run the tests'), /ClaudeOS tablet[\s\S]*\n\nrun the tests$/);
});

test('the hooks are added once, beside the user\'s own, and removed cleanly', () => {
  const mine = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
  const cmd = `"node" "C:/hub/scripts/${HOOK_MARK}"`;
  const once = withBridgeHooks(mine, cmd);
  const twice = withBridgeHooks(once, cmd);
  assert.deepEqual(twice, once);
  assert.equal(once.model, 'x');
  assert.equal(once.hooks.Stop.length, 2);
  assert.equal(once.hooks.Stop[0].hooks[0].command, 'say done');
  assert.equal(once.hooks.Stop[1].hooks[0].command, `${cmd} stop`);
  assert.equal(once.hooks.Stop[1].hooks[0].asyncRewake, true);
  assert.equal(once.hooks.PermissionRequest[0].hooks[0].command, `${cmd} permission`);
  assert.deepEqual(withoutBridgeHooks(once), mine);
  assert.deepEqual(withoutBridgeHooks(withBridgeHooks({}, cmd)), {});
});

test('queued() gives the time a reply waits for the PC hook, and null once the hook takes it', async () => {
  let now = 1000;
  const box = new PcInbox(45e3, () => now);
  assert.equal(box.queued(S), null);
  assert.deepEqual(await box.wait(S, 'waiter-aaaa', true, 5), { kind: 'again' });
  now = 2000;
  assert.equal(box.deliver(S, 'later'), true);
  assert.equal(box.queued(S), 2000);
  now = 3000;
  assert.deepEqual(await box.wait(S, 'waiter-aaaa', false, 5000), { kind: 'reply', text: 'later' });
  assert.equal(box.queued(S), null);
});
