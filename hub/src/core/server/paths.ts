import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';

export const HOME = os.homedir();
export const PROJECTS = config.projectsDir;   // default ~/.claude/projects
export const CREDS_FILE = path.join(HOME, '.claude', '.credentials.json');
export const TOKEN_FILE = path.join(HOME, '.claude-meter-token');
export const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');   // src/core/server → hub/
export const PUBLIC = path.join(HUB, 'public');
export const SRC = path.join(HUB, 'src');
export const CONFIG_FILE = path.join(HUB, 'meter-config.json');

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
