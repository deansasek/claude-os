// Static files: gzip when the client accepts it, plain bytes when it does not, and a 304 for each. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { acceptsGzip, serveStatic } from '../src/core/server/index.ts';

type Got = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

/** A tiny server that serves one file the way the hub does. Raw http.get, so nothing decodes the body for us. */
async function withFile(name: string, text: string, run: (get: (h?: http.OutgoingHttpHeaders) => Promise<Got>) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-gzip-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  const server = http.createServer((req, res) => serveStatic(req, res, file));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const get = (headers: http.OutgoingHttpHeaders = {}) => new Promise<Got>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers }, res => {
      const parts: Buffer[] = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', reject);
  });
  try { await run(get); } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

const CSS = '.card { color: red; padding: 4px; }\n'.repeat(200);

test('gzip is sent when accepted and decodes to the same bytes as the plain body', async () => {
  await withFile('a.css', CSS, async get => {
    const plain = await get();
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), CSS);
    assert.equal(plain.headers.vary, 'Accept-Encoding');

    const gz = await get({ 'Accept-Encoding': 'gzip, deflate' });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.vary, 'Accept-Encoding');
    assert.equal(Number(gz.headers['content-length']), gz.body.length);
    assert.ok(gz.body.length < plain.body.length);
    assert.deepEqual(gunzipSync(gz.body), plain.body);
    assert.notEqual(gz.headers.etag, plain.headers.etag);
  });
});

test('a .ts file is stripped to JS, then gzipped', async () => {
  await withFile('m.ts', 'export const n: number = 1;\n', async get => {
    const gz = await get({ 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gunzipSync(gz.body).toString(), 'export const n         = 1;\n');
  });
});

test('a 304 works for both the plain and the gzip ETag, and never crosses over', async () => {
  await withFile('b.js', CSS, async get => {
    const plain = await get();
    const gz = await get({ 'Accept-Encoding': 'gzip' });
    const plain304 = await get({ 'If-None-Match': plain.headers.etag });
    assert.equal(plain304.status, 304);
    assert.equal(plain304.body.length, 0);
    const gz304 = await get({ 'Accept-Encoding': 'gzip', 'If-None-Match': gz.headers.etag });
    assert.equal(gz304.status, 304);
    assert.equal(gz304.headers.etag, gz.headers.etag);
    // a weak form (a proxy may weaken the ETag) still matches
    assert.equal((await get({ 'Accept-Encoding': 'gzip', 'If-None-Match': `W/${gz.headers.etag}` })).status, 304);
    // holding the plain body but now asking for gzip: send the gzip body, not a 304
    const cross = await get({ 'Accept-Encoding': 'gzip', 'If-None-Match': plain.headers.etag });
    assert.equal(cross.status, 200);
    assert.equal(cross.headers['content-encoding'], 'gzip');
  });
});

test('an edited file is sent again (the dev reload still sees changes)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-gzip-'));
  const file = path.join(dir, 'c.css');
  fs.writeFileSync(file, CSS);
  const server = http.createServer((req, res) => serveStatic(req, res, file));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const get = (headers: http.OutgoingHttpHeaders) => new Promise<Got>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers }, res => {
      const parts: Buffer[] = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', reject);
  });
  try {
    const first = await get({ 'Accept-Encoding': 'gzip' });
    fs.writeFileSync(file, CSS + '.new { }\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);   // make sure the mtime moves even on a coarse clock
    const again = await get({ 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers.etag });
    assert.equal(again.status, 200);
    assert.ok(gunzipSync(again.body).toString().endsWith('.new { }\n'));
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a picture is never gzipped and has no Vary header', async () => {
  await withFile('p.png', 'not really a png', async get => {
    const r = await get({ 'Accept-Encoding': 'gzip' });
    assert.equal(r.headers['content-encoding'], undefined);
    assert.equal(r.headers.vary, undefined);
  });
});

test('acceptsGzip reads Accept-Encoding', () => {
  assert.equal(acceptsGzip(undefined), false);
  assert.equal(acceptsGzip(''), false);
  assert.equal(acceptsGzip('identity'), false);
  assert.equal(acceptsGzip('gzip, deflate'), true);
  assert.equal(acceptsGzip('deflate, GZIP;q=0.5'), true);
  assert.equal(acceptsGzip('gzip;q=0'), false);
  assert.equal(acceptsGzip('br, x-gzip'), true);
});
