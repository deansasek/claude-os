// The Host's local HTTPS certificates: the names they cover, and that the authority signs the server certificate. Uses
// the openssl on the PATH; the openssl tests are skipped where it is missing. Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import net from 'node:net';
import { altNames, certFiles, certNames, ensureCertificates, serveHttps } from '../src/core/server/https.ts';

const hasOpenssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('the names are localhost-style addresses plus every LAN IPv4, sorted and unique', () => {
  const ifaces = {
    lan: [{ family: 'IPv4', address: '10.0.0.246', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    loop: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  assert.deepEqual(certNames(['10.0.0.246', 'example.test'], ifaces), ['10.0.0.246', '127.0.0.1']);
});

test('the alternative names list DNS for localhost and IP for each address', () => {
  assert.equal(altNames(['127.0.0.1', '10.0.0.5']), 'DNS:localhost,IP:127.0.0.1,IP:10.0.0.5');
});

test('certificate files sit in the state folder under https', () => {
  const f = certFiles('/state');
  assert.equal(f.dir, path.join('/state', 'https'));
  assert.equal(f.caDer, path.join('/state', 'https', 'claudeos-ca.cer'));
});

test('openssl makes an authority and a server certificate that the authority signs', { skip: !hasOpenssl }, () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
  try {
    const f = ensureCertificates(state, ['127.0.0.1', '10.0.0.5']);
    assert.ok(fs.existsSync(f.caDer), 'the DER copy for devices to trust exists');
    assert.equal(execFileSync('openssl', ['verify', '-CAfile', f.caCert, f.cert], { encoding: 'utf8' }).includes(': OK'), true);
    const text = execFileSync('openssl', ['x509', '-in', f.cert, '-noout', '-text'], { encoding: 'utf8' });
    assert.match(text, /IP Address:10\.0\.0\.5/);
    assert.match(text, /DNS:localhost/);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('the server certificate is kept while the names stay the same, and remade when they change', { skip: !hasOpenssl }, () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
  try {
    const first = ensureCertificates(state, ['127.0.0.1']);
    const before = fs.readFileSync(first.cert, 'utf8');
    ensureCertificates(state, ['127.0.0.1']);
    assert.equal(fs.readFileSync(first.cert, 'utf8'), before, 'same names: same certificate');
    ensureCertificates(state, ['127.0.0.1', '10.0.0.9']);
    assert.notEqual(fs.readFileSync(first.cert, 'utf8'), before, 'new address: a new certificate');
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('a taken HTTPS port goes to onError, and the Host keeps running', { skip: !hasOpenssl }, async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
  const blocker = net.createServer();
  await new Promise<void>(res => blocker.listen(0, '127.0.0.1', res));
  const port = (blocker.address() as net.AddressInfo).port;
  try {
    const f = ensureCertificates(state, ['127.0.0.1']);
    const error = await new Promise<Error>(resolve => {
      serveHttps({
        key: fs.readFileSync(f.key), cert: fs.readFileSync(f.cert), handler: (_req, res) => res.end('ok'),
        port, host: '127.0.0.1', onListening: () => resolve(new Error('listened on a taken port')), onError: resolve,
      });
    });
    assert.equal((error as NodeJS.ErrnoException).code, 'EADDRINUSE');
  } finally {
    blocker.close();

test('the server certificate is remade when it is within 30 days of expiry', { skip: !hasOpenssl }, () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
  try {
    const first = ensureCertificates(state, ['127.0.0.1']);
    const before = fs.readFileSync(first.cert, 'utf8');
    const day = 86_400_000;
    ensureCertificates(state, ['127.0.0.1'], undefined, new Date(Date.now() + 300 * day));
    assert.equal(fs.readFileSync(first.cert, 'utf8'), before, 'about 98 days left: the same certificate');
    ensureCertificates(state, ['127.0.0.1'], undefined, new Date(Date.now() + 380 * day));
    assert.notEqual(fs.readFileSync(first.cert, 'utf8'), before, 'about 18 days left: a new certificate');
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});
