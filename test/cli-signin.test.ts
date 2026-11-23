// The CLI sign-in sheet's send and paste logic (src/core/web/cli-signin.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLeft, pasteResult, planSend, sendResult } from '../src/core/web/cli-signin.ts';

test('a typed code is sent trimmed, and the field is cleared', () => {
  assert.deepEqual(planSend('  abc#def  '), { send: 'abc#def', field: '' });
});

test('an empty field sends nothing and asks for the code', () => {
  const p = planSend('   ');
  assert.equal(p.send, null);
  assert.equal(p.field, '');
  assert.match(p.msg!, /Paste/);
});

test('a code with a line break is not sent, and the field is still cleared', () => {
  const p = planSend('abc\ndef');
  assert.equal(p.send, null);
  assert.equal(p.field, '');
  assert.match(p.msg!, /one line/);
});

test('sendResult: null when sent; a plain line for each tablet reason', () => {
  const got: string[] = [];
  assert.equal(sendResult(c => { got.push(c); }, 'x'), null);
  assert.deepEqual(got, ['x']);
  const fail = (why: string) => () => { throw new Error(why); };
  assert.match(sendResult(fail('no code to send'), '')!, /Copy the code/);
  assert.match(sendResult(fail('no sign-in is waiting'), 'x')!, /ended/);
  assert.match(sendResult(fail('boom'), 'x')!, /Couldn’t send/);
});

test('pasteResult: the clipboard text, or a plain line for each tablet reason', () => {
  assert.deepEqual(pasteResult(() => 'abc#def'), { text: 'abc#def' });
  const fail = (why: string) => () => { throw new Error(why); };
  assert.match((pasteResult(fail('no code to send')) as { msg: string }).msg, /Nothing to paste/);
  assert.match((pasteResult(fail('the sign-in has ended')) as { msg: string }).msg, /ended/);
});

test('formatLeft: seconds as m:ss, never below 0:00', () => {
  assert.equal(formatLeft(600), '10:00');
  assert.equal(formatLeft(61.9), '1:01');
  assert.equal(formatLeft(5), '0:05');
  assert.equal(formatLeft(-3), '0:00');
});
