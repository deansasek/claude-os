// The hub's settings for this install. Command-line arguments win, then config.json, then the defaults below.
// config.json sits in , outside src/ and public/, so the server never serves it. Copy config.example.json
// (or run `npm run setup`) to make one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface HostConfig {
  host: string;          // address to listen on
  port: number;          // port to listen on
  cast: string;          // Nest Hub (Chromecast) address to keep the page cast to; empty = none
  cattPath: string;      // the catt command used for casting
  theme: string;         // ?theme= of the cast page
  projectsDir: string;   // Claude Code's projects folder (session logs)
  ownerName: string;     // the owner's name; empty = none
  https: boolean;        // also serve HTTPS on port + 1 (the iPad needs it for the camera); the plain port stays
}

const HOST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');   // src/core/server → 
export const CONFIG_JSON = path.join(HOST_DIR, 'config.json');

const DEFAULTS: HostConfig = {
  host: '0.0.0.0',
  port: 8000,
  cast: '',
  cattPath: 'catt',
  theme: 'time',
  projectsDir: path.join(os.homedir(), '.claude', 'projects'),
  ownerName: '',
  https: false,
};

function readFile(): Partial<HostConfig> {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_JSON, 'utf8').replace(/^﻿/, ''));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.log(`config.json ignored: ${(e as Error).message}`);
    return {};
  }
}

function readArgs(): Partial<HostConfig> {
  // strict: false so an unknown flag never stops the server; only the flags below are read.
  const { values: a } = parseArgs({
    strict: false,
    options: {
      host: { type: 'string' }, port: { type: 'string' }, cast: { type: 'string' },
      catt: { type: 'string' }, theme: { type: 'string' }, projects: { type: 'string' }, 'no-cast': { type: 'boolean' },
      https: { type: 'boolean' },
    },
  });
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const out: Partial<HostConfig> = {};
  if (s(a.host)) out.host = s(a.host);
  if (s(a.port)) out.port = Number(a.port);
  if (s(a.cast)) out.cast = s(a.cast);
  if (a['no-cast']) out.cast = '';   // --no-cast turns casting off, even when config.json names a device
  if (s(a.catt)) out.cattPath = s(a.catt);
  if (s(a.theme)) out.theme = s(a.theme);
  if (s(a.projects)) out.projectsDir = s(a.projects);
  if (a.https) out.https = true;
  return out;
}

function load(): HostConfig {
  const file = readFile(), args = readArgs();
  const pick = <K extends keyof HostConfig>(k: K): HostConfig[K] => {
    const v = args[k] ?? file[k];
    return (v === undefined || v === null || v === '' ? DEFAULTS[k] : v) as HostConfig[K];
  };
  const port = Number(pick('port'));
  return {
    host: String(pick('host')),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.port,
    cast: String(pick('cast')),
    cattPath: String(pick('cattPath')),
    theme: String(pick('theme')),
    projectsDir: path.resolve(HOST_DIR, String(pick('projectsDir'))),
    ownerName: String(pick('ownerName')),
    https: pick('https') === true,
  };
}

export const config: HostConfig = load();
