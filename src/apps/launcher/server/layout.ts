// The Apps screen's layout on the PC: the order of the tiles and the hidden ones, one layout per screen (tablet, hub).
//
// Kept in .launcher-layout.json (outside src/, so it is never served), written to a temp file and then renamed,
// so a crash mid-write never leaves half a file. Everything read from the file or sent by a page is cleaned
// (api.ts cleanLayout): keys must be "c:<appId>" or "a:<package>", each once; ClaudeOS app ids that don't exist are
// dropped. Android keys are only dropped when the tablet says that app is no longer allowed (it sends its list with
// each save): which Android apps are allowed stays on the tablet (Launcher.java), because lock task depends on it.
import fs from 'node:fs';
import path from 'node:path';
import { HUB, SRC } from '../../../core/server/paths.ts';
import { cleanLayout, isScreen, type LauncherLayout, type LauncherLayoutResult, type LauncherScreen } from '../api.ts';
import { manifest } from '../manifest.ts';

const FILE = path.join(HUB, '.launcher-layout.json');

/** ClaudeOS's own apps: every src/apps/<id> with a page (web/index.ts), except this one. */
function ownIds(): Set<string> {
  const dir = path.join(SRC, 'apps');
  try {
    return new Set(fs.readdirSync(dir).filter(id => id !== manifest.id && fs.existsSync(path.join(dir, id, 'web', 'index.ts'))));
  } catch { return new Set(); }
}
const OWN = ownIds();

type Store = Partial<Record<LauncherScreen, LauncherLayout>>;

const clean = (screen: LauncherScreen, raw: unknown, allowed?: ReadonlySet<string>, strict = false): LauncherLayout | null =>
  cleanLayout(raw, { own: OWN, allowed, noAndroid: screen === 'hub', strict });

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
    const s: Store = {};
    for (const screen of ['tablet', 'hub'] as const) {
      const l = clean(screen, raw?.[screen]);
      if (l) s[screen] = l;
    }
    return s;
  } catch { return {}; }
}
let store = load();

function persist(next: Store): boolean {
  const tmp = `${FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) {
    console.log('launcher: could not save the layout:', (e as NodeJS.ErrnoException).code ?? 'error');
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ }
    return false;
  }
}

const copy = (l: LauncherLayout | undefined): LauncherLayout | null => (l ? { order: [...l.order], hidden: [...l.hidden] } : null);

/** The saved layout of one screen (null: none saved yet). */
export function getLayout(screen: unknown): LauncherLayoutResult {
  if (!isScreen(screen)) return { ok: false, screen: 'tablet', layout: null, error: 'Unknown screen.' };
  return { ok: true, screen, layout: copy(store[screen]) };
}

/** Replace one screen's layout. `allowed`: the tablet's allowed packages now, when it sent them. */
export function saveLayout(screen: unknown, raw: unknown, allowed: unknown): LauncherLayoutResult {
  if (!isScreen(screen)) return { ok: false, screen: 'tablet', layout: null, error: 'Unknown screen.' };
  let allow: Set<string> | undefined;
  if (allowed !== undefined) {
    if (!Array.isArray(allowed) || !allowed.every(p => typeof p === 'string')) return { ok: false, screen, layout: copy(store[screen]), error: 'That isn’t a list of apps.' };
    allow = new Set(allowed as string[]);
  }
  const l = clean(screen, raw, allow, true);
  if (!l) return { ok: false, screen, layout: copy(store[screen]), error: 'That isn’t an Apps layout.' };
  const next: Store = { ...store, [screen]: l };
  if (!persist(next)) return { ok: false, screen, layout: copy(store[screen]), error: 'The PC couldn’t save the layout.' };
  store = next;
  return { ok: true, screen, layout: copy(l) };
}
