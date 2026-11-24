// Pure SHA-256, HMAC and PBKDF2-HMAC-SHA256 for the tablet's own PIN check (pin-local.ts). Pure code, because
// crypto.subtle is missing on a plain http page (the hub is served on the LAN). Same output as node:crypto; test/pin-local.test.ts checks it.
// No imports: this file runs in the browser and in the tests.

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** One SHA-256 block (64 bytes at `at`) folded into the eight-word state `h`. */
function compress(h: Uint32Array, block: Uint8Array, at: number): void {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    const p = at + i * 4;
    w[i] = ((block[p] << 24) | (block[p + 1] << 16) | (block[p + 2] << 8) | block[p + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15], y = w[i - 2];
    const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
    const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (let i = 0; i < 64; i++) {
    const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

/** Hash `msg` from the state `start`, which already holds `prefix` bytes; pads and returns the 32-byte digest. */
function digest(start: Uint32Array, prefix: number, msg: Uint8Array): Uint8Array {
  const h = Uint32Array.from(start);
  const size = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(size);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const bits = (prefix + msg.length) * 8;
  const view = new DataView(buf.buffer);
  view.setUint32(size - 8, Math.floor(bits / 4294967296));
  view.setUint32(size - 4, bits >>> 0);
  for (let at = 0; at < size; at += 64) compress(h, buf, at);
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) od.setUint32(i * 4, h[i]);
  return out;
}

export function sha256(data: Uint8Array): Uint8Array {
  return digest(Uint32Array.from(H0), 0, data);
}

interface KeyStates { inner: Uint32Array; outer: Uint32Array }

/** The HMAC states after the padded key blocks, so each HMAC costs two block compressions. */
function keyStates(key: Uint8Array): KeyStates {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? sha256(key) : key);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  const inner = Uint32Array.from(H0);
  compress(inner, ipad, 0);
  const outer = Uint32Array.from(H0);
  compress(outer, opad, 0);
  return { inner, outer };
}

function hmac(ks: KeyStates, msg: Uint8Array): Uint8Array {
  return digest(ks.outer, 64, digest(ks.inner, 64, msg));
}

/** PBKDF2-HMAC-SHA256 with a 32-byte output (one block), as node:crypto's pbkdf2Sync(pw, salt, n, 32, 'sha256'). */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array {
  const ks = keyStates(password);
  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 3] = 1;
  let u = hmac(ks, first);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = hmac(ks, u);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return t;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** The PIN's hash as the PC stores it: PBKDF2 of the PIN's UTF-8 bytes with the hex salt, as hex. */
export function pbkdf2Hex(pin: string, saltHex: string, iterations: number): string {
  return bytesToHex(pbkdf2Sha256(new TextEncoder().encode(pin), hexToBytes(saltHex), iterations));
}
