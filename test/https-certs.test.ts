// The Host's local HTTPS certificates: the names they cover, and that the authority signs the server certificate. Uses
// the openssl on the PATH; the openssl tests are skipped where it is missing. Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { altNames, certFiles, certNames, ensureCertificates } from '../src/core/server/https.ts';

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
