// The calendar: its address, reading it from the PC, and today's and tomorrow's events.
//
// The address (an ICS "secret address", e.g. Google's or Outlook's) lives in hub/.calendar-config.json on the PC
// (outside src/, so it is never served). It is a secret: the page only ever sees its host, and it is never logged.
// Reading it: 10 s timeout for the whole read, at most 2 MB, and a redirect is followed only when it stays on the same
// host (never to another site, never from https down to http). A copy is kept for 5 minutes; when a read fails, the
// last good copy (up to 12 hours old) is shown, marked stale.
import fs from 'node:fs';
import path from 'node:path';
import { HUB } from '../../../core/server/paths.ts';
import type { CalConfigResult, CalEvent, CalEvents, CalStatus } from '../api.ts';
import { occurrences, parseIcs, type RawEvent } from './ics.ts';

const FILE = path.join(HUB, '.calendar-config.json');
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FRESH_MS = 5 * 60e3;
const RETRY_MS = 60e3;          // after a failed read, wait this long before trying again (unless asked to)
const KEEP_MS = 12 * 3600e3;
const MAX_SHOWN = 200;

interface Config { address: string }

function load(): Config {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')) as Partial<Config>;
    return { address: typeof c.address === 'string' ? c.address : '' };
  } catch { return { address: '' }; }
}
let cfg = load();

function save(): boolean {
  try {
    if (!cfg.address) { fs.rmSync(FILE, { force: true }); return true; }
    fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (e) {
    console.log('calendar: could not save the settings:', (e as NodeJS.ErrnoException).code ?? 'error');
    return false;
  }
}

/** webcal://, http:// or https:// only; no user name or password in it. '' clears it; null: not an address. */
function cleanAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s) return '';
  s = s.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

const mask = (a: string): string => { try { return a ? `${new URL(a).host}/…` : ''; } catch { return ''; } };

export const status = (): CalStatus => ({ configured: !!cfg.address, address: mask(cfg.address) });

export function saveConfig(raw: unknown): CalConfigResult {
  if (typeof raw !== 'string' || raw.length > 2000) return { ...status(), ok: false, message: 'That address is too long.' };
  const a = cleanAddress(raw);
  if (a == null) return { ...status(), ok: false, message: 'That doesn’t look like a calendar address. It starts with https:// or webcal:// and usually ends in .ics.' };
  if (a !== cfg.address) { cfg.address = a; cache = null; lastError = ''; lastTry = 0; }
  const ok = save();
  console.log(`calendar: address ${cfg.address ? 'set' : 'removed'}`);
  return { ...status(), ok, ...(ok ? {} : { message: 'The PC couldn’t save the address.' }) };
}

// ---------- reading the calendar ----------
class CalError extends Error {}

function reason(e: unknown): string {
  if (e instanceof CalError) return e.message;
  const err = e as Error & { cause?: { code?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'The calendar didn’t answer within 10 seconds.';
  const code = err?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The calendar’s address couldn’t be found. Is the PC online?';
  if (code === 'ECONNREFUSED') return 'Nothing answered at the calendar’s address.';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'The calendar can’t be reached from the PC.';
  if (code && /CERT|SSL|TLS/i.test(code)) return 'The secure connection to the calendar failed.';
  return 'Couldn’t read the calendar.';
}

async function readCapped(res: Response): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > MAX_BYTES) throw new CalError('That calendar is too big to read (over 2 MB).');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { void reader.cancel().catch(() => {}); throw new CalError('That calendar is too big to read (over 2 MB).'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchIcs(address: string): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = new URL(address);
  const host = url.hostname;
  for (let hops = 0; ; hops++) {
    const res = await fetch(url, { redirect: 'manual', signal, headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5', 'User-Agent': 'ClaudeOS-Calendar/1.0' } });
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => {});
      const loc = res.headers.get('location');
      if (!loc || hops >= MAX_REDIRECTS) throw new CalError('The calendar address keeps redirecting.');
      let next: URL;
      try { next = new URL(loc, url); } catch { throw new CalError('The calendar address redirects somewhere odd.'); }
      if (next.hostname !== host || (next.protocol !== 'https:' && next.protocol !== 'http:') || (url.protocol === 'https:' && next.protocol === 'http:')) {
        throw new CalError('The calendar address redirects to another site, so ClaudeOS didn’t follow it. Use the calendar’s own address.');
      }
      url = next;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new CalError('The calendar refused the address. It may have been reset: copy the secret address again.');
    if (res.status === 404 || res.status === 410) throw new CalError('There is no calendar at that address (it may have been reset).');
    if (!res.ok) throw new CalError(`The calendar answered with an error (${res.status}).`);
    const text = await readCapped(res);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new CalError('That address answered, but not with a calendar. Use the address “in iCal format” (it ends in .ics).');
    return text;
  }
}

let cache: { address: string; events: RawEvent[]; at: number } | null = null;
let lastError = '', lastTry = 0;
let inflight: Promise<void> | null = null;

function ensure(force: boolean): Promise<void> {
  const address = cfg.address;
  if (!address) return Promise.resolve();
  const fresh = cache && cache.address === address && Date.now() - cache.at < FRESH_MS;
  if (fresh && !force) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && lastError && Date.now() - lastTry < RETRY_MS) return Promise.resolve();
  lastTry = Date.now();
  inflight = (async () => {
    try {
      const events = parseIcs(await fetchIcs(address));
      if (cfg.address === address) { cache = { address, events, at: Date.now() }; lastError = ''; }
    } catch (e) {
      if (cfg.address === address) { lastError = reason(e); console.log(`calendar: couldn’t read the calendar: ${lastError}`); }
    } finally { inflight = null; }
  })();
  return inflight;
}

const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today's and tomorrow's events (the PC's days), sorted: today first; all-day events first, then by start time. */
export async function events(force = false): Promise<CalEvents> {
  const now = new Date();
  const today = ymd(now);
  if (!cfg.address) return { status: 'not_set', events: [], today };
  await ensure(force);
  const c = cache && cache.address === cfg.address && Date.now() - cache.at < KEEP_MS ? cache : null;
  if (!c) return { status: 'error', events: [], today, error: lastError || 'Couldn’t read the calendar.' };
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
  const out: CalEvent[] = [];
  for (const o of occurrences(c.events, d0, d2)) {
    for (const [day, from, to] of [['today', d0, d1], ['tomorrow', d1, d2]] as const) {
      if (o.start < to && (o.end > from || (o.end === o.start && o.start >= from))) {
        out.push({ title: o.title, start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString(), allDay: o.allDay, day, ...(o.location ? { location: o.location } : {}) });
      }
    }
  }
  out.sort((a, b) => (a.day === b.day ? 0 : a.day === 'today' ? -1 : 1) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1)
    || Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  return {
    status: 'ok', events: out.slice(0, MAX_SHOWN), today, fetchedAt: new Date(c.at).toISOString(),
    ...(lastError ? { error: lastError, stale: true } : {}),
  };
}
