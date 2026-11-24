// Plugins for the Claude sessions the hub runs: what this PC's Claude Code already has (MCP servers, claude.ai
// connectors, skills, plugins), read from the user's own files, plus the on/off choices ClaudeOS keeps in
// plugins-state.json. The user's ~/.claude* files are only ever read, never written. Secrets (env values,
// headers, tokens in URLs) are never returned: only their counts.
//
// How the choices reach a session (turnPluginOptions, used by claude/server/turns.ts):
//   settingSources     user, project and local settings load, as the SDK does by default (now stated)
//   settings           flag-tier overlay: deniedMcpServers for switched-off servers and connectors,
//                      enabledPlugins: false for switched-off plugins
//   skills             the enabled skill names, only once some skill is switched off
//   mcpServers         ClaudeOS's own servers that are on; sent over stdin, so their env and headers stay off the command line
//   plugins            ClaudeOS plugin folders that are on
//   disallowedTools    mcp__<server> for switched-off servers
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query, type McpServerStatus, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';
import { HUB, readJsonOrSetAside, writeJsonFile } from '../../../core/server/paths.ts';
import type { McpInput, PluginItem, PluginStatus, PluginsView } from '../api.ts';

const STATE_FILE = process.env.CLAUDEOS_PLUGINS_STATE_FILE || path.join(HUB, 'plugins-state.json');   // a test sets CLAUDEOS_PLUGINS_STATE_FILE
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_JSON = path.join(HOME, '.claude.json');
const MARKETPLACES = path.join(CLAUDE_DIR, 'plugins', 'marketplaces');
const PROBE_MS = 25e3;
const PROBE_TTL_MS = 10 * 60e3;
const MAX_OFF = 500;

// ---------- the ClaudeOS state (plugins-state.json) ----------
interface CustomMcp {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;      // values stay here on the PC; the UI only gets the count
  headers?: Record<string, string>;
}
interface State {
  off: string[];          // switched off: 'mcp:<name>', 'skill:<name>', 'plugin:<id>' or 'plugin:path:<folder>'
  custom: CustomMcp[];    // MCP servers added in ClaudeOS
  folders: string[];      // local plugin folders added in ClaudeOS
}

const isStr = (v: unknown): v is string => typeof v === 'string';

function loadState(): State {
  const empty: State = { off: [], custom: [], folders: [] };
  try {
    const o = readJsonOrSetAside<Partial<Record<keyof State, unknown>>>(STATE_FILE);
    if (!o) return empty;
    const custom = Array.isArray(o.custom) ? o.custom.filter((c): c is CustomMcp => !!c && typeof c === 'object'
      && isStr((c as CustomMcp).name) && ['stdio', 'http', 'sse'].includes((c as CustomMcp).type)) : [];
    return {
      off: Array.isArray(o.off) ? o.off.filter(isStr).slice(0, MAX_OFF) : [],
      custom,
      folders: Array.isArray(o.folders) ? o.folders.filter(isStr).slice(0, 50) : [],
    };
  } catch { return empty; }
}

let state: State = loadState();
function saveState(): void { writeJsonFile(STATE_FILE, state, { indent: 2 }); }

// ---------- small helpers ----------
/** Text of a file, without a byte-order mark (some editors write one). */
const readText = (file: string): string => fs.readFileSync(file, 'utf8').replace(/^﻿/, '');

function readJson(file: string): any {
  try { return JSON.parse(readText(file)); } catch { return null; }
}
const isFile = (p: string): boolean => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
/** Folder paths compare case-insensitively with forward slashes (how ~/.claude.json writes them on Windows). */
const sameFolder = (a: string, b: string): boolean => path.resolve(a).replace(/\\/g, '/').toLowerCase() === path.resolve(b).replace(/\\/g, '/').toLowerCase();
/** The name Claude Code gives a server's tools: mcp__<this>__<tool>. */
const toolPrefix = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '_');
const tilde = (p: string): string => (p.toLowerCase().startsWith(HOME.toLowerCase()) ? `~${p.slice(HOME.length)}`.replace(/\\/g, '/') : p);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A URL without its user, password or query string (a query can hold a key). */
function safeUrl(raw: string): string {
  try { const u = new URL(raw); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return '(not a valid address)'; }
}

// ---------- reading the user's Claude Code files (read only) ----------
interface FoundMcp { name: string; cfg: any; scope: 'local' | 'project' | 'user' | 'settings' }

/** The MCP servers Claude Code would read for a folder, nearest first (local, project, user, settings). */
function mcpFromFiles(cwd: string): FoundMcp[] {
  const out: FoundMcp[] = [];
  const add = (obj: unknown, scope: FoundMcp['scope']) => {
    if (obj && typeof obj === 'object') for (const [name, cfg] of Object.entries(obj as Record<string, unknown>)) {
      if (cfg && typeof cfg === 'object') out.push({ name, cfg, scope });
    }
  };
  const cj = readJson(CLAUDE_JSON);
  for (const [p, v] of Object.entries<any>(cj?.projects ?? {})) if (sameFolder(p, cwd)) add(v?.mcpServers, 'local');
  add(readJson(path.join(cwd, '.mcp.json'))?.mcpServers, 'project');
  add(cj?.mcpServers, 'user');
  add(readJson(path.join(CLAUDE_DIR, 'settings.json'))?.mcpServers, 'settings');
  return out;
}

const SCOPE_LABEL: Record<FoundMcp['scope'], string> = { local: 'Custom MCP', project: 'Project MCP', user: 'Custom MCP', settings: 'Custom MCP' };
const SCOPE_SOURCE: Record<FoundMcp['scope'], string> = {
  local: '~/.claude.json, for this folder', project: '.mcp.json in this folder', user: '~/.claude.json', settings: '~/.claude/settings.json',
};

/** What a server config says, with every secret value left out. */
function describeConfig(cfg: any): { type: string; detail: string[] } {
  const type = cfg.type === 'sse' || cfg.type === 'http' || cfg.type === 'stdio' ? cfg.type : cfg.url ? 'http' : 'stdio';
  const detail: string[] = [];
  if (type === 'stdio') {
    const args = Array.isArray(cfg.args) ? cfg.args.length : 0;
    detail.push(`Runs: ${path.basename(String(cfg.command ?? '')) || '(no command)'}${args ? ` · ${plural(args, 'argument')}` : ''}`);
  } else {
    detail.push(`Address: ${safeUrl(String(cfg.url ?? ''))}`);
  }
  const env = cfg.env && typeof cfg.env === 'object' ? Object.keys(cfg.env).length : 0;
  const hdr = cfg.headers && typeof cfg.headers === 'object' ? Object.keys(cfg.headers).length : 0;
  if (env) detail.push(`${plural(env, 'env var')} (values hidden)`);
  if (hdr) detail.push(`${plural(hdr, 'header')} (values hidden)`);
  return { type, detail };
}

/** Claude.ai connectors Claude Code knows about from its own cache (names only). */
function connectorNamesFromCache(): string[] {
  const c = readJson(path.join(CLAUDE_DIR, 'mcp-needs-auth-cache.json'));
  return c && typeof c === 'object' ? Object.keys(c).filter(n => n.startsWith('claude.ai ')) : [];
}

// ---------- skills ----------
interface SkillDef { name: string; description: string; source: string; dir: string }

/** name and description from a SKILL.md's frontmatter (multi-line values are joined). */
function readSkillMd(file: string): { name: string; description: string } {
  let text = '';
  try { text = readText(file).slice(0, 6000); } catch { return { name: '', description: '' }; }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { name: '', description: '' };
  const lines = m[1].split(/\r?\n/);
  const get = (key: string): string => {
    const i = lines.findIndex(l => l.startsWith(`${key}:`));
    if (i < 0) return '';
    let v = lines[i].slice(key.length + 1).trim();
    if (v === '' || /^[>|]/.test(v)) {
      const cont: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s+/.test(lines[j]); j++) cont.push(lines[j].trim());
      v = cont.join(' ');
    }
    return v.replace(/^(["'])(.*)\1$/, '$2');
  };
  return { name: get('name'), description: clip(get('description'), 300) };
}

/** Folders under root that hold a SKILL.md (a skill folder is not searched inside). */
function walkSkills(root: string, found: string[], depth = 0): void {
  if (depth > 4 || found.length > 300) return;
  if (isFile(path.join(root, 'SKILL.md'))) { found.push(root); return; }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walkSkills(path.join(root, e.name), found, depth + 1);
  }
}

/** Skills a session in this folder has: the folder's own, the user's, then each enabled plugin's (named plugin:skill). */
function discoverSkills(cwd: string): SkillDef[] {
  const out: SkillDef[] = [];
  const seen = new Set<string>();
  const from = (root: string, source: string, prefix: string) => {
    const dirs: string[] = [];
    walkSkills(root, dirs);
    for (const d of dirs) {
      const fm = readSkillMd(path.join(d, 'SKILL.md'));
      const name = prefix + (fm.name || path.basename(d));
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, description: fm.description, source, dir: d });
    }
  };
  from(path.join(cwd, '.claude', 'skills'), 'project', '');
  from(path.join(CLAUDE_DIR, 'skills'), 'user', '');
  for (const pl of discoverPlugins(cwd)) if (pl.dir) from(path.join(pl.dir, 'skills'), `plugin ${pl.name}`, `${pl.name}:`);
  return out;
}

// ---------- plugins ----------
interface PluginDef {
  id: string;              // 'name@marketplace', or 'path:<folder>' for a ClaudeOS folder
  name: string;
  marketplace: string;     // the marketplace name, or 'ClaudeOS folder'
  dir: string | null;      // null when it isn't on this PC
  description: string;
  parts: string[];         // "3 skills", "hooks", "2 MCP servers"…
}

function manifestOf(dir: string): any {
  return readJson(path.join(dir, '.claude-plugin', 'plugin.json')) ?? readJson(path.join(dir, 'plugin.json'));
}

/** What a plugin folder contains, as short phrases ("3 skills", "hooks"). Used here and by the Discover list (market.ts). */
export function partsOf(dir: string | null): string[] {
  if (!dir) return [];
  const files = (sub: string, re: RegExp): number => {
    try { return fs.readdirSync(path.join(dir, sub)).filter(f => re.test(f)).length; } catch { return 0; }
  };
  const skills: string[] = [];
  walkSkills(path.join(dir, 'skills'), skills);
  const mcp = readJson(path.join(dir, '.mcp.json'))?.mcpServers ?? manifestOf(dir)?.mcpServers ?? {};
  const parts: string[] = [];
  if (skills.length) parts.push(plural(skills.length, 'skill'));
  const commands = files('commands', /\.md$/i);
  if (commands) parts.push(plural(commands, 'command'));
  const agents = files('agents', /\.md$/i);
  if (agents) parts.push(plural(agents, 'agent'));
  if (isFile(path.join(dir, 'hooks', 'hooks.json')) || isFile(path.join(dir, 'hooks.json'))) parts.push('hooks');
  const servers = Object.keys(mcp).length;
  if (servers) parts.push(plural(servers, 'MCP server'));
  return parts;
}

function discoverPlugins(cwd: string): PluginDef[] {
  // enabled plugins: the user's, the folder's and its local settings (later files win), then the installed list
  const enabled = new Map<string, boolean>();
  for (const f of [path.join(CLAUDE_DIR, 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]) {
    const ep = readJson(f)?.enabledPlugins;
    if (ep && typeof ep === 'object') for (const [id, v] of Object.entries<unknown>(ep)) if (typeof v === 'boolean') enabled.set(id, v);
  }
  const installed = readJson(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  const installedDir = new Map<string, string>();
  for (const [id, entries] of Object.entries<any>(installed)) {
    if (!enabled.has(id)) enabled.set(id, true);
    const p = Array.isArray(entries) ? entries[0]?.installPath : null;
    if (typeof p === 'string' && isDir(p)) installedDir.set(id, p);
  }

  const out: PluginDef[] = [];
  for (const [id, on] of enabled) {
    if (!on) continue;
    const [name, market = ''] = id.split('@');
    let dir = installedDir.get(id) ?? null;
    if (!dir) for (const sub of ['plugins', 'external_plugins']) {
      const d = path.join(MARKETPLACES, market, sub, name);
      if (isDir(d)) { dir = d; break; }
    }
    const m = dir ? manifestOf(dir) : null;
    out.push({ id, name: m?.name || name, marketplace: market, dir, description: clip(String(m?.description ?? ''), 300), parts: partsOf(dir) });
  }

  for (const folder of state.folders) {
    if (!isDir(folder)) continue;
    const m = manifestOf(folder);
    out.push({
      id: `path:${folder}`, name: m?.name || path.basename(folder), marketplace: 'ClaudeOS folder', dir: folder,
      description: clip(String(m?.description ?? ''), 300), parts: partsOf(folder),
    });
  }
  return out;
}

// ---------- the live check: what a session actually has (the SDK's own status) ----------
export interface Probe { cwd: string; at: number; servers: McpServerStatus[]; error: string | null; pending: boolean }
const probes = new Map<string, Probe>();
const probing = new Map<string, Promise<Probe>>();

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timed out')), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

/** The latest status for a folder's sessions: cached for ten minutes, unless `force`. Shared by callers while one runs. */
export async function probe(cwd: string, force = false): Promise<Probe> {
  const key = path.resolve(cwd).toLowerCase();
  const hit = probes.get(key);
  if (hit && !force && Date.now() - hit.at < PROBE_TTL_MS) return hit;
  const running = probing.get(key);
  if (running) return running;
  const job = runProbe(cwd).then(p => { probes.set(key, p); return p; }).finally(() => { probing.delete(key); });
  probing.set(key, job);
  return job;
}

/** Start a Claude Code process with the same options a session gets, ask its MCP status, and close it. No message is sent. */
async function runProbe(cwd: string): Promise<Probe> {
  const at = Date.now();
  const dir = isDir(cwd) ? cwd : HOME;
  let release!: () => void;
  const idle = new Promise<void>(r => { release = r; });
  async function* never() { await idle; }
  let q: Query | null = null;
  try {
    q = query({ prompt: never(), options: { ...turnPluginOptions(dir), cwd: dir, permissionMode: 'default' } as Options });
    const deadline = at + PROBE_MS;
    let servers: McpServerStatus[] = [];
    // the first answers come before the servers have started: wait until some are listed and none is still pending
    for (;;) {
      servers = await withTimeout(q.mcpServerStatus(), 10e3);
      if ((servers.length > 0 && !servers.some(s => s.status === 'pending')) || Date.now() > deadline) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    return { cwd, at, servers, error: null, pending: servers.some(s => s.status === 'pending') };
  } catch (e) {
    return { cwd, at, servers: [], error: clip(String((e as Error).message || e), 160), pending: false };
  } finally {
    release();
    try { q?.close(); } catch { /* already gone */ }
  }
}

// ---------- the view ----------
const ITEM_STATUS = (s: string): PluginStatus => (['connected', 'pending', 'needs-auth', 'failed', 'disabled'].includes(s) ? s as PluginStatus : 'unknown');

/** Everything Settings → Plugins lists for a folder. Secrets are left out by construction. */
export function inventory(cwd: string, live: Probe | null): PluginItem[] {
  const items = new Map<string, PluginItem>();
  const put = (it: Omit<PluginItem, 'on'>) => { if (!items.has(it.key)) items.set(it.key, { ...it, on: !state.off.includes(it.key) }); };
  const liveBy = new Map((live?.servers ?? []).map(s => [s.name, s]));

  for (const c of state.custom) {
    const d = describeConfig(c.type === 'stdio' ? { type: 'stdio', command: c.command, args: c.args, env: c.env } : { type: c.type, url: c.url, headers: c.headers });
    put({ key: `mcp:${c.name}`, kind: 'mcp', name: c.name, subtitle: `ClaudeOS · ${c.type}`, description: 'Added in ClaudeOS, for the sessions it runs.',
      source: 'ClaudeOS plugins-state.json', detail: d.detail, status: 'unknown', tools: null, error: null, custom: true });
  }
  for (const f of mcpFromFiles(cwd)) {
    const d = describeConfig(f.cfg);
    put({ key: `mcp:${f.name}`, kind: 'mcp', name: f.name, subtitle: `${SCOPE_LABEL[f.scope]} · ${d.type}`, description: '',
      source: SCOPE_SOURCE[f.scope], detail: d.detail, status: 'unknown', tools: null, error: null, custom: false });
  }
  // from Claude Code's own cache: without a live check, a connector it marks as needing sign-in is shown so
  // (with one, the live list above says what is connected)
  const checked = !!live && !live.error;
  for (const n of connectorNamesFromCache()) {
    put({ key: `mcp:${n}`, kind: 'connector', name: n, subtitle: 'Connector · claude.ai', description: 'A claude.ai connector, signed in through your Claude account.',
      source: 'claude.ai', detail: [], status: checked ? 'unknown' : 'needs-auth', tools: null, error: null, custom: false });
  }
  // what the live check found: fills in status, and adds servers the files above don't name (plugins, connectors)
  for (const [key, it] of items) {
    if (!key.startsWith('mcp:')) continue;
    const s = liveBy.get(it.name);
    if (s) { items.set(key, { ...it, status: ITEM_STATUS(s.status), tools: s.tools ? s.tools.length : null, error: s.error ? clip(s.error, 160) : null, kind: it.kind === 'connector' || s.scope === 'claudeai' ? 'connector' : it.kind }); }
  }
  for (const s of live?.servers ?? []) {
    if (items.has(`mcp:${s.name}`)) continue;
    const isConnector = s.scope === 'claudeai';
    put({ key: `mcp:${s.name}`, kind: isConnector ? 'connector' : 'mcp', name: s.name,
      subtitle: isConnector ? 'Connector · claude.ai' : `${s.source === 'plugin' ? 'Plugin' : 'Custom MCP'} · ${s.config && 'url' in s.config ? 'http' : 'stdio'}`,
      description: isConnector ? 'A claude.ai connector, signed in through your Claude account.' : '',
      source: isConnector ? 'claude.ai' : (s.source === 'plugin' ? 'A plugin' : s.scope ?? 'Claude Code'),
      detail: [], status: ITEM_STATUS(s.status), tools: s.tools ? s.tools.length : null, error: s.error ? clip(s.error, 160) : null, custom: false });
  }

  for (const s of discoverSkills(cwd)) {
    put({ key: `skill:${s.name}`, kind: 'skill', name: s.name, subtitle: `Skill · ${s.source}`, description: s.description,
      source: tilde(s.dir), detail: [`Folder: ${tilde(s.dir)}`], status: 'ok', tools: null, error: null, custom: false });
  }
  for (const pl of discoverPlugins(cwd)) {
    const isFolder = pl.id.startsWith('path:');
    put({ key: `plugin:${pl.id}`, kind: 'plugin', name: pl.name, subtitle: `Plugin · ${pl.marketplace || 'marketplace'}`, description: pl.description,
      source: pl.dir ? tilde(pl.dir) : 'Not found on this PC', detail: pl.parts.length ? [`Includes: ${pl.parts.join(' · ')}`] : [],
      status: pl.dir ? 'ok' : 'missing', tools: null, error: null, custom: isFolder });
  }
  return [...items.values()];
}

/** The Settings → Plugins view for a folder (`project` names it for the screen). */
export async function pluginsView(cwd: string, project: { id: string; name: string } | null, fresh: boolean): Promise<PluginsView> {
  const live = await probe(cwd, fresh).catch(() => null);
  return {
    items: inventory(cwd, live),
    project,
    probe: live ? { at: live.at, error: live.error, pending: live.pending } : null,
  };
}

// ---------- what a session gets ----------
const serverConfig = (c: CustomMcp): any => (c.type === 'stdio'
  ? { type: 'stdio', command: c.command ?? '', args: c.args ?? [], env: c.env ?? {} }
  : { type: c.type, url: c.url ?? '', headers: c.headers ?? {} });

/** The SDK options that apply ClaudeOS's choices, for a session that runs in `cwd`. Nothing here writes a file. */
export function turnPluginOptions(cwd: string): Partial<Options> {
  const off = new Set(state.off);
  const out: Partial<Options> = { settingSources: ['user', 'project', 'local'] };
  const flag: Record<string, any> = {};
  const denied: { serverName: string }[] = [];
  const disallowed: string[] = [];
  const enabledPlugins: Record<string, boolean> = {};
  for (const k of off) {
    if (k.startsWith('mcp:')) { const n = k.slice(4); denied.push({ serverName: n }); disallowed.push(`mcp__${toolPrefix(n)}`); }
    else if (k.startsWith('plugin:') && !k.startsWith('plugin:path:')) enabledPlugins[k.slice('plugin:'.length)] = false;
  }
  if (denied.length) flag.deniedMcpServers = denied;
  if (Object.keys(enabledPlugins).length) flag.enabledPlugins = enabledPlugins;
  if (Object.keys(flag).length) out.settings = flag as Options['settings'];
  if (disallowed.length) out.disallowedTools = disallowed;
  if ([...off].some(k => k.startsWith('skill:'))) {
    out.skills = discoverSkills(cwd).map(s => s.name).filter(n => !off.has(`skill:${n}`));
  }
  const custom = state.custom.filter(c => !off.has(`mcp:${c.name}`));
  if (custom.length) {
    out.mcpServers = Object.fromEntries(custom.map(c => [c.name, serverConfig(c)]));
    out.mcpServersDelivery = 'initialize';
  }
  const folders = state.folders.filter(f => !off.has(`plugin:path:${f}`) && isDir(f));
  if (folders.length) out.plugins = folders.map(p => ({ type: 'local' as const, path: p }));
  return out;
}

// ---------- changes from the screen ----------
const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;

/** "KEY=value; KEY2=value" to a map. Returns null when a pair is malformed. */
function parsePairs(text: string | undefined, keyRe: RegExp): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of String(text ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    if (i < 1) return null;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (!keyRe.test(k) || !v) return null;
    out[k] = v;
  }
  if (Object.keys(out).length > 20) return null;
  return out;
}

/** Arguments split on spaces, with "quoted parts" kept whole. */
const splitArgs = (text: string): string[] => [...text.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2]);

export function addCustomMcp(input: McpInput): { ok: true } | { ok: false; error: string } {
  const name = String(input.name ?? '').trim();
  if (!NAME_RE.test(name)) return { ok: false, error: 'bad_name' };
  if (state.custom.some(c => c.name === name) || mcpFromFiles(HOME).some(f => f.name === name)) return { ok: false, error: 'name_taken' };
  const env = parsePairs(input.env, KEY_RE);
  const headers = parsePairs(input.headers, HEADER_RE);
  if (env === null || headers === null) return { ok: false, error: 'bad_pairs' };
  let c: CustomMcp;
  if (input.type === 'stdio') {
    const command = String(input.command ?? '').trim();
    if (!command || command.length > 300) return { ok: false, error: 'bad_command' };
    c = { name, type: 'stdio', command, args: splitArgs(String(input.args ?? '')).slice(0, 40), env };
  } else if (input.type === 'http' || input.type === 'sse') {
    let u: URL;
    try { u = new URL(String(input.url ?? '').trim()); } catch { return { ok: false, error: 'bad_url' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'bad_url' };
    c = { name, type: input.type, url: u.toString(), headers };
  } else {
    return { ok: false, error: 'bad_type' };
  }
  state.custom.push(c);
  state.off = state.off.filter(k => k !== `mcp:${name}`);
  saveState();
  return { ok: true };
}

export function removeCustomMcp(name: string): boolean {
  const before = state.custom.length;
  state.custom = state.custom.filter(c => c.name !== name);
  state.off = state.off.filter(k => k !== `mcp:${name}`);
  if (state.custom.length === before) return false;
  saveState();
  return true;
}

/** Switch one item on or off for ClaudeOS sessions. Keys are the PluginItem.key values. */
export function setOn(key: string, on: boolean): { ok: true } | { ok: false; error: string } {
  if (typeof key !== 'string' || key.length > 300 || !/^(mcp|skill|plugin):/.test(key)) return { ok: false, error: 'bad_key' };
  const has = state.off.includes(key);
  if (on && has) state.off = state.off.filter(k => k !== key);
  else if (!on && !has) { if (state.off.length >= MAX_OFF) return { ok: false, error: 'too_many' }; state.off.push(key); }
  else return { ok: true };
  saveState();
  return { ok: true };
}

/** Add a folder with a plugin in it (a .claude-plugin/plugin.json, or any of its parts). */
export function addFolder(p: string): { ok: true } | { ok: false; error: string } {
  const folder = path.resolve(String(p ?? '').trim());
  if (!isDir(folder)) return { ok: false, error: 'no_such_folder' };
  const looksLikePlugin = isFile(path.join(folder, '.claude-plugin', 'plugin.json')) || isFile(path.join(folder, 'plugin.json'))
    || isDir(path.join(folder, 'skills')) || isDir(path.join(folder, 'commands')) || isDir(path.join(folder, 'agents'));
  if (!looksLikePlugin) return { ok: false, error: 'not_a_plugin' };
  if (state.folders.some(f => sameFolder(f, folder))) return { ok: true };
  if (state.folders.length >= 50) return { ok: false, error: 'too_many' };
  state.folders.push(folder);
  saveState();
  return { ok: true };
}

export function removeFolder(p: string): boolean {
  const folder = path.resolve(String(p ?? ''));
  if (!state.folders.some(f => sameFolder(f, folder))) return false;
  // Remove every entry for this folder, whatever the letter case of its path.
  state.folders = state.folders.filter(f => !sameFolder(f, folder));
  state.off = state.off.filter(k => !(k.startsWith('plugin:path:') && sameFolder(k.slice('plugin:path:'.length), folder)));
  saveState();
  return true;
}

/** Is this a server the user has (by name) somewhere the files say, or one ClaudeOS added? For the test route. */
export function knownServer(name: string, cwd: string): boolean {
  return state.custom.some(c => c.name === name) || mcpFromFiles(cwd).some(f => f.name === name) || connectorNamesFromCache().includes(name);
}
