// The PC link's key: the hooks in scripts/claude-os-pc-hook.ts read .pc-bridge.json (the hub's address and a random key) and
// send the key with every call, so only processes on this PC that can read the hub's folder reach the pc/* routes.
// The file is kept across restarts (the hooks of open sessions keep working) and is never sent to the tablet.
import crypto from 'node:crypto';
import path from 'node:path';
import { HUB, readJson, writeJsonFile } from '../../../core/server/paths.ts';
import { config } from '../../../core/server/config.ts';

export const LINK_FILE = path.join(HUB, '.pc-bridge.json');
let key = '';

/** Write .pc-bridge.json (keeping the key it already has). */
export function startPcLink(): void {
  const old = readJson<{ key?: unknown }>(LINK_FILE);
  key = typeof old?.key === 'string' && old.key.length >= 32 ? old.key : crypto.randomBytes(24).toString('base64url');
  const any = config.host === '0.0.0.0' || config.host === '::';
  const host = any ? '127.0.0.1' : config.host.includes(':') ? `[${config.host}]` : config.host;
  try { writeJsonFile(LINK_FILE, { url: `http://${host}:${config.port}`, key }, { indent: 2, mode: 0o600 }); }
  catch (e) { console.log('claude: PC link file not written:', (e as Error).message); }
}

/** True if a call carries the PC link's key. */
export function pcKeyOk(k: unknown): boolean {
  if (!key || typeof k !== 'string') return false;
  const a = crypto.createHash('sha256').update(k).digest(), b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}
