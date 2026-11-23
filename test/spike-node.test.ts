// SPIKE: the route that logs the tablet's Node test result on the PC. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Binary, RouteRequest } from '../src/core/server/app.ts';
import { isPrivateAddress, spikeNodeRoute } from '../src/core/server/spike-node.ts';

function call(file: string, over: Partial<RouteRequest>): Binary {
  const req: RouteRequest = {
    query: new URLSearchParams(), body: {}, raw: Buffer.from('node v18.20.4 android arm64\n'),
    headers: { 'x-spike': 'node' }, from: '10.0.0.50', signal: new AbortController().signal, ...over,
  };
  return spikeNodeRoute(file).handle(req) as Binary;
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spike-node-')), 'logs', 'spike-node.log');

test('private addresses pass and public ones do not', () => {
  for (const ip of ['10.0.0.50', '192.168.1.2', '172.16.0.1', '172.31.255.255', '127.0.0.1', '::1', '::ffff:10.0.0.9', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '11.0.0.1', '2001:db8::1', '?', '']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('a LAN result with the spike flag is appended with a timestamp and answers 204', () => {
  const file = tmpFile();
  assert.equal(call(file, {}).status, 204);
  assert.equal(call(file, { raw: Buffer.from('second') }).status, 204);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^===== \d{4}-\d\d-\d\dT[\d:.]+Z from 10\.0\.0\.50 =====\nnode v18\.20\.4 android arm64\n/);
  assert.match(text, /\nsecond\n/);
});

test('a public caller or a missing spike flag is refused and nothing is written', () => {
  const file = tmpFile();
  assert.equal(call(file, { from: '8.8.8.8' }).status, 403);
  assert.equal(call(file, { headers: {} }).status, 403);
  assert.equal(fs.existsSync(file), false);
});
