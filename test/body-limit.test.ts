// The JSON body reader: a screenshot-sized body is read whole, and a body over the limit is refused, not hung. Run with: npm test
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { JSON_BODY_MAX, readBody } from '../src/core/server/index.ts';

/** A tiny server that reads a body the same way the hub does, and answers 200 with what it got or 413. */
async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req, JSON_BODY_MAX);
    if (body === null) { res.writeHead(413); res.end('too large'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ size: JSON.stringify(body).length }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run(base); } finally { server.close(); }
}

async function post(base: string, payload: string): Promise<{ status: number; text: string }> {
  const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  return { status: r.status, text: await r.text() };
}

test('a 20 KB body (more than the old 8 KB limit) is read whole', async () => {
  await withServer(async base => {
    const picture = 'x'.repeat(20 * 1024);
    const r = await post(base, JSON.stringify({ id: 'b1', ok: true, data: picture }));
    assert.equal(r.status, 200);
    assert.ok(JSON.parse(r.text).size > 20 * 1024);
  });
});

test('a body over the limit is refused with 413 (it does not hang)', async () => {
  await withServer(async base => {
    const huge = JSON.stringify({ data: 'x'.repeat(JSON_BODY_MAX + 1024) });
    const r = await post(base, huge);
    assert.equal(r.status, 413);
  });
});

test('a multi-byte character split across two network chunks is read whole', async () => {
  // "é" is two bytes (C3 A9). Send the first byte, pause, then the rest, so the two chunks split the character.
  const echo = http.createServer(async (req, res) => {
    const body = await readBody(req, JSON_BODY_MAX);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: body?.text ?? null }));
  });
  await new Promise<void>(r => echo.listen(0, '127.0.0.1', r));
  const port = (echo.address() as AddressInfo).port;
  try {
    const bytes = Buffer.from(JSON.stringify({ text: 'café ☕' }), 'utf8');
    const split = bytes.indexOf(0xc3) + 1;   // between the two bytes of "é"
    const got = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => {
        let out = '';
        res.on('data', c => { out += c; });
        res.on('end', () => resolve(out));
      });
      req.on('error', reject);
      req.write(bytes.subarray(0, split));
      setTimeout(() => req.end(bytes.subarray(split)), 30);
    });
    assert.equal(JSON.parse(got).text, 'café ☕');
  } finally {
    echo.close();
  }
});

test('a body that is not JSON reads as an empty object', async () => {
  await withServer(async base => {
    const r = await post(base, 'not json');
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.text).size, 2);   // "{}"
  });
});
