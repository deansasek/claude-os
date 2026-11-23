// The CLI sign-in sheet's send logic (src/core/web/cli-signin.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSend, sendResult } from '../src/core/web/cli-signin.ts';

test('a typed code is sent trimmed, and the field is cleared', () => {
  assert.deepEqual(planSend('  abc#def  '), { send: 'abc#def', field: '' });
});

test('an empty field sends "" so the tablet takes the clipboard itself', () => {
  assert.deepEqual(planSend('   '), { send: '', field: '' });
});

test('a code with a line break is not sent, and the field is still cleared', () => {
  assert.deepEqual(planSend('abc\ndef'), { send: null, field: '' });
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
