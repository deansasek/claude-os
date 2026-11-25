import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';

export const HOME = os.homedir();
export const PROJECTS = config.projectsDir;   // default ~/.claude/projects
export const CREDS_FILE = path.join(HOME, '.claude', '.credentials.json');
export const TOKEN_FILE = path.join(HOME, '.claude-meter-token');
export const HOST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');   // src/core/server → 
// The folder for state the host writes (settings, lists, PIN, sessions). Defaults to the repository root.
export const STATE = process.env.CLAUDEOS_STATE_DIR ? path.resolve(process.env.CLAUDEOS_STATE_DIR) : HOST_DIR;
export const PUBLIC = path.join(HOST_DIR, 'public');
export const SRC = path.join(HOST_DIR, 'src');
export const CONFIG_FILE = path.join(HOST_DIR, 'meter-config.json');

/** Every *.jsonl under a folder (recursive). */
export function listJsonl(root: string): string[] {
  try {
    return (fs.readdirSync(root, { recursive: true }) as string[])
      .filter(p => p.endsWith('.jsonl'))
      .map(p => path.join(root, p));
  } catch {
    return [];
  }
}

/** Find an executable on PATH (Windows-aware). */
export function which(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
    }
  }
  return null;
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T;
  } catch {
    return null;
  }
}

/**
 * Read a JSON file that the hub may save over. A missing file gives null. A file that is there but can't be read is
 * moved aside as <file>.corrupt (so the next save doesn't overwrite what was in it) and gives null.
 */
export function readJsonOrSetAside<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  const v = readJson<T>(file);
  if (v !== null) return v;
  try {
    fs.renameSync(file, `${file}.corrupt`);
    console.log(`${path.basename(file)} could not be read; it was kept as ${path.basename(file)}.corrupt`);
  } catch { /* nothing more to do */ }
  return null;
}

/** Write JSON through a .tmp file, so a crash never leaves a half-written file. Throws on failure, after removing the .tmp. */
export function writeJsonFile(file: string, data: unknown, opts: { indent: number; mode?: number }): void {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, opts.indent), { encoding: 'utf8', mode: opts.mode });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ }
    throw e;
  }
}
