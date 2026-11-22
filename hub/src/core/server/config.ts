// The hub's settings for this install. Command-line arguments win, then hub/config.json, then the defaults below.
// config.json sits in hub/, outside src/ and public/, so the server never serves it. Copy config.example.json
// (or run `npm run setup`) to make one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface HubConfig {
  host: string;          // address to listen on
  port: number;          // port to listen on
  cast: string;          // Nest Hub (Chromecast) address to keep the page cast to; empty = none
  cattPath: string;      // the catt command used for casting
  theme: string;         // ?theme= of the cast page
  projectsDir: string;   // Claude Code's projects folder (session logs)
  ownerName: string;     // the owner's name; empty = none
}

const HUB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');   // src/core/server → hub/
export const CONFIG_JSON = path.join(HUB_DIR, 'config.json');

const DEFAULTS: HubConfig = {
  host: '0.0.0.0',
  port: 8000,
  cast: '',
  cattPath: 'catt',
  theme: 'time',
  projectsDir: path.join(os.homedir(), '.claude', 'projects'),
  ownerName: '',
};

function readFile(): Partial<HubConfig> {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_JSON, 'utf8').replace(/^﻿/, ''));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.log(`config.json ignored: ${(e as Error).message}`);
    return {};
  }
}

function readArgs(): Partial<HubConfig> {
  // strict: false so an unknown flag never stops the server; only the flags below are read.
  const { values: a } = parseArgs({
    strict: false,
    options: {
      host: { type: 'string' }, port: { type: 'string' }, cast: { type: 'string' },
      catt: { type: 'string' }, theme: { type: 'string' }, projects: { type: 'string' },
    },
  });
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const out: Partial<HubConfig> = {};
  if (s(a.host)) out.host = s(a.host);
  if (s(a.port)) out.port = Number(a.port);
  if (s(a.cast)) out.cast = s(a.cast);
  if (s(a.catt)) out.cattPath = s(a.catt);
  if (s(a.theme)) out.theme = s(a.theme);
  if (s(a.projects)) out.projectsDir = s(a.projects);
  return out;
}

function load(): HubConfig {
  const file = readFile(), args = readArgs();
  const pick = <K extends keyof HubConfig>(k: K): HubConfig[K] => {
    const v = args[k] ?? file[k];
    return (v === undefined || v === null || v === '' ? DEFAULTS[k] : v) as HubConfig[K];
  };
  const port = Number(pick('port'));
  return {
    host: String(pick('host')),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.port,
    cast: String(pick('cast')),
    cattPath: String(pick('cattPath')),
    theme: String(pick('theme')),
    projectsDir: path.resolve(HUB_DIR, String(pick('projectsDir'))),
    ownerName: String(pick('ownerName')),
  };
}

export const config: HubConfig = load();
