// The Hub's core server: static files, the app loader (routes under /api/<id>/),
// a few core routes, and keeping the Nest Hub on the page.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import type { Binary, Route, ServerApp } from './app.ts';
import { config } from './config.ts';
import { HUB, PUBLIC, SRC } from './paths.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res: http.ServerResponse, code: number, body: string | Buffer, type: string, cache = 'no-cache'): void {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const json = (res: http.ServerResponse, obj: unknown) => send(res, 200, JSON.stringify(obj ?? null), 'application/json', 'no-store');

function readBody(req: http.IncomingMessage, max = 8192): Promise<any> {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > max) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/** A raw request body up to `max` bytes; null when it is bigger (the rest is read and dropped). */
function readRaw(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise(resolve => {
    const parts: Buffer[] = [];
    let size = 0, over = false;
    req.on('data', (c: Buffer) => { size += c.length; if (size > max) over = true; else parts.push(c); });
    req.on('end', () => resolve(over ? null : Buffer.concat(parts)));
    req.on('error', () => resolve(null));
  });
}

// A Host header that names this PC by address, not by a domain name: IPv4, [IPv6] or localhost, with an optional port.
const LITERAL_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\]|localhost)(:\d{1,5})?$/;

// Only browser-side code is served from src/: never anything in a server/ folder.
const WEB_FILE = /^\/src\/(main\.web\.ts|core\/web\/[\w./-]+\.(ts|html)|apps\/[\w-]+\/(web\/[\w./-]+\.ts|view\.html|app\.css|manifest\.ts|api\.ts))$/;

function resolveStatic(urlPath: string): string | null {
  const p = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  if (p.includes('..') || p.includes('\0')) return null;
  if (p.startsWith('/src/')) return WEB_FILE.test(p) ? path.join(SRC, p.slice(5)) : null;
  const file = path.join(PUBLIC, p);
  return file.startsWith(PUBLIC) ? file : null;
}

/** Newest modification time of anything the page is built from; open pages reload when it changes. */
function pageVersion(): number {
  let v = 0;
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
      if (f.split(/[\\/]/).includes('server')) continue;
      try { v = Math.max(v, fs.statSync(path.join(dir, f)).mtimeMs); } catch { /* ignore */ }
    }
  };
  walk(PUBLIC); walk(SRC);
  return v;
}

export function startServer(apps: ServerApp[]): void {
  const args = config;   // command line, then hub/config.json, then defaults (see config.ts)
  process.removeAllListeners('warning');   // hush "type stripping is experimental"

  // ---------- routes: core + every app's, under /api/<id>/ ----------
  const taps: { at: string; from: string; target: string }[] = [];
  const routes = new Map<string, Route>();
  const add = (id: string, r: Route) => routes.set(`${r.method} /api/${id}/${r.path}`, r);
  add('core', { method: 'GET', path: 'version', handle: () => ({ version: pageVersion() }) });
  add('core', { method: 'GET', path: 'taps', handle: () => taps });
  add('core', {
    method: 'POST', path: 'tap', handle: ({ body, from }) => {
      const target = String(body.target ?? '?').slice(0, 40);
      taps.push({ at: new Date().toLocaleTimeString(), from, target });
      taps.splice(0, Math.max(0, taps.length - 50));
      console.log(`tap from ${from}: ${target}`);
      return { ok: true };
    },
  });
  add('core', {   // errors reported by a screen's browser (see the plain script in index.html)
    method: 'POST', path: 'log', handle: ({ body, from }) => {
      console.log(`page ${String(body.kind).slice(0, 20)} from ${from}: ${String(body.msg).slice(0, 500)}\n  browser: ${String(body.ua).slice(0, 200)}`);
      return { ok: true };
    },
  });
  for (const app of apps) {
    for (const r of app.routes) add(app.id, r);
    app.start?.();
  }

  const lastSeen = new Map<string, number>();   // when each screen last asked us for anything
  // The hub's own origins: the tablet's page, and this PC's loopback. Anything else that sends an Origin is another site.
  const ownOrigins = new Set([`http://${args.host}:${args.port}`, `http://localhost:${args.port}`, `http://127.0.0.1:${args.port}`]);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://hub');
    const from = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
    lastSeen.set(from, Date.now());
    try {
      // Cross-site guard. A page from another site (one open in the ClaudeOS Browser, say) must not reach the hub: a
      // browser sends Origin on every cross-site request, so an Origin that is not this hub's is refused. A POST must
      // be JSON (or the raw upload a route asks for), which a plain HTML form cannot send. Tools on the PC send no
      // Origin and are not affected.
      // A page served by this hub sends an Origin equal to the Host it asked for, whatever address the hub
      // listens on (0.0.0.0 included); another site's page has its own origin, which never matches our Host.
      // Only an IP address or localhost counts: a domain name could be re-pointed at this PC (DNS rebinding).
      const origin = req.headers.origin, host = req.headers.host;
      const sameHost = !!host && LITERAL_HOST.test(host) && (origin === `http://${host}` || origin === `https://${host}`);
      if (origin && !ownOrigins.has(origin) && !sameHost) return send(res, 403, 'not from this hub', 'text/plain');
      // the tablet's own app, for its silent self-update: the newest build and its version, read-only, nothing else
      if (req.method === 'GET' && url.pathname === '/apk/version') {
        const m = /android:versionCode="(\d+)"/.exec(fs.readFileSync(path.join(HUB, 'android', 'AndroidManifest.xml'), 'utf8'));
        return json(res, { versionCode: Number(m?.[1] ?? 0) });
      }
      if (req.method === 'GET' && url.pathname === '/apk/claude-hub.apk') {
        const apk = path.join(HUB, 'android', 'build', 'claude-hub.apk');
        if (!fs.existsSync(apk)) return send(res, 404, 'no build yet', 'text/plain');
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': fs.statSync(apk).size, 'Cache-Control': 'no-store' });
        fs.createReadStream(apk).on('error', () => res.destroy()).pipe(res);
        return;
      }
      const route = routes.get(`${req.method} ${url.pathname.replace(/\/$/, '')}`);
      if (route) {
        if (req.method === 'POST' && !route.rawMax && !String(req.headers['content-type'] || '').startsWith('application/json')) {
          return send(res, 415, 'send JSON', 'text/plain');
        }
        let body: any = {}, raw: Buffer | null = null;
        if (req.method === 'POST' && route.rawMax) {
          raw = await readRaw(req, route.rawMax);
          if (!raw) return send(res, 413, 'too large', 'text/plain');
        } else if (req.method === 'POST') body = await readBody(req);
        try {
          const out = await route.handle({ query: url.searchParams, body, raw, headers: req.headers, from });
          if (out && typeof out === 'object' && (out as Binary).binary === true) {
            const b = out as Binary;
            return send(res, b.status ?? 200, b.body, b.contentType, 'no-cache');
          }
          return json(res, out);
        } catch (e) {
          return json(res, { status: 'error', error: String((e as Error).message || e).slice(0, 160) });
        }
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, 'no such route', 'text/plain');
      if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');

      const file = resolveStatic(url.pathname);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
      const ext = path.extname(file);
      if (ext === '.ts') return send(res, 200, stripTypeScriptTypes(fs.readFileSync(file, 'utf8')), TYPES['.ts']);   // browser gets plain JS
      return send(res, 200, fs.readFileSync(file), TYPES[ext] || 'application/octet-stream');
    } catch (e) {
      console.log('request error:', e);
      if (!res.headersSent) send(res, 500, 'error', 'text/plain');
    }
  });

  const pageUrl = `http://${args.host}:${args.port}/?theme=${args.theme}`;
  server.listen(args.port, args.host, () => console.log(`serving ${pageUrl} with apps: ${apps.map(a => a.id).join(', ')}`));

  // ---------- keep the Nest Hub on the page ----------
  // Re-cast when the Hub has left the cast app (back to its photo frame), or when the cast app is
  // still up but the page inside it has gone quiet: a page that failed to load (e.g. it reloaded
  // while this server was restarting) shows a blank screen and never polls again.
  if (args.cast) {
    const catt = args.cattPath, device = args.cast;
    const QUIET_MS = 90e3;
    const startedAt = Date.now();
    let busy = false;
    const run = (cmd: string[], timeout: number) => new Promise<string>(resolve =>
      execFile(catt, ['-d', device, ...cmd], { timeout, windowsHide: true }, (_e, out, err) => resolve(String(out) + String(err))));
    // A Nest Hub that stays off the cast (asleep, offline, or refusing the cast) used to be re-cast every 45 s
    // forever. Now each failed re-cast doubles the wait (45 s up to 10 min), and the log says so once per streak.
    let misses = 0, nextCheckAt = 0;
    const check = async () => {
      if (busy || Date.now() < nextCheckAt) return;
      busy = true;
      try {
        const info = await run(['info'], 30e3);
        const quiet = Date.now() - (lastSeen.get(device) ?? startedAt);
        if (info.includes('DashCast') && quiet <= QUIET_MS) { misses = 0; return; }
        const why = !info.includes('DashCast') ? 'it left the cast' : `the page has been silent for ${Math.round(quiet / 1000)}s`;
        if (misses === 0) console.log(new Date().toLocaleTimeString(), `re-casting to ${device}: ${why}`);
        misses++;
        nextCheckAt = Date.now() + Math.min(45e3 * 2 ** (misses - 1), 10 * 60e3);
        await run(['stop'], 30e3);
        await run(['cast_site', pageUrl], 60e3);
        lastSeen.set(device, Date.now());   // give the fresh page time to start
      } finally { busy = false; }
    };
    setTimeout(check, 5e3);
    setInterval(check, 45e3);
  }
}
