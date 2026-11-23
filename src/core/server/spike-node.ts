// SPIKE (Node.js on the tablet, see android/src/hub/kiosk/node/NodeRunner.java): POST /api/spike/node.
// The tablet's test build sends its Node test result here as plain text; the hub appends it to a log file on
// the PC, because the tablet's device log and app files cannot be read on this build. Not a feature.
import fs from 'node:fs';
import path from 'node:path';
import type { Binary, Route } from './app.ts';

/** The largest result the route takes. */
export const SPIKE_NODE_MAX = 64 * 1024;

/** True for a loopback, link-local or private (RFC 1918 / IPv6 ULA) address: a caller on this PC or the home network. */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.replace(/^::ffff:/i, '').toLowerCase();
  if (a === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254);
}

const reply = (status: number, text = ''): Binary =>
  ({ binary: true, status, contentType: 'text/plain; charset=utf-8', body: Buffer.from(text) });

/**
 * The route. It takes a body only from a private address and only with the header "X-Spike: node" (the spike's
 * flag), and appends it with a timestamp and the caller's address to `logFile`. It answers 204.
 */
export function spikeNodeRoute(logFile: string): Route {
  return {
    method: 'POST', path: 'node', rawMax: SPIKE_NODE_MAX, handle: ({ raw, headers, from }) => {
      if (!isPrivateAddress(from)) return reply(403, 'LAN only');
      if (headers['x-spike'] !== 'node') return reply(403, 'spike flag missing');
      if (!raw) return reply(413, 'too large');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const text = raw.toString('utf8').replace(/\s+$/, '');
      fs.appendFileSync(logFile, `===== ${new Date().toISOString()} from ${from} =====\n${text}\n\n`);
      console.log(`spike: Node test result from ${from} (${raw.length} bytes) appended to ${logFile}`);
      return reply(204);
    },
  };
}
