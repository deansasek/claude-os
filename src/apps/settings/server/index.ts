// Settings routes (under /api/settings/): the profile, "Your Claude" instructions, and what the PC keeps. See ../api.ts for the shapes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Binary, ServerApp } from '../../../core/server/app.ts';
import { PHOTO_MAX } from '../api.ts';
import { manifest } from '../manifest.ts';
import { PHOTOS } from '../../photos/server/store.ts';
import { listProjects, projectFolder } from '../../claude/server/hubsessions.ts';
import { getInstructions, setInstructions } from './instructions.ts';
import { getProfile, readProfilePhoto, removePhoto, savePhoto, setProfile, setWelcomeDone, welcomeDone } from './profile.ts';
import { addCustomMcp, addFolder, knownServer, pluginsView, probe, removeCustomMcp, removeFolder, setOn } from './plugins.ts';
import { checkPin, pinRecord, pinStatus, removePin, setPin } from './pin.ts';
import { readBackup, saveBackup } from './backup.ts';
import { installPlugin, marketView, refreshMarket, uninstallPlugin } from './market.ts';

/** The folder the Plugins view reads: the one asked for, else the most recent folder, else the home folder. */
function folderFor(id: string): { cwd: string; project: { id: string; name: string } | null } {
  const list = listProjects();
  const p = list.find(x => x.id === id) ?? list[0];
  const cwd = p ? projectFolder(p.id) : null;
  return cwd && p ? { cwd, project: { id: p.id, name: p.name } } : { cwd: os.homedir(), project: null };
}

/** Bytes under a folder (0 when it isn't there). Photos are a few hundred files at most on a desk tablet. */
function bytesIn(dir: string): number {
  let total = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* gone */ } }
    }
  };
  walk(dir);
  return total;
}

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'profile', handle: () => getProfile() },
    { method: 'POST', path: 'profile', handle: ({ body }) => setProfile(body ?? {}) },
    {
      method: 'POST', path: 'photo', rawMax: PHOTO_MAX, handle: ({ raw, from }) => {
        const r = savePhoto(raw);
        if (r.ok) console.log(`settings: profile photo saved (from ${from})`);
        return r;
      },
    },
    { method: 'POST', path: 'photo/remove', handle: () => removePhoto() },
    {
      method: 'GET', path: 'photo', handle: (): Binary | { ok: false; error: string } => {
        const data = readProfilePhoto();
        if (!data) return { binary: true, status: 404, contentType: 'text/plain; charset=utf-8', body: Buffer.from('not found') };
        return { binary: true, contentType: 'image/jpeg', body: data };
      },
    },
    { method: 'GET', path: 'instructions', handle: () => ({ text: getInstructions() }) },
    { method: 'POST', path: 'instructions', handle: ({ body }) => ({ text: setInstructions(body?.text) }) },
    // The first-run welcome (core/web/welcome.ts): {done: true} once finished or skipped; {done: false} brings it back
    { method: 'GET', path: 'welcome', handle: () => ({ done: welcomeDone() }) },
    { method: 'POST', path: 'welcome', handle: ({ body }) => ({ done: setWelcomeDone(body?.done !== false) }) },
    { method: 'GET', path: 'storage', handle: () => ({ photos: bytesIn(PHOTOS) }) },
    // The ClaudeOS PIN lock (see ./pin.ts): read from the file on every call, so a deleted file clears it
    { method: 'GET', path: 'pin', handle: () => pinStatus() },
    { method: 'GET', path: 'pin/record', handle: () => pinRecord() },   // the tablet's copy (core/web/pin-local.ts)
    { method: 'POST', path: 'pin/check', handle: ({ body }) => checkPin(body?.pin) },
    { method: 'POST', path: 'pin', handle: ({ body }) => setPin(body?.pin, body?.current) },
    { method: 'POST', path: 'pin/remove', handle: ({ body }) => removePin(body?.pin) },
    // Plugins: what this PC's Claude Code has, and the ClaudeOS on/off choices (see ./plugins.ts)
    {
      method: 'GET', path: 'plugins', handle: async ({ query }) => {
        const f = folderFor(query.get('project') ?? '');
        return pluginsView(f.cwd, f.project, query.get('fresh') === '1');
      },
    },
    { method: 'POST', path: 'plugins/toggle', handle: ({ body }) => setOn(String(body?.key ?? ''), body?.on === true) },
    { method: 'POST', path: 'plugins/mcp', handle: ({ body }) => addCustomMcp(body ?? {}) },
    { method: 'POST', path: 'plugins/mcp/remove', handle: ({ body }) => ({ ok: removeCustomMcp(String(body?.name ?? '')) }) },
    {
      method: 'POST', path: 'plugins/test', handle: async ({ body, query }) => {
        const name = String(body?.name ?? '');
        const f = folderFor(String(body?.project ?? query.get('project') ?? ''));
        if (!knownServer(name, f.cwd)) return { ok: false, error: 'no_such_server' };
        const p = await probe(f.cwd, true);
        const s = p.servers.find(x => x.name === name);
        if (!s) return { ok: false, error: p.error ?? 'not_running' };
        return { ok: true, status: s.status, tools: s.tools ? s.tools.length : null, error: s.error ? s.error.slice(0, 160) : null };
      },
    },
    { method: 'POST', path: 'plugins/folder', handle: ({ body }) => addFolder(String(body?.path ?? '')) },
    { method: 'POST', path: 'plugins/folder/remove', handle: ({ body }) => ({ ok: removeFolder(String(body?.path ?? '')) }) },
    // Discover: the Anthropic plugin marketplace, through the Claude Code CLI (see ./market.ts)
    { method: 'GET', path: 'plugins/market', handle: () => marketView() },
    { method: 'POST', path: 'plugins/market/install', handle: ({ body }) => installPlugin(body?.name, body?.marketplace) },
    { method: 'POST', path: 'plugins/market/uninstall', handle: ({ body }) => uninstallPlugin(body?.name, body?.marketplace) },
    { method: 'POST', path: 'plugins/market/refresh', handle: () => refreshMarket() },
    // the settings backup (Storage): the os.* settings and sidebar pins, kept on this PC (backup.ts)
    { method: 'GET', path: 'backup', handle: () => readBackup() },
    { method: 'POST', path: 'backup', handle: ({ body }) => saveBackup(body) },
  ],
};
export default app;
