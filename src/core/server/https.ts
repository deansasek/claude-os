// HTTPS for the Host, for the camera and microphone in any browser on another device (browsers allow getUserMedia only on HTTPS). The Host makes its own local
// certificate authority and a server certificate with openssl, once, and keeps them in the state folder. Each device
// trusts the authority once: it downloads /claudeos-ca.cer from the plain HTTP port, installs the profile, and turns
// on full trust. Nothing here reaches the internet.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { RequestListener } from 'node:http';

export interface CertFiles { dir: string; caKey: string; caCert: string; caDer: string; key: string; cert: string; hosts: string }

/** Where the certificates live, under the state folder. */
export function certFiles(stateDir: string): CertFiles {
  const dir = path.join(stateDir, 'https');
  return {
    dir,
    caKey: path.join(dir, 'ca.key'), caCert: path.join(dir, 'ca.crt'), caDer: path.join(dir, 'claudeos-ca.cer'),
    key: path.join(dir, 'server.key'), cert: path.join(dir, 'server.crt'), hosts: path.join(dir, 'hosts.txt'),
  };
}

/** The names and addresses the server certificate covers: localhost, and every IPv4 address this PC has. */
export function certNames(extra: string[] = [], interfaces = os.networkInterfaces()): string[] {
  const ips = Object.values(interfaces).flat().filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  const all = ['127.0.0.1', ...ips, ...extra.filter(h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h))];
  return [...new Set(all)].sort();
}

/** The subject alternative names for the openssl extension file: each address as IP:, plus localhost as DNS:. */
export function altNames(names: string[]): string {
  return ['DNS:localhost', ...names.map(n => `IP:${n}`)].join(',');
}

type Run = (file: string, args: string[], cwd: string) => void;
const runOpenssl: Run = (file, args, cwd) => {
  try { execFileSync(file, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') throw new Error('openssl was not found. Install Git for Windows (it includes openssl) or put openssl on the PATH, then start the Host again.');
    throw new Error(`openssl failed: ${String((err as { stderr?: Buffer }).stderr || err.message).trim().slice(0, 300)}`);
  }
};

/** Remake the server certificate this many days before it expires. */
const RENEW_BEFORE_DAYS = 30;

/** True when the server certificate file is missing, unreadable, or expires within RENEW_BEFORE_DAYS of `now`. */
function serverCertExpiringSoon(certPath: string, now: Date): boolean {
  try {
    const expires = Date.parse(new crypto.X509Certificate(fs.readFileSync(certPath)).validTo);
    return Number.isNaN(expires) || expires - now.getTime() < RENEW_BEFORE_DAYS * 86_400_000;
  } catch {
    return true;
  }
}

/**
 * Make the authority once, and the server certificate for these addresses. The server certificate is remade when the
 * addresses change (a new Wi-Fi address, say), or when it is close to expiry. Returns the file set.
 */
export function ensureCertificates(stateDir: string, names: string[], run: Run = runOpenssl, now: Date = new Date()): CertFiles {
  const f = certFiles(stateDir);
  fs.mkdirSync(f.dir, { recursive: true });
  const want = altNames(names);
  const have = fs.existsSync(f.hosts) ? fs.readFileSync(f.hosts, 'utf8') : '';
  // a new authority means the server certificate (signed by the old one) must be remade too
  let freshCa = false;
  if (!fs.existsSync(f.caCert) || !fs.existsSync(f.caKey)) {
    freshCa = true;
    run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', f.caKey, '-out', f.caCert, '-days', '3650', '-subj', '/CN=ClaudeOS Local CA',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], f.dir);
  }
  // the download copy of the authority: remade from ca.crt when it is missing, without a new authority
  if (!fs.existsSync(f.caDer)) run('openssl', ['x509', '-in', f.caCert, '-outform', 'DER', '-out', f.caDer], f.dir);
  if (freshCa || !fs.existsSync(f.cert) || !fs.existsSync(f.key) || have !== want || serverCertExpiringSoon(f.cert, now)) {
    const ext = path.join(f.dir, 'server.ext');
    fs.writeFileSync(ext, `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${want}\n`);
    run('openssl', ['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', f.key, '-out', path.join(f.dir, 'server.csr'), '-subj', '/CN=ClaudeOS Host'], f.dir);
    // 398 days: the longest life Apple's trust rules accept for a server certificate
    run('openssl', ['x509', '-req', '-in', path.join(f.dir, 'server.csr'), '-CA', f.caCert, '-CAkey', f.caKey, '-CAcreateserial',
      '-out', f.cert, '-days', '398', '-sha256', '-extfile', ext], f.dir);
    fs.writeFileSync(f.hosts, want);
  }
  return f;
}

/**
 * Serve `handler` over HTTPS on host:port. A listen error (the port is taken, say) goes to onError, and the Host keeps
 * running on its plain port.
 */
export function serveHttps(opts: {
  key: Buffer; cert: Buffer; handler: RequestListener; port: number; host: string;
  onListening: () => void; onError: (e: Error) => void;
}): https.Server {
  const server = https.createServer({ key: opts.key, cert: opts.cert }, opts.handler);
  server.on('error', opts.onError);
  server.listen(opts.port, opts.host, opts.onListening);
  return server;
}
