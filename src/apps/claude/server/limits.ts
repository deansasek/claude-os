// Plan limits from Anthropic's usage endpoint.
// The token comes from CLAUDE_METER_TOKEN, ~/.claude-meter-token, or Claude Code's own
// sign-in. When that sign-in has expired, the Claude CLI is asked to renew it
// (`claude auth status`, which uses no model quota). The token never leaves this PC
// except to go to api.anthropic.com, and is never included in /api/usage.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import type { LimitEntry, Limits } from '../api.ts';
import path from 'node:path';
import { CREDS_FILE, HUB, TOKEN_FILE, readJson, which } from '../../../core/server/paths.ts';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const EVERY_MS = 120e3;
const CLAUDE = which('claude');
const CACHE_FILE = path.join(HUB, '.limits-cache.json');   // last good numbers, so restarts don't show dashes
let lastRenew = 0;
let backoffUntil = 0, backoffMs = 0;

export const LIMITS: Limits = { status: 'no_token', error: null, updated: null, source: null, limits: {}, list: [], breakdown: [] };

const cached = readJson<Limits>(CACHE_FILE);
if (cached?.limits && Object.keys(cached.limits).length) {
  Object.assign(LIMITS, cached, { status: 'ok', error: 'showing saved numbers until the next check' });
}

interface Token { token: string; source: 'env' | 'file' | 'claude'; expires: number | null }

function readToken(): Token | null {
  const env = process.env.CLAUDE_METER_TOKEN?.trim();
  if (env) return { token: env, source: 'env', expires: null };
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').replace(/^﻿/, '').trim();
    if (t) return { token: t, source: 'file', expires: null };
  } catch { /* no token file */ }
  const o = readJson<any>(CREDS_FILE)?.claudeAiOauth;
  if (o?.accessToken) return { token: o.accessToken, source: 'claude', expires: o.expiresAt || 0 };
  return null;
}

export function readPlan(): string | null {
  return readJson<any>(CREDS_FILE)?.claudeAiOauth?.subscriptionType ?? null;
}

/** Let the Claude CLI refresh its own sign-in. Throttled to once per 5 minutes. */
function renew(force = false): Promise<boolean> {
  if (!CLAUDE || (!force && Date.now() - lastRenew < 300e3)) return Promise.resolve(false);
  lastRenew = Date.now();
  return new Promise(resolve => {
    execFile(CLAUDE, ['auth', 'status', '--json'], { timeout: 90e3, windowsHide: true }, err => {
      console.log(new Date().toLocaleTimeString(), err ? `renew failed: ${err.message}` : 'renewed Claude sign-in via CLI');
      resolve(!err);
    });
  });
}

class HttpError extends Error {
  code: number;
  constructor(code: number) { super(`HTTP ${code}`); this.code = code; }
}

async function fetchUsage(token: string): Promise<any> {
  const r = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'claude-usage-meter' },
    signal: AbortSignal.timeout(20e3),
  });
  if (!r.ok) throw new HttpError(r.status);
  return r.json();
}

function shape(body: any): Pick<Limits, 'limits' | 'list' | 'breakdown'> {
  const limits: Limits['limits'] = {};
  for (const [k, v] of Object.entries<any>(body)) {
    if (v && typeof v === 'object' && v.utilization != null) limits[k] = { used: v.utilization, resets_at: v.resets_at ?? null };
  }
  const list: LimitEntry[] = (body.limits || []).map((l: any) => ({
    kind: l.kind, group: l.group, percent: l.percent, severity: l.severity, resets_at: l.resets_at ?? null,
    model: l.scope?.model?.display_name ?? null, active: !!l.is_active,
  }));
  const breakdown = (body.seven_day_breakdown?.rows || [])
    .filter((r: any) => r.percent)
    .map((r: any) => ({ name: r.display_name, percent: r.percent, of_limit: r.percent_of_limit }));
  return { limits, list, breakdown };
}

async function pollOnce(): Promise<void> {
  let tok = readToken();
  if (tok?.source === 'claude' && tok.expires != null && tok.expires - Date.now() < 300e3 && await renew()) tok = readToken();
  if (!tok) { Object.assign(LIMITS, { status: 'no_token', error: null, source: null }); return; }
  try {
    let body: any;
    try {
      body = await fetchUsage(tok.token);
    } catch (e) {
      if (e instanceof HttpError && e.code === 401 && tok.source === 'claude' && await renew(true)) {
        tok = readToken();
        if (!tok) throw e;
        body = await fetchUsage(tok.token);
      } else throw e;
    }
    Object.assign(LIMITS, { status: 'ok', error: null, source: tok.source, updated: new Date().toISOString() }, shape(body));
    backoffMs = 0;
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(LIMITS)); } catch { /* not fatal */ }
  } catch (e) {
    // keep the last good numbers; just flag the problem
    if (e instanceof HttpError && e.code === 429) {
      // rate limited: wait 5, 10, 20, then 30 minutes between tries
      backoffMs = Math.min(Math.max(backoffMs * 2, 5 * 60e3), 30 * 60e3);
      backoffUntil = Date.now() + backoffMs;
      const haveNumbers = Object.keys(LIMITS.limits).length > 0;
      Object.assign(LIMITS, { status: haveNumbers ? 'ok' : 'error', error: `rate limited; trying again in ${backoffMs / 60e3} minutes` });
    } else if (e instanceof HttpError) {
      Object.assign(LIMITS, { status: e.code === 401 ? 'expired' : 'error', error: e.message + (e.code === 403 ? ' (token can’t read usage)' : '') });
    } else {
      Object.assign(LIMITS, { status: 'error', error: String((e as Error).message || e).slice(0, 120) });
    }
  }
}

export function startLimits(): void {
  const loop = async () => {
    if (Date.now() >= backoffUntil) await pollOnce();
    setTimeout(loop, EVERY_MS);
  };
  void loop();
}
