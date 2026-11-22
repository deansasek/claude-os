// The Anthropic plugin marketplace, for Settings → Plugins → Discover. The plugins it lists are read from the marketplace
// files Claude Code keeps under ~/.claude/plugins (read only). Install, uninstall and update run the Claude Code CLI that
// ships with the Agent SDK (the same binary the sessions run), through execFile with an argument list, never a shell.
// Nothing here edits the user's ~/.claude files by hand. Installs and removals go one at a time.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB, readJson } from '../../../core/server/paths.ts';
import { MARKETPLACE, type MarketError, type MarketPlugin, type MarketResult, type MarketView } from '../api.ts';
import { partsOf } from './plugins.ts';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const MARKET_DIR = path.join(CLAUDE_DIR, 'plugins', 'marketplaces', MARKETPLACE);
const MANIFEST = path.join(MARKET_DIR, '.claude-plugin', 'marketplace.json');
const KNOWN = path.join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json');
const INSTALLED = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');
const TIMEOUT_MS = 120e3;
const MAX_OUT = 4 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const isStr = (v: unknown): v is string => typeof v === 'string';
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const text = (v: unknown, n: number): string => (isStr(v) ? clip(v.replace(/\s+/g, ' ').trim(), n) : '');

/** The SDK's bundled Claude Code binary for this platform (the same version the sessions use). */
function cliPath(): string | null {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const p = path.join(HUB, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, exe);
  return fs.existsSync(p) ? p : null;
}

// ---------- reading the marketplace (read only) ----------
function readJsonFile(file: string): any {
  return readJson<any>(file);   // the same read as core/server/paths.ts: a missing or bad file gives null
}

/** The marketplace's plugin entries, or null when the marketplace isn't on this PC. */
function readEntries(): any[] | null {
  const o = readJsonFile(MANIFEST);
  return o ? (Array.isArray(o.plugins) ? o.plugins : []) : null;
}

/** Plugin keys ("name@marketplace") Claude Code has installed. */
function installedKeys(): Set<string> {
  const o = readJsonFile(INSTALLED);
  return new Set(o?.plugins && typeof o.plugins === 'object' ? Object.keys(o.plugins) : []);
}

function updatedAt(): string | null {
  const t = readJsonFile(KNOWN)?.[MARKETPLACE]?.lastUpdated;
  return isStr(t) ? t : null;
}

/** A bundled plugin's folder inside the marketplace ("./plugins/x" sources only), or null. */
function bundledDir(e: any): string | null {
  if (!isStr(e.source) || !e.source.startsWith('./')) return null;
  const dir = path.resolve(MARKET_DIR, e.source);
  if (!dir.startsWith(MARKET_DIR + path.sep)) return null;
  try { return fs.statSync(dir).isDirectory() ? dir : null; } catch { return null; }
}

const hostOf = (raw: unknown): string | null => { try { return isStr(raw) ? new URL(raw).host || null : null; } catch { return null; } };
/** An https address with no user, password or query string. */
const httpsOnly = (raw: unknown): string | null => {
  try { const u = new URL(String(raw)); return u.protocol === 'https:' ? `${u.protocol}//${u.host}${u.pathname}` : null; } catch { return null; }
};

function toPlugin(e: any, have: Set<string>): MarketPlugin | null {
  if (!e || typeof e !== 'object' || !isStr(e.name) || !NAME_RE.test(e.name)) return null;
  const dir = bundledDir(e);
  const m = dir ? readJsonFile(path.join(dir, '.claude-plugin', 'plugin.json')) : null;
  const author = isStr(e.author) ? e.author : isStr(e.author?.name) ? e.author.name : '';
  const kwSource = Array.isArray(e.keywords) ? e.keywords : Array.isArray(m?.keywords) ? m.keywords : [];
  return {
    name: e.name,
    description: text(e.description || m?.description, 400),
    author: text(author, 80),
    category: text(e.category || m?.category, 40),
    keywords: kwSource.filter(isStr).slice(0, 8).map((k: string) => text(k, 30)),
    version: text(m?.version || e.version, 30) || null,
    homepage: httpsOnly(e.homepage),
    from: e.source && typeof e.source === 'object' ? hostOf(e.source.url) : null,
    parts: partsOf(dir),
    installed: have.has(`${e.name}@${MARKETPLACE}`),
  };
}

/** What Settings → Plugins → Discover lists. Secrets are never in the marketplace files it reads. */
export function marketView(): MarketView {
  const entries = readEntries();
  if (!entries) return { marketplace: MARKETPLACE, updatedAt: null, plugins: [], error: 'no_marketplace' };
  const have = installedKeys();
  const plugins = entries.map(e => toPlugin(e, have)).filter((p): p is MarketPlugin => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { marketplace: MARKETPLACE, updatedAt: updatedAt(), plugins, error: null };
}

// ---------- running the CLI ----------
/** The last part of a CLI's output, with terminal colour codes removed. */
const tail = (s: string): string => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').trim().slice(-1500);

/** One CLI call at a time: installs, removals and updates never overlap. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function runCli(args: string[]): Promise<{ ok: boolean; output: string; error: 'no_cli' | 'timeout' | 'failed' | null }> {
  const exe = cliPath();
  if (!exe) return Promise.resolve({ ok: false, output: '', error: 'no_cli' });
  return new Promise(resolve => {
    // execFile with an argument array: no shell, so nothing in the name can be read as a command
    execFile(exe, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_OUT }, (err, stdout, stderr) => {
      const output = tail(`${stdout}\n${stderr}`);
      if (!err) { resolve({ ok: true, output, error: null }); return; }
      const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
      resolve({ ok: false, output, error: killed ? 'timeout' : 'failed' });
    });
  });
}

/** The route's answer for a CLI call. A marketplace-declared setup command needs a yes in Claude Code on the PC. */
function outcome(r: { ok: boolean; output: string; error: 'no_cli' | 'timeout' | 'failed' | null }): MarketResult {
  if (r.ok) return { ok: true, error: null, output: r.output };
  const needsYes = r.error === 'failed' && /accept-command|shownCommand|confirmation/i.test(r.output);
  return { ok: false, error: needsYes ? 'needs_confirm' : (r.error ?? 'failed'), output: r.output };
}

const fail = (error: MarketError): MarketResult => ({ ok: false, error, output: '' });

/** Checks a request's names. Returns the error to send back, or null when it is fine. */
function checkRequest(name: unknown, marketplace: unknown, mustBeListed: boolean): MarketError | null {
  if (marketplace !== MARKETPLACE) return 'bad_marketplace';
  if (!isStr(name) || !NAME_RE.test(name)) return 'bad_name';
  const entries = readEntries();
  if (!entries) return 'no_marketplace';
  if (mustBeListed && !entries.some(e => e?.name === name)) return 'not_in_marketplace';
  return null;
}

export function installPlugin(name: unknown, marketplace: unknown): Promise<MarketResult> {
  const bad = checkRequest(name, marketplace, true);
  if (bad) return Promise.resolve(fail(bad));
  const id = `${String(name)}@${MARKETPLACE}`;
  return serial(async () => outcome(await runCli(['plugin', 'install', id, '--scope', 'user'])));
}

export function uninstallPlugin(name: unknown, marketplace: unknown): Promise<MarketResult> {
  const bad = checkRequest(name, marketplace, false);
  if (bad) return Promise.resolve(fail(bad));
  const id = `${String(name)}@${MARKETPLACE}`;
  if (!installedKeys().has(id)) return Promise.resolve(fail('not_installed'));
  return serial(async () => outcome(await runCli(['plugin', 'uninstall', id, '--scope', 'user'])));
}

/** Checks the Anthropic marketplace for updates (the CLI's own update, which fetches it). */
export function refreshMarket(): Promise<MarketResult> {
  return serial(async () => outcome(await runCli(['plugin', 'marketplace', 'update', MARKETPLACE])));
}
